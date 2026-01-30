<script setup lang="ts">
import { ref, onMounted, onUnmounted, watch, computed } from 'vue'
import * as THREE from 'three'
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js'
import type { LoadedModel, Vec3 } from '../types/vmap'

const props = defineProps<{
  models: LoadedModel[]
  showPathOnly: boolean
  showM2: boolean
  showBoundsOnly: boolean
}>()

const containerRef = ref<HTMLDivElement | null>(null)
let scene: THREE.Scene
let camera: THREE.PerspectiveCamera
let renderer: THREE.WebGLRenderer
let controls: OrbitControls
let animationId: number
let gridHelper: THREE.GridHelper
let axesHelper: THREE.AxesHelper
const meshGroup = new THREE.Group()

// Keyboard movement state
const keys = {
  forward: false,
  backward: false,
  left: false,
  right: false,
  up: false,
  down: false,
}
const moveSpeed = 5

function degToRad(deg: number): number {
  return (deg * Math.PI) / 180
}

function createRotationMatrix(rotation: Vec3): THREE.Matrix4 {
  // ZYX order as per TrinityCore
  const matrix = new THREE.Matrix4()
  const euler = new THREE.Euler(
    degToRad(rotation.x),
    degToRad(rotation.y),
    degToRad(rotation.z),
    'ZYX'
  )
  matrix.makeRotationFromEuler(euler)
  return matrix
}

function createMeshFromModel(loadedModel: LoadedModel): THREE.Object3D | null {
  const { spawn, model } = loadedModel

  if (!model) return null

  const group = new THREE.Group()

  for (const groupModel of model.groups) {
    if (groupModel.vertices.length === 0 || groupModel.indices.length === 0) {
      continue
    }

    const geometry = new THREE.BufferGeometry()
    geometry.setAttribute(
      'position',
      new THREE.BufferAttribute(groupModel.vertices, 3)
    )
    geometry.setIndex(new THREE.BufferAttribute(groupModel.indices, 1))
    geometry.computeVertexNormals()

    const material = new THREE.MeshPhongMaterial({
      color: model.isM2 ? 0x44aa88 : 0x8888ff,
      side: THREE.DoubleSide,
      flatShading: true,
    })

    const mesh = new THREE.Mesh(geometry, material)
    group.add(mesh)
  }

  // Apply transform: scale, rotation, translation
  group.scale.setScalar(spawn.scale)

  const rotMatrix = createRotationMatrix(spawn.rotation)
  group.setRotationFromMatrix(rotMatrix)

  group.position.set(spawn.position.x, spawn.position.y, spawn.position.z)

  return group
}

function createBoundingBox(loadedModel: LoadedModel): THREE.Object3D | null {
  const { spawn } = loadedModel

  if (!spawn.bound) return null

  const size = new THREE.Vector3(
    spawn.bound.high.x - spawn.bound.low.x,
    spawn.bound.high.y - spawn.bound.low.y,
    spawn.bound.high.z - spawn.bound.low.z
  )

  const center = new THREE.Vector3(
    (spawn.bound.low.x + spawn.bound.high.x) / 2,
    (spawn.bound.low.y + spawn.bound.high.y) / 2,
    (spawn.bound.low.z + spawn.bound.high.z) / 2
  )

  const geometry = new THREE.BoxGeometry(size.x, size.y, size.z)
  const material = new THREE.MeshBasicMaterial({
    color: spawn.isPathOnly ? 0xff8800 : 0x00ff00,
    wireframe: true,
  })

  const mesh = new THREE.Mesh(geometry, material)
  mesh.position.copy(center)

  return mesh
}

