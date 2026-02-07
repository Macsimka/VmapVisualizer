<script setup lang="ts">
import { ref, computed } from 'vue'
import SceneRenderer from './components/SceneRenderer.vue'
import { parseVmTile, parseVmTileIdx, parseVmo, parseMapFile } from './parsers'
import type {
  VmTile,
  VmTileIdx,
  LoadedModel,
  DiagnosticInfo,
  TerrainData,
} from './types/vmap'

const vmtileFile = ref<File | null>(null)
const vmtileidxFile = ref<File | null>(null) // Auto-loaded based on vmtile name
const mapFile = ref<File | null>(null)
const vmtileFolder = ref<Map<string, File>>(new Map()) // Store all vmtile/vmtileidx files from folder
const vmoFiles = ref<Map<string, File>>(new Map())

const vmtile = ref<VmTile | null>(null)
const vmtileidx = ref<VmTileIdx | null>(null)
const loadedModels = ref<LoadedModel[]>([])
const terrainData = ref<TerrainData | null>(null)
const terrainGridX = ref(32)
const terrainGridY = ref(32)

const showPathOnly = ref(true)
const showM2 = ref(true)
const showBoundsOnly = ref(false)
const showWireframe = ref(false)
const showTerrain = ref(true)
const showVmaps = ref(true)

const parseErrors = ref<string[]>([])
const isLoading = ref(false)

const sceneRef = ref<InstanceType<typeof SceneRenderer> | null>(null)

async function readFileAsArrayBuffer(file: File): Promise<ArrayBuffer> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader()
    reader.onload = () => resolve(reader.result as ArrayBuffer)
    reader.onerror = () => reject(reader.error)
    reader.readAsArrayBuffer(file)
  })
}

function normalizeModelName(name: string): string {
  // Remove leading slashes and convert to lowercase for matching
  return name.replace(/^[/\\]+/, '').toLowerCase()
}

function onVmtileSelect(event: Event) {
  const input = event.target as HTMLInputElement
  if (!input.files) return

  vmtileFile.value = null
  vmtileidxFile.value = null
  vmtileFolder.value.clear()

  // Store all selected files
  for (const file of Array.from(input.files)) {
    vmtileFolder.value.set(file.name.toLowerCase(), file)
  }

  // Find .vmtile file
  for (const [name, file] of vmtileFolder.value) {
    if (name.endsWith('.vmtile')) {
      vmtileFile.value = file

      // Auto-find matching .vmtileidx file
      const idxName = name.replace('.vmtile', '.vmtileidx')
      if (vmtileFolder.value.has(idxName)) {
        vmtileidxFile.value = vmtileFolder.value.get(idxName)!
        console.log(`Auto-loaded index file: ${idxName}`)
      }
      break
    }
  }
}

function onMapFileSelect(event: Event) {
  const input = event.target as HTMLInputElement
  if (input.files && input.files[0]) {
    mapFile.value = input.files[0]
  }
}

function onVmoFolderSelect(event: Event) {
  const input = event.target as HTMLInputElement
  if (!input.files) return

  vmoFiles.value.clear()
  const allFiles = Array.from(input.files)
  console.log(`Total files in folder: ${allFiles.length}`)

  // Debug: check if specific file exists
  const instanceFiles = allFiles.filter(f => f.name.toLowerCase().includes('instance'))
  console.log(`Files with "instance" in name:`, instanceFiles.map(f => f.name))

  for (const file of allFiles) {
    if (file.name.endsWith('.vmo')) {
      // Only include files directly in the selected folder, not in subfolders
      const relativePath = file.webkitRelativePath || file.name
      const pathParts = relativePath.split('/')
      // pathParts[0] is the folder name, pathParts[1] should be the file if it's in root
      if (pathParts.length > 2) {
        continue // Skip files in subfolders
      }

      // Store by filename as-is (lowercase)
      // e.g. "Pa_House02.wmo.vmo" -> "pa_house02.wmo.vmo"
      const filename = file.name.toLowerCase()
      vmoFiles.value.set(filename, file)
    }
  }

  console.log(`Loaded ${vmoFiles.value.size} vmo file entries`)
}

