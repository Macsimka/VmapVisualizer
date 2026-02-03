import { BinaryReader } from '../utils/BinaryReader'
import {
  VMAP_MAGIC_VERSIONS,
  MOD_HAS_BOUND,
  MOD_PARENT_SPAWN,
  MOD_PATH_ONLY,
  type ModelSpawn,
  type VmTile,
  type ParseResult,
} from '../types/vmap'

function parseModelSpawn(reader: BinaryReader): ModelSpawn {
  const flags = reader.readUint8()
  const adtId = reader.readUint8()
  const id = reader.readUint32()
  const position = reader.readVec3()
  const rotation = reader.readVec3()
  const scale = reader.readFloat32()

  let bound = undefined
  if (flags & MOD_HAS_BOUND) {
    bound = {
      low: reader.readVec3(),
      high: reader.readVec3(),
    }
  }

  const nameLen = reader.readUint32()
  const name = reader.readString(nameLen)

  return {
    flags,
    adtId,
    id,
    position,
    rotation,
    scale,
    bound,
    name,
    isPathOnly: (flags & MOD_PATH_ONLY) !== 0,
    isParentSpawn: (flags & MOD_PARENT_SPAWN) !== 0,
    hasBound: (flags & MOD_HAS_BOUND) !== 0,
  }
}

export function parseVmTile(buffer: ArrayBuffer): ParseResult<VmTile> {
  try {
    const reader = new BinaryReader(buffer)

    const magic = reader.readFixedString(8)
    if (!VMAP_MAGIC_VERSIONS.includes(magic)) {
      return {
        success: false,
        error: `Invalid vmtile magic: expected one of ${VMAP_MAGIC_VERSIONS.map(
          (value) => `"${value}"`,
        ).join(', ')}, got "${magic}"`,
      }
    }

    const numSpawns = reader.readUint32()
    const spawns: ModelSpawn[] = []

    for (let i = 0; i < numSpawns; i++) {
      try {
        const spawn = parseModelSpawn(reader)
        spawns.push(spawn)
      } catch (e) {
        return {
          success: false,
          error: `Failed to parse spawn ${i}: ${e}`,
        }
      }
    }

    return {
      success: true,
      data: {
        magic,
        spawns,
      },
    }
  } catch (e) {
    return {
      success: false,
      error: `Failed to parse vmtile: ${e}`,
    }
  }
}
