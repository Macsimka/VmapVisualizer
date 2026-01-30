import { BinaryReader } from '../utils/BinaryReader'
import { VMAP_MAGIC, type VmTileIdx, type ParseResult } from '../types/vmap'

export function parseVmTileIdx(buffer: ArrayBuffer): ParseResult<VmTileIdx> {
  try {
    const reader = new BinaryReader(buffer)

    const magic = reader.readFixedString(8)
    if (magic !== VMAP_MAGIC) {
      return {
        success: false,
        error: `Invalid vmtileidx magic: expected "${VMAP_MAGIC}", got "${magic}"`,
      }
    }

    const numSpawns = reader.readUint32()
    const nodeIndices: number[] = []

    for (let i = 0; i < numSpawns; i++) {
      nodeIndices.push(reader.readUint32())
    }

    return {
      success: true,
      data: {
        magic,
        nodeIndices,
      },
    }
  } catch (e) {
    return {
      success: false,
      error: `Failed to parse vmtileidx: ${e}`,
    }
  }
}