let searchCount = 0
function findVmoFile(modelName: string): File | undefined {
  const normalized = normalizeModelName(modelName)
  const filename = normalized.split('/').pop() || normalized
  const filenameWithVmo = filename + '.vmo'

  // Debug first 3 searches
  if (searchCount < 3) {
    console.log(`Search #${searchCount}: modelName="${modelName}" -> key="${filenameWithVmo}"`)
    console.log(`  Key exists: ${vmoFiles.value.has(filenameWithVmo)}`)
    searchCount++
  }

  if (vmoFiles.value.has(filenameWithVmo)) {
    return vmoFiles.value.get(filenameWithVmo)
  }

  return undefined
}

async function loadAndParse() {
  if (!vmtileFile.value && !mapFile.value) {
    parseErrors.value = ['Please select a .vmtile or .map file']
    return
  }

  isLoading.value = true
  parseErrors.value = []
  loadedModels.value = []
  terrainData.value = null

  try {
    // Parse map file if provided (for terrain/holes)
    if (mapFile.value) {
      const mapBuffer = await readFileAsArrayBuffer(mapFile.value)
      const mapResult = parseMapFile(mapBuffer)

      if (!mapResult.success || !mapResult.data) {
        parseErrors.value.push(`map: ${mapResult.error}`)
      } else {
        terrainData.value = mapResult.data

        // Try to extract grid coordinates from filename
        // Format 1: mapId_gridX_gridY.map (e.g., 0960_30_36.map)
        // Format 2: gridX_gridY.map (e.g., 0032_0032.map)
        const filename = mapFile.value.name
        let match = filename.match(/^\d+_(\d+)_(\d+)\.map$/i)
        if (match) {
          // Format: mapId_gridX_gridY.map
          terrainGridX.value = parseInt(match[1], 10)
          terrainGridY.value = parseInt(match[2], 10)
          console.log(`Grid coords from filename (mapId_X_Y format): (${terrainGridX.value}, ${terrainGridY.value})`)
        } else {
          match = filename.match(/^(\d{4})_(\d{4})\.map$/i)
          if (match) {
            // Format: XXXX_YYYY.map
            terrainGridX.value = parseInt(match[1], 10)
            terrainGridY.value = parseInt(match[2], 10)
            console.log(`Grid coords from filename (XXXX_YYYY format): (${terrainGridX.value}, ${terrainGridY.value})`)
          } else {
            // Default to center grid
            terrainGridX.value = 32
            terrainGridY.value = 32
            console.log('Could not parse grid coords from filename, using default (32, 32)')
          }
        }

        console.log('Terrain loaded:', {
          hasHeightData: mapResult.data.hasHeightData,
          hasHoles: mapResult.data.hasHoles,
          gridHeight: mapResult.data.gridHeight,
          gridMaxHeight: mapResult.data.gridMaxHeight,
        })
      }
    }

    // If no vmtile file, we're done (terrain only mode)
    if (!vmtileFile.value) {
      isLoading.value = false
      return
    }
    // Parse vmtile
    const vmtileBuffer = await readFileAsArrayBuffer(vmtileFile.value)
    const vmtileResult = parseVmTile(vmtileBuffer)

    if (!vmtileResult.success || !vmtileResult.data) {
      parseErrors.value.push(`vmtile: ${vmtileResult.error}`)
      isLoading.value = false
      return
    }

    vmtile.value = vmtileResult.data

    // Parse vmtileidx if provided
    if (vmtileidxFile.value) {
      const vmtileidxBuffer = await readFileAsArrayBuffer(vmtileidxFile.value)
      const vmtileidxResult = parseVmTileIdx(vmtileidxBuffer)

      if (!vmtileidxResult.success || !vmtileidxResult.data) {
        parseErrors.value.push(`vmtileidx: ${vmtileidxResult.error}`)
      } else {
        vmtileidx.value = vmtileidxResult.data

        // Validate spawn count match
        if (vmtileidx.value.nodeIndices.length !== vmtile.value.spawns.length) {
          parseErrors.value.push(
            `Spawn count mismatch: vmtile has ${vmtile.value.spawns.length}, vmtileidx has ${vmtileidx.value.nodeIndices.length}`
          )
        }
      }
    }

    // Load models for each spawn
    const models: LoadedModel[] = []

    // Debug: show first few spawn names
    console.log('First 5 spawn.name values:', vmtile.value.spawns.slice(0, 5).map(s => s.name))

    for (const spawn of vmtile.value.spawns) {
      const vmoFile = findVmoFile(spawn.name)

      if (!vmoFile) {
        models.push({
          spawn,
          model: null,
          error: `Model not found: ${spawn.name}`,
        })
        continue
      }

      try {
        const vmoBuffer = await readFileAsArrayBuffer(vmoFile)
        const vmoResult = parseVmo(vmoBuffer)

        if (!vmoResult.success || !vmoResult.data) {
          console.error(`Parse error for ${spawn.name}: ${vmoResult.error}`)
          models.push({
            spawn,
            model: null,
            error: `Failed to parse ${spawn.name}: ${vmoResult.error}`,
          })
        } else {
          models.push({
            spawn,
            model: vmoResult.data,
          })
        }
      } catch (e) {
        console.error(`Load error for ${spawn.name}: ${e}`)
        models.push({
          spawn,
          model: null,
          error: `Error loading ${spawn.name}: ${e}`,
        })
      }
    }

    loadedModels.value = models
  } catch (e) {
    parseErrors.value.push(`Unexpected error: ${e}`)
  }

  isLoading.value = false
}

