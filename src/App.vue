<script setup lang="ts">
import { ref, computed } from 'vue'
import SceneRenderer from './components/SceneRenderer.vue'
import { parseVmTile, parseVmTileIdx, parseVmo } from './parsers'
import type {
  VmTile,
  VmTileIdx,
  WorldModel,
  LoadedModel,
  DiagnosticInfo,
} from './types/vmap'

const vmtileFile = ref<File | null>(null)
const vmtileidxFile = ref<File | null>(null)
const vmoFiles = ref<Map<string, File>>(new Map())

const vmtile = ref<VmTile | null>(null)
const vmtileidx = ref<VmTileIdx | null>(null)
const loadedModels = ref<LoadedModel[]>([])

const showPathOnly = ref(true)
const showM2 = ref(true)
const showBoundsOnly = ref(false)

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
  if (input.files && input.files[0]) {
    vmtileFile.value = input.files[0]
  }
}

function onVmtileidxSelect(event: Event) {
  const input = event.target as HTMLInputElement
  if (input.files && input.files[0]) {
    vmtileidxFile.value = input.files[0]
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
  if (!vmtileFile.value) {
    parseErrors.value = ['Please select a .vmtile file']
    return
  }

  isLoading.value = true
  parseErrors.value = []
  loadedModels.value = []

  try {
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
              <input type="file" accept=".vmtile" @change="onVmtileSelect" />
            </label>
            <span v-if="vmtileFile" class="file-name">{{ vmtileFile.name }}</span>
          </div>

          <div class="form-group">
            <label>
              .vmtileidx file (optional)
              <input type="file" accept=".vmtileidx" @change="onVmtileidxSelect" />
            </label>
            <span v-if="vmtileidxFile" class="file-name">{{ vmtileidxFile.name }}</span>
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

          <button class="load-btn" @click="loadAndParse" :disabled="isLoading">
            {{ isLoading ? 'Loading...' : 'Load & Render' }}
          </button>
        </section>

        <section class="panel">
          <h2>Display Options</h2>

          <label class="checkbox-label">
            <input type="checkbox" v-model="showPathOnly" />
            Show Path-Only models
          </label>

          <label class="checkbox-label">
            <input type="checkbox" v-model="showM2" />
            Show M2 models
          </label>

          <label class="checkbox-label">
            <input type="checkbox" v-model="showBoundsOnly" />
            Show bounds only (AABB)
          </label>

          <button class="reset-btn" @click="sceneRef?.resetCamera()">
            Reset Camera
          </button>
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
      </aside>

      <main class="viewport">
        <SceneRenderer
          ref="sceneRef"
          :models="loadedModels"
          :show-path-only="showPathOnly"
          :show-m2="showM2"
          :show-bounds-only="showBoundsOnly"
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
</style>
