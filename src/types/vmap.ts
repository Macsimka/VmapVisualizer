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

// Map file constants
export const MAP_MAGIC = 'MAPS'
export const MAP_VERSION_MAGIC = 10
export const MAP_HEIGHT_MAGIC = 'MHGT'
export const MAP_AREA_MAGIC = 'AREA'
export const MAP_LIQUID_MAGIC = 'MLIQ'

// Map height header flags
export const MAP_HEIGHT_NO_HEIGHT = 0x0001
export const MAP_HEIGHT_AS_INT16 = 0x0002
export const MAP_HEIGHT_AS_INT8 = 0x0004
export const MAP_HEIGHT_HAS_FLIGHT_BOUNDS = 0x0008

// Grid constants
export const MAP_RESOLUTION = 128
export const SIZE_OF_GRIDS = 533.33333

export interface MapFileHeader {
  mapMagic: string
  versionMagic: number
  buildMagic: number
  areaMapOffset: number
  areaMapSize: number
  heightMapOffset: number
  heightMapSize: number
  liquidMapOffset: number
  liquidMapSize: number
  holesOffset: number
  holesSize: number
}

export interface MapHeightHeader {
  heightMagic: string
  flags: number
  gridHeight: number
  gridMaxHeight: number
}

export interface TerrainData {
  header: MapFileHeader
  heightHeader?: MapHeightHeader
  // V9 = vertices at corners (129x129)
  // V8 = vertices at cell centers (128x128)
  v9?: Float32Array
  v8?: Float32Array
  gridHeight: number
  gridMaxHeight: number
  // Holes bitmap: 16*16*8 bytes
  holes?: Uint8Array
  hasHeightData: boolean
  hasHoles: boolean
}