const diagnostics = computed<DiagnosticInfo>(() => {
  const missingModels = loadedModels.value
    .filter((m) => !m.model)
    .map((m) => m.spawn.name)

  const uniqueMissing = [...new Set(missingModels)]

  let totalTriangles = 0
  let totalVertices = 0

  for (const lm of loadedModels.value) {
    if (!lm.model) continue
    for (const g of lm.model.groups) {
      totalVertices += g.vertices.length / 3
      totalTriangles += g.indices.length / 3
    }
  }

  return {
    totalSpawns: vmtile.value?.spawns.length || 0,
    loadedModels: loadedModels.value.filter((m) => m.model).length,
    missingModels: uniqueMissing,
    totalTriangles,
    totalVertices,
    parseErrors: parseErrors.value,
  }
})
</script>

<template>
  <div class="app">
    <header class="header">
      <h1>VMAP Tile Visualizer</h1>
    </header>

    <div class="main-layout">
      <aside class="sidebar">
        <section class="panel">
          <h2>File Selection</h2>

          <div class="form-group">
            <label>
              .vmtile file
              <input type="file" accept=".vmtile" multiple @change="onVmtileSelect" />
            </label>
            <span v-if="vmtileFile" class="file-name">{{ vmtileFile.name }}</span>
            <span v-if="vmtileidxFile" class="file-name idx-loaded"> + {{ vmtileidxFile.name }}</span>
          </div>

          <div class="form-group">
            <label>
              vmaps folder (for .vmo files)
              <input
                type="file"
                webkitdirectory
                directory
                multiple
                @change="onVmoFolderSelect"
              />
            </label>
            <span class="file-name">{{ vmoFiles.size }} .vmo files loaded</span>
          </div>

          <div class="form-group">
            <label>
              .map file (terrain with holes)
              <input type="file" accept=".map" @change="onMapFileSelect" />
            </label>
            <span v-if="mapFile" class="file-name">{{ mapFile.name }}</span>
          </div>

          <button class="load-btn" @click="loadAndParse" :disabled="isLoading">
            {{ isLoading ? 'Loading...' : 'Load & Render' }}
          </button>
        </section>

        <section class="panel">
          <h2>Display Options</h2>

          <label class="checkbox-label" @mousedown.prevent>
            <input type="checkbox" v-model="showPathOnly" />
            Show Path-Only models
          </label>

          <label class="checkbox-label" @mousedown.prevent>
            <input type="checkbox" v-model="showM2" />
            Show M2 models
          </label>

          <label class="checkbox-label" @mousedown.prevent>
            <input type="checkbox" v-model="showBoundsOnly" />
            Show bounds only (AABB)
          </label>

          <label class="checkbox-label" @mousedown.prevent>
            <input type="checkbox" v-model="showWireframe" />
            Wireframe mode
          </label>

          <label class="checkbox-label" @mousedown.prevent>
            <input type="checkbox" v-model="showVmaps" />
            Show VMAPs
          </label>

          <label class="checkbox-label" @mousedown.prevent>
            <input type="checkbox" v-model="showTerrain" />
            Show Terrain (holes in red)
          </label>

          <button class="reset-btn" @click="sceneRef?.resetCamera()">
            Reset Camera
          </button>

          <div class="coords" v-if="sceneRef?.cameraPosition">
            <span>X: {{ sceneRef.cameraPosition.x.toFixed(1) }}</span>
            <span>Y: {{ sceneRef.cameraPosition.y.toFixed(1) }}</span>
            <span>Z: {{ sceneRef.cameraPosition.z.toFixed(1) }}</span>
          </div>
        </section>

        <section class="panel">
          <h2>Diagnostics</h2>

          <div class="stat">
            <span>Total Spawns:</span>
            <strong>{{ diagnostics.totalSpawns }}</strong>
          </div>

          <div class="stat">
            <span>Loaded Models:</span>
            <strong>{{ diagnostics.loadedModels }}</strong>
          </div>

          <div class="stat">
            <span>Total Vertices:</span>
            <strong>{{ diagnostics.totalVertices.toLocaleString() }}</strong>
          </div>

          <div class="stat">
            <span>Total Triangles:</span>
            <strong>{{ diagnostics.totalTriangles.toLocaleString() }}</strong>
          </div>

          <div v-if="diagnostics.missingModels.length > 0" class="missing-models">
            <h3>Missing Models ({{ diagnostics.missingModels.length }})</h3>
            <ul>
              <li v-for="name in diagnostics.missingModels.slice(0, 10)" :key="name">
                {{ name }}
              </li>
              <li v-if="diagnostics.missingModels.length > 10">
                ... and {{ diagnostics.missingModels.length - 10 }} more
              </li>
            </ul>
          </div>

          <div v-if="diagnostics.parseErrors.length > 0" class="errors">
            <h3>Errors</h3>
            <ul>
              <li v-for="(err, i) in diagnostics.parseErrors" :key="i" class="error">
                {{ err }}
              </li>
            </ul>
          </div>
        </section>

        <section class="panel" v-if="sceneRef?.selectedSpawn">
          <h2>Selected Object</h2>
          <div class="spawn-info">
            <div class="info-row">
              <span>Name:</span>
              <strong>{{ sceneRef.selectedSpawn.name }}</strong>
            </div>
            <div class="info-row">
              <span>Position:</span>
              <code>{{ sceneRef.selectedSpawn.position.x.toFixed(2) }}, {{ sceneRef.selectedSpawn.position.y.toFixed(2) }}, {{ sceneRef.selectedSpawn.position.z.toFixed(2) }}</code>
            </div>
            <div class="info-row">
              <span>Rotation:</span>
              <code>{{ sceneRef.selectedSpawn.rotation.x.toFixed(2) }}, {{ sceneRef.selectedSpawn.rotation.y.toFixed(2) }}, {{ sceneRef.selectedSpawn.rotation.z.toFixed(2) }}</code>
            </div>
            <div class="info-row">
              <span>Scale:</span>
              <code>{{ sceneRef.selectedSpawn.scale.toFixed(4) }}</code>
            </div>
          </div>
        </section>
      </aside>

      <main class="viewport">
        <SceneRenderer
          ref="sceneRef"
          :models="loadedModels"
          :terrain="terrainData"
          :terrain-grid-x="terrainGridX"
          :terrain-grid-y="terrainGridY"
          :show-path-only="showPathOnly"
          :show-m2="showM2"
          :show-bounds-only="showBoundsOnly"
          :show-wireframe="showWireframe"
          :show-terrain="showTerrain"
          :show-vmaps="showVmaps"
        />
      </main>
    </div>
  </div>