function updateScene() {
  // Clear existing meshes
  while (meshGroup.children.length > 0) {
    const child = meshGroup.children[0]
    meshGroup.remove(child)
    if (child instanceof THREE.Mesh) {
      child.geometry.dispose()
      if (Array.isArray(child.material)) {
        child.material.forEach((m) => m.dispose())
      } else {
        child.material.dispose()
      }
    }
  }

  // Add models
  for (const loadedModel of props.models) {
    const { spawn, model } = loadedModel

    // Filter based on toggles
    if (spawn.isPathOnly && !props.showPathOnly) continue
    if (model?.isM2 && !props.showM2) continue

    if (props.showBoundsOnly) {
      const box = createBoundingBox(loadedModel)
      if (box) meshGroup.add(box)
    } else {
      const mesh = createMeshFromModel(loadedModel)
      if (mesh) meshGroup.add(mesh)
    }
  }

  // Center camera and grid on content
  if (meshGroup.children.length > 0) {
    const box = new THREE.Box3().setFromObject(meshGroup)
    const center = box.getCenter(new THREE.Vector3())
    const size = box.getSize(new THREE.Vector3())
    const maxDim = Math.max(size.x, size.y, size.z)

    // Move grid and axes to model center
    if (gridHelper) {
      gridHelper.position.set(center.x, center.y, box.min.z)
    }
    if (axesHelper) {
      axesHelper.position.set(center.x, center.y, box.min.z)
    }

    camera.position.set(
      center.x + maxDim * 0.7,
      center.y - maxDim * 0.7,
      center.z + maxDim * 0.5
    )
    controls.target.copy(center)
    controls.update()
  }
}

const cameraPosition = ref({ x: 0, y: 0, z: 0 })

const stats = computed(() => {
  let triangles = 0
  let vertices = 0

  for (const lm of props.models) {
    if (!lm.model) continue
    for (const g of lm.model.groups) {
      vertices += g.vertices.length / 3
      triangles += g.indices.length / 3
    }
  }

  return { triangles, vertices }
})

function resetCamera() {
  if (!camera || !controls || !meshGroup) return

  if (meshGroup.children.length > 0) {
    const box = new THREE.Box3().setFromObject(meshGroup)
    const center = box.getCenter(new THREE.Vector3())
    const size = box.getSize(new THREE.Vector3())
    const maxDim = Math.max(size.x, size.y, size.z)

    camera.position.set(
      center.x + maxDim * 0.7,
      center.y - maxDim * 0.7,
      center.z + maxDim * 0.5
    )
    controls.target.copy(center)
    controls.update()
  } else {
    camera.position.set(500, -500, 500)
    controls.target.set(0, 0, 0)
    controls.update()
  }
}

defineExpose({ stats, resetCamera, cameraPosition })

watch(
  () => [props.models, props.showPathOnly, props.showM2, props.showBoundsOnly],
  () => {
    updateScene()
  },
  { deep: true }
)

function initScene() {
  if (!containerRef.value) return

  // Scene
  scene = new THREE.Scene()
  scene.background = new THREE.Color(0x1a1a2e)

  // Camera - Z is up in WoW/TrinityCore
  const width = containerRef.value.clientWidth
  const height = containerRef.value.clientHeight
  camera = new THREE.PerspectiveCamera(60, width / height, 0.1, 100000)
  camera.up.set(0, 0, 1) // Z is up
  camera.position.set(500, -500, 500)

  // Renderer
  renderer = new THREE.WebGLRenderer({ antialias: true })
  renderer.setSize(width, height)
  renderer.setPixelRatio(window.devicePixelRatio)
  containerRef.value.appendChild(renderer.domElement)

  // Controls
  controls = new OrbitControls(camera, renderer.domElement)
  controls.enableDamping = true
  controls.dampingFactor = 0.05

  // Lights
  const ambientLight = new THREE.AmbientLight(0xffffff, 0.5)
  scene.add(ambientLight)

  const directionalLight = new THREE.DirectionalLight(0xffffff, 0.8)
  directionalLight.position.set(1000, 1000, 1000)
  scene.add(directionalLight)

  // Grid on XY plane (Z is up)
  const gridSize = 10000
  const gridDivisions = 100
  gridHelper = new THREE.GridHelper(gridSize, gridDivisions, 0x444444, 0x222222)
  gridHelper.rotation.x = -Math.PI / 2 // Rotate to XY plane
  scene.add(gridHelper)

  // Axes
  axesHelper = new THREE.AxesHelper(500)
  scene.add(axesHelper)

  // Add mesh group
  scene.add(meshGroup)

  // Animation loop
  function animate() {
    animationId = requestAnimationFrame(animate)

    // Handle keyboard movement
    updateMovement()

    // Update camera position for display
    if (camera) {
      cameraPosition.value = {
        x: Math.round(camera.position.x * 100) / 100,
        y: Math.round(camera.position.y * 100) / 100,
        z: Math.round(camera.position.z * 100) / 100,
      }
    }

    controls.update()
    renderer.render(scene, camera)
  }
  animate()

  // Handle resize and keyboard
  window.addEventListener('resize', onResize)
  window.addEventListener('keydown', onKeyDown)
  window.addEventListener('keyup', onKeyUp)
}

