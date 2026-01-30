import { BinaryReader } from '../utils/BinaryReader'
import {
  MAP_MAGIC,
  MAP_VERSION_MAGIC,
  MAP_HEIGHT_MAGIC,
  MAP_HEIGHT_NO_HEIGHT,
  MAP_HEIGHT_AS_INT16,
  MAP_HEIGHT_AS_INT8,
  type MapFileHeader,
  type MapHeightHeader,
  type TerrainData,
  type ParseResult,
} from '../types/vmap'

export function parseMapFile(buffer: ArrayBuffer): ParseResult<TerrainData> {
  try {
    const reader = new BinaryReader(buffer)

    // Read file header
    const mapMagic = reader.readFixedString(4)
    if (mapMagic !== MAP_MAGIC) {
      return {
        success: false,
        error: `Invalid map magic: expected "${MAP_MAGIC}", got "${mapMagic}"`,
      }
    }

    const versionMagic = reader.readUint32()
    if (versionMagic !== MAP_VERSION_MAGIC) {
      return {
        success: false,
        error: `Invalid map version: expected ${MAP_VERSION_MAGIC}, got ${versionMagic}`,
      }
    }

    const header: MapFileHeader = {
      mapMagic,
      versionMagic,
      buildMagic: reader.readUint32(),
      areaMapOffset: reader.readUint32(),
      areaMapSize: reader.readUint32(),
      heightMapOffset: reader.readUint32(),
      heightMapSize: reader.readUint32(),
      liquidMapOffset: reader.readUint32(),
      liquidMapSize: reader.readUint32(),
      holesOffset: reader.readUint32(),
      holesSize: reader.readUint32(),
    }

    const result: TerrainData = {
      header,
      gridHeight: -500,
      gridMaxHeight: -500,
      hasHeightData: false,
      hasHoles: false,
    }

    // Load height data if present
    if (header.heightMapOffset > 0 && header.heightMapSize > 0) {
      reader.seek(header.heightMapOffset)

      const heightMagic = reader.readFixedString(4)
      if (heightMagic !== MAP_HEIGHT_MAGIC) {
        return {
          success: false,
          error: `Invalid height magic: expected "${MAP_HEIGHT_MAGIC}", got "${heightMagic}"`,
        }
      }

      const heightHeader: MapHeightHeader = {
        heightMagic,
        flags: reader.readUint32(),
        gridHeight: reader.readFloat32(),
        gridMaxHeight: reader.readFloat32(),
      }
      result.heightHeader = heightHeader
      result.gridHeight = heightHeader.gridHeight
      result.gridMaxHeight = heightHeader.gridMaxHeight

      // Check if we have actual height data
      if (!(heightHeader.flags & MAP_HEIGHT_NO_HEIGHT)) {
        result.hasHeightData = true

        if (heightHeader.flags & MAP_HEIGHT_AS_INT8) {
          // Height stored as uint8
          const v9Uint8 = new Uint8Array(129 * 129)
          const v8Uint8 = new Uint8Array(128 * 128)

          for (let i = 0; i < 129 * 129; i++) {
            v9Uint8[i] = reader.readUint8()
          }
          for (let i = 0; i < 128 * 128; i++) {
            v8Uint8[i] = reader.readUint8()
          }

          // Convert to float
          const multiplier = (heightHeader.gridMaxHeight - heightHeader.gridHeight) / 255
          result.v9 = new Float32Array(129 * 129)
          result.v8 = new Float32Array(128 * 128)

          for (let i = 0; i < 129 * 129; i++) {
            result.v9[i] = v9Uint8[i] * multiplier + heightHeader.gridHeight
          }
          for (let i = 0; i < 128 * 128; i++) {
            result.v8[i] = v8Uint8[i] * multiplier + heightHeader.gridHeight
          }
        } else if (heightHeader.flags & MAP_HEIGHT_AS_INT16) {
          // Height stored as uint16
          const v9Uint16 = new Uint16Array(129 * 129)
          const v8Uint16 = new Uint16Array(128 * 128)

          for (let i = 0; i < 129 * 129; i++) {
            v9Uint16[i] = reader.readUint16()
          }
          for (let i = 0; i < 128 * 128; i++) {
            v8Uint16[i] = reader.readUint16()
          }

          // Convert to float
          const multiplier = (heightHeader.gridMaxHeight - heightHeader.gridHeight) / 65535
          result.v9 = new Float32Array(129 * 129)
          result.v8 = new Float32Array(128 * 128)

          for (let i = 0; i < 129 * 129; i++) {
            result.v9[i] = v9Uint16[i] * multiplier + heightHeader.gridHeight
          }
          for (let i = 0; i < 128 * 128; i++) {
            result.v8[i] = v8Uint16[i] * multiplier + heightHeader.gridHeight
          }
        } else {
          // Height stored as float
          result.v9 = new Float32Array(129 * 129)
          result.v8 = new Float32Array(128 * 128)

          for (let i = 0; i < 129 * 129; i++) {
            result.v9[i] = reader.readFloat32()
          }
          for (let i = 0; i < 128 * 128; i++) {
            result.v8[i] = reader.readFloat32()
          }
        }
      }
    }

    // Load holes data if present
    if (header.holesOffset > 0 && header.holesSize > 0) {
      reader.seek(header.holesOffset)

      result.holes = new Uint8Array(16 * 16 * 8)
      for (let i = 0; i < 16 * 16 * 8; i++) {
        result.holes[i] = reader.readUint8()
      }
      result.hasHoles = true
    }

    return {
      success: true,
      data: result,
    }
  } catch (e) {
    return {
      success: false,
      error: `Failed to parse map file: ${e}`,
    }
  }
}

// Check if a specific cell is a hole
// row, col are in range [0, 127] (MAP_RESOLUTION - 1)
export function isHole(holes: Uint8Array, row: number, col: number): boolean {
  const cellRow = Math.floor(row / 8) // 8 squares per cell
  const cellCol = Math.floor(col / 8)
  const holeRow = row % 8
  const holeCol = col % 8

  return (holes[cellRow * 16 * 8 + cellCol * 8 + holeRow] & (1 << holeCol)) !== 0
}