</template>

<style>
* {
  margin: 0;
  padding: 0;
  box-sizing: border-box;
}

body {
  font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Oxygen,
    Ubuntu, Cantarell, sans-serif;
  background: #0f0f1a;
  color: #e0e0e0;
}

.app {
  display: flex;
  flex-direction: column;
  height: 100vh;
}

.header {
  padding: 12px 20px;
  background: #1a1a2e;
  border-bottom: 1px solid #2a2a4a;
}

.header h1 {
  font-size: 1.25rem;
  font-weight: 500;
  color: #fff;
}

.main-layout {
  display: flex;
  flex: 1;
  overflow: hidden;
}

.sidebar {
  width: 320px;
  background: #16162a;
  border-right: 1px solid #2a2a4a;
  overflow-y: auto;
  padding: 16px;
}

.panel {
  background: #1a1a2e;
  border-radius: 8px;
  padding: 16px;
  margin-bottom: 16px;
}

.panel h2 {
  font-size: 0.875rem;
  font-weight: 600;
  text-transform: uppercase;
  letter-spacing: 0.05em;
  color: #888;
  margin-bottom: 12px;
}

.form-group {
  margin-bottom: 12px;
}

.form-group label {
  display: block;
  font-size: 0.875rem;
  color: #aaa;
  margin-bottom: 4px;
}