function updateMovement() {
  if (!camera || !controls) return

  const direction = new THREE.Vector3()
  camera.getWorldDirection(direction)

  // Get right vector (perpendicular to direction on XY plane)
  const right = new THREE.Vector3(-direction.y, direction.x, 0).normalize()

  // Forward/backward (in camera direction on XY plane)
  const forward = new THREE.Vector3(direction.x, direction.y, 0).normalize()

  if (keys.forward) {
    camera.position.addScaledVector(forward, moveSpeed)
    controls.target.addScaledVector(forward, moveSpeed)
  }
  if (keys.backward) {
    camera.position.addScaledVector(forward, -moveSpeed)
    controls.target.addScaledVector(forward, -moveSpeed)
  }
  if (keys.left) {
    camera.position.addScaledVector(right, moveSpeed)
    controls.target.addScaledVector(right, moveSpeed)
  }
  if (keys.right) {
    camera.position.addScaledVector(right, -moveSpeed)
    controls.target.addScaledVector(right, -moveSpeed)
  }
  if (keys.up) {
    camera.position.z += moveSpeed
    controls.target.z += moveSpeed
  }
  if (keys.down) {
    camera.position.z -= moveSpeed
    controls.target.z -= moveSpeed
  }
}

function onKeyDown(e: KeyboardEvent) {
  switch (e.code) {
    case 'KeyW':
    case 'ArrowUp':
      keys.forward = true
      break
    case 'KeyS':
    case 'ArrowDown':
      keys.backward = true
      break
    case 'KeyA':
    case 'ArrowLeft':
      keys.left = true
      break
    case 'KeyD':
    case 'ArrowRight':
      keys.right = true
      break
    case 'Space':
      keys.up = true
      break
    case 'KeyX':
      keys.down = true
      break
  }
}

function onKeyUp(e: KeyboardEvent) {
  switch (e.code) {
    case 'KeyW':
    case 'ArrowUp':
      keys.forward = false
      break
    case 'KeyS':
    case 'ArrowDown':
      keys.backward = false
      break
    case 'KeyA':
    case 'ArrowLeft':
      keys.left = false
      break
    case 'KeyD':
    case 'ArrowRight':
      keys.right = false
      break
    case 'Space':
      keys.up = false
      break
    case 'KeyX':
      keys.down = false
      break
  }
}

function onResize() {
  if (!containerRef.value) return
  const width = containerRef.value.clientWidth
  const height = containerRef.value.clientHeight
  camera.aspect = width / height
  camera.updateProjectionMatrix()
  renderer.setSize(width, height)
}

onMounted(() => {
  initScene()
  updateScene()
})

onUnmounted(() => {
  cancelAnimationFrame(animationId)
  window.removeEventListener('resize', onResize)
  window.removeEventListener('keydown', onKeyDown)
  window.removeEventListener('keyup', onKeyUp)
  renderer?.dispose()
})
</script>

<template>
  <div ref="containerRef" class="scene-container"></div>
</template>

<style scoped>
.scene-container {
  width: 100%;
  height: 100%;
  min-height: 400px;
}
</style>
