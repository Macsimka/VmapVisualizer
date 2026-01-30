export const VMAP_MAGIC = 'VMAP_4.E'
export const RAW_VMAP_MAGIC = 'VMAP04E'

export const MOD_HAS_BOUND = 1
export const MOD_PARENT_SPAWN = 2
export const MOD_PATH_ONLY = 4

export const MODEL_FLAG_IS_M2 = 2

export interface Vec3 {
  x: number
  y: number
  z: number
}

export interface AABox {
  low: Vec3
  high: Vec3
}

export interface ModelSpawn {
  flags: number
  adtId: number
  id: number
  position: Vec3
  rotation: Vec3
  scale: number
  bound?: AABox
  name: string
  isPathOnly: boolean
  isParentSpawn: boolean
  hasBound: boolean
}

export interface GroupModel {
  bound: AABox
  mogpFlags: number
  groupWmoId: number
  vertices: Float32Array
  indices: Uint32Array
}

export interface WorldModel {
  flags: number
  rootWmoId: number
  groups: GroupModel[]
  isM2: boolean
}

export interface VmTile {
  magic: string
  spawns: ModelSpawn[]
}

export interface VmTileIdx {
  magic: string
  nodeIndices: number[]
}

export interface ParseResult<T> {
  success: boolean
  data?: T
  error?: string
}

export interface LoadedModel {
  spawn: ModelSpawn
  model: WorldModel | null
  error?: string
}

export interface DiagnosticInfo {
  totalSpawns: number
  loadedModels: number
  missingModels: string[]
  totalTriangles: number
  totalVertices: number
  parseErrors: string[]
}