.form-group input[type='file'] {
  display: block;
  width: 100%;
  padding: 8px;
  margin-top: 4px;
  background: #0f0f1a;
  border: 1px solid #2a2a4a;
  border-radius: 4px;
  color: #e0e0e0;
  font-size: 0.75rem;
}

.file-name {
  font-size: 0.75rem;
  color: #6a6;
}

.file-name.idx-loaded {
  display: block;
  color: #8af;
  margin-top: 2px;
}

.load-btn {
  width: 100%;
  padding: 10px;
  background: #4a4aff;
  color: white;
  border: none;
  border-radius: 6px;
  font-size: 0.875rem;
  font-weight: 500;
  cursor: pointer;
  transition: background 0.2s;
}

.load-btn:hover:not(:disabled) {
  background: #5a5aff;
}

.load-btn:disabled {
  opacity: 0.6;
  cursor: not-allowed;
}

.reset-btn {
  width: 100%;
  padding: 8px;
  margin-top: 12px;
  background: #3a3a5a;
  color: white;
  border: none;
  border-radius: 6px;
  font-size: 0.8rem;
  cursor: pointer;
  transition: background 0.2s;
}

.reset-btn:hover {
  background: #4a4a6a;
}

.coords {
  margin-top: 12px;
  padding: 8px;
  background: #0f0f1a;
  border-radius: 4px;
  font-family: monospace;
  font-size: 0.8rem;
  display: flex;
  flex-direction: column;
  gap: 4px;
  color: #8f8;
}

.checkbox-label {
  display: flex;
  align-items: center;
  gap: 8px;
  font-size: 0.875rem;
  margin-bottom: 8px;
  cursor: pointer;
}

.checkbox-label input {
  width: 16px;
  height: 16px;
}

.stat {
  display: flex;
  justify-content: space-between;
  font-size: 0.875rem;
  padding: 4px 0;
}

.stat span {
  color: #888;
}

.stat strong {
  color: #fff;
}

.missing-models,
.errors {
  margin-top: 12px;
  padding-top: 12px;
  border-top: 1px solid #2a2a4a;
}

.missing-models h3,
.errors h3 {
  font-size: 0.75rem;
  color: #f80;
  margin-bottom: 8px;
}

.errors h3 {
  color: #f44;
}

.missing-models ul,
.errors ul {
  list-style: none;
  font-size: 0.75rem;
  max-height: 150px;
  overflow-y: auto;
}

.missing-models li {
  padding: 2px 0;
  color: #f80;
  word-break: break-all;
}

.error {
  color: #f44;
  padding: 2px 0;
}

.viewport {
  flex: 1;
  background: #0a0a14;
}

.spawn-info {
  font-size: 0.8rem;
}

.info-row {
  display: flex;
  justify-content: space-between;
  align-items: flex-start;
  padding: 4px 0;
  border-bottom: 1px solid #2a2a4a;
}

.info-row:last-child {
  border-bottom: none;
}

.info-row span {
  color: #888;
}

.info-row strong {
  color: #fff;
  word-break: break-all;
  text-align: right;
  max-width: 180px;
}

.info-row code {
  font-family: monospace;
  color: #8f8;
  background: #0f0f1a;
  padding: 2px 6px;
  border-radius: 3px;
}
</style>
