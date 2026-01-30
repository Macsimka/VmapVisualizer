import { BinaryReader } from '../utils/BinaryReader'
import {
  VMAP_MAGIC,
  MODEL_FLAG_IS_M2,
  type WorldModel,
  type GroupModel,
  type ParseResult,
  type AABox,
} from '../types/vmap'

function readAABox(reader: BinaryReader): AABox {
  return {
    low: reader.readVec3(),
    high: reader.readVec3(),
  }
}

function skipBIH(reader: BinaryReader): void {
  // BIH format:
  // - bounds.low: 3 float
  // - bounds.high: 3 float
  // - treeSize: uint32
  // - tree: treeSize * uint32
  // - count: uint32
  // - objects: count * uint32
  reader.skip(6 * 4) // bounds (2 vec3)
  const treeSize = reader.readUint32()
  reader.skip(treeSize * 4) // tree data
  const objectCount = reader.readUint32()
  reader.skip(objectCount * 4) // objects data
}

function parseGroupModel(reader: BinaryReader): GroupModel {
  const bound = readAABox(reader)
  const mogpFlags = reader.readUint32()
  const groupWmoId = reader.readUint32()

  let vertices = new Float32Array(0)
  let indices = new Uint32Array(0)

  // Read VERT chunk
  const vertChunk = reader.readChunkId()
  if (vertChunk !== 'VERT') {
    throw new Error(`Expected VERT chunk, got "${vertChunk}"`)
  }
  const _vertChunkSize = reader.readUint32()
  const vertexCount = reader.readUint32()

  // Models without geometry end here (see WorldModel.cpp line 372-373)
  if (vertexCount === 0) {
    return {
      bound,
      mogpFlags,
      groupWmoId,
      vertices,
      indices,
    }
  }

  vertices = new Float32Array(vertexCount * 3)
  for (let i = 0; i < vertexCount * 3; i++) {
    vertices[i] = reader.readFloat32()
  }

  // Read TRIM chunk (triangles)
  const trimChunk = reader.readChunkId()
  if (trimChunk !== 'TRIM') {
    throw new Error(`Expected TRIM chunk, got "${trimChunk}"`)
  }
  const _trimChunkSize = reader.readUint32()
  const triCount = reader.readUint32()

  // MeshTriangle = 3 uint32 (idx0, idx1, idx2)
  indices = new Uint32Array(triCount * 3)
  for (let i = 0; i < triCount * 3; i++) {
    indices[i] = reader.readUint32()
  }

  // Read MBIH chunk (mesh BIH)
  // Note: MBIH has no chunkSize field, BIH data follows directly after chunk ID
  const mbihChunk = reader.readChunkId()
  if (mbihChunk !== 'MBIH') {
    throw new Error(`Expected MBIH chunk, got "${mbihChunk}"`)
  }
  skipBIH(reader)

  // Read LIQU chunk (liquid data)
  const liquChunk = reader.readChunkId()
  if (liquChunk !== 'LIQU') {
    throw new Error(`Expected LIQU chunk, got "${liquChunk}"`)
  }
  const liquChunkSize = reader.readUint32()
  if (liquChunkSize > 0) {
    reader.skip(liquChunkSize)
  }

  return {
    bound,
    mogpFlags,
    groupWmoId,
    vertices,
    indices,
  }
}

export function parseVmo(buffer: ArrayBuffer): ParseResult<WorldModel> {
  try {
    const reader = new BinaryReader(buffer)

    // Read magic
    const magic = reader.readFixedString(8)
    if (magic !== VMAP_MAGIC) {
      return {
        success: false,
        error: `Invalid vmo magic: expected "${VMAP_MAGIC}", got "${magic}"`,
      }
    }

    // Read WMOD chunk
    const wmodChunk = reader.readChunkId()
    if (wmodChunk !== 'WMOD') {
      return {
        success: false,
        error: `Expected WMOD chunk, got "${wmodChunk}"`,
      }
    }
    const wmodChunkSize = reader.readUint32()
    if (wmodChunkSize < 8) {
      return {
        success: false,
        error: `WMOD chunk too small: ${wmodChunkSize}`,
      }
    }

    const flags = reader.readUint32()
    const rootWmoId = reader.readUint32()

    // Check if GMOD chunk exists
    if (!reader.hasMore() || reader.remaining < 4) {
      return {
        success: true,
        data: {
          flags,
          rootWmoId,
          groups: [],
          isM2: (flags & MODEL_FLAG_IS_M2) !== 0,
        },
      }
    }

    // Read GMOD chunk
    const gmodChunk = reader.readChunkId()
    if (gmodChunk !== 'GMOD') {
      return {
        success: false,
        error: `Expected GMOD chunk, got "${gmodChunk}"`,
      }
    }

    const groupCount = reader.readUint32()
    const groups: GroupModel[] = []

    for (let i = 0; i < groupCount; i++) {
      try {
        const group = parseGroupModel(reader)
        groups.push(group)
      } catch (e) {
        return {
          success: false,
          error: `Failed to parse group ${i}: ${e}`,
        }
      }
    }

    // Skip GBIH chunk if present (group BIH)
    // Note: GBIH also has no chunkSize, BIH data follows directly
    if (reader.hasMore() && reader.remaining >= 4) {
      const gbihChunk = reader.readChunkId()
      if (gbihChunk === 'GBIH') {
        skipBIH(reader)
      }
    }

    return {
      success: true,
      data: {
        flags,
        rootWmoId,
        groups,
        isM2: (flags & MODEL_FLAG_IS_M2) !== 0,
      },
    }
  } catch (e) {
    return {
      success: false,
      error: `Failed to parse vmo: ${e}`,
    }
  }
}
