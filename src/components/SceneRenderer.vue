<script setup lang="ts">
import { ref, onMounted, onUnmounted, watch, computed } from 'vue'
import * as THREE from 'three'
import type { LoadedModel, Vec3 } from '../types/vmap'

const props = defineProps<{
  models: LoadedModel[]
  showPathOnly: boolean
  showM2: boolean
  showBoundsOnly: boolean
  showWireframe: boolean
}>()

const containerRef = ref<HTMLDivElement | null>(null)
let scene: THREE.Scene
let camera: THREE.PerspectiveCamera
let renderer: THREE.WebGLRenderer
let animationId: number
let gridHelper: THREE.GridHelper
let axesHelper: THREE.AxesHelper
const meshGroup = new THREE.Group()
const raycaster = new THREE.Raycaster()
const mouse = new THREE.Vector2()

// Camera rotation state (yaw = horizontal, pitch = vertical)
let cameraYaw = Math.PI / 4 // Initial direction
let cameraPitch = -Math.PI / 6 // Looking slightly down
const mouseSensitivity = 0.005

// Map mesh to spawn info for click inspection
const meshToSpawn = new Map<THREE.Object3D, { name: string; position: { x: number; y: number; z: number }; rotation: { x: number; y: number; z: number }; scale: number }>()

const selectedSpawn = ref<{ name: string; position: { x: number; y: number; z: number }; rotation: { x: number; y: number; z: number }; scale: number } | null>(null)

// Keyboard movement state
const keys = {
  forward: false,
  backward: false,
  left: false,
  right: false,
  up: false,
  down: false,
}
const moveSpeed = 0.3

function degToRad(deg: number): number {
  return (deg * Math.PI) / 180
}

function createRotationMatrix(rotation: Vec3): THREE.Matrix4 {
  // TrinityCore uses fromEulerAnglesZYX(iRot.y, iRot.x, iRot.z)
  // which means: Z rotation = iRot.y, Y rotation = iRot.x, X rotation = iRot.z
  const matrix = new THREE.Matrix4()
  const euler = new THREE.Euler(
    degToRad(rotation.z),  // X angle from iRot.z
    degToRad(rotation.x),  // Y angle from iRot.x
    degToRad(rotation.y),  // Z angle from iRot.y
    'ZYX'
  )
  matrix.makeRotationFromEuler(euler)
  return matrix
}

function updateCameraDirection() {
  // Calculate look direction from yaw and pitch
  // Yaw rotates around Z (up), Pitch rotates up/down
  const direction = new THREE.Vector3(
    Math.cos(cameraPitch) * Math.cos(cameraYaw),
    Math.cos(cameraPitch) * Math.sin(cameraYaw),
    Math.sin(cameraPitch)
  )

  const target = camera.position.clone().add(direction)
  camera.lookAt(target)
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
      color: model.isM2 ? 0x66ddaa : 0xccccdd,
      side: THREE.DoubleSide,
      flatShading: true,
      wireframe: props.showWireframe,
      shininess: 50,
      specular: 0x555555,
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

function updateScene(resetCam = true) {
  // Clear existing meshes and spawn map
  meshToSpawn.clear()
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
      if (box) {
        meshGroup.add(box)
        meshToSpawn.set(box, {
          name: spawn.name,
          position: { ...spawn.position },
          rotation: { ...spawn.rotation },
          scale: spawn.scale,
        })
      }
    } else {
      const mesh = createMeshFromModel(loadedModel)
      if (mesh) {
        meshGroup.add(mesh)
        meshToSpawn.set(mesh, {
          name: spawn.name,
          position: { ...spawn.position },
          rotation: { ...spawn.rotation },
          scale: spawn.scale,
        })
      }
    }
  }

  // Center camera and grid on content
  if (resetCam && meshGroup.children.length > 0) {
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
      center.x - maxDim * 0.7,
      center.y - maxDim * 0.7,
      center.z + maxDim * 0.5
    )

    // Point camera towards center
    const dir = center.clone().sub(camera.position).normalize()
    cameraYaw = Math.atan2(dir.y, dir.x)
    cameraPitch = Math.asin(dir.z)
    updateCameraDirection()
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
  if (!camera || !meshGroup) return

  if (meshGroup.children.length > 0) {
    const box = new THREE.Box3().setFromObject(meshGroup)
    const center = box.getCenter(new THREE.Vector3())
    const size = box.getSize(new THREE.Vector3())
    const maxDim = Math.max(size.x, size.y, size.z)

    camera.position.set(
      center.x - maxDim * 0.7,
      center.y - maxDim * 0.7,
      center.z + maxDim * 0.5
    )

    // Point camera towards center
    const dir = center.clone().sub(camera.position).normalize()
    cameraYaw = Math.atan2(dir.y, dir.x)
    cameraPitch = Math.asin(dir.z)
    updateCameraDirection()
  } else {
    camera.position.set(500, -500, 500)
    cameraYaw = Math.PI / 4
    cameraPitch = -Math.PI / 6
    updateCameraDirection()
  }
}

defineExpose({ stats, resetCamera, cameraPosition, selectedSpawn })

// Reset camera when models change
watch(
  () => props.models,
  () => {
    updateScene(true)
  },
  { deep: true }
)

// Don't reset camera for display option changes
watch(
  () => [props.showPathOnly, props.showM2, props.showBoundsOnly, props.showWireframe],
  () => {
    updateScene(false)
  }
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
  updateCameraDirection()

  // Renderer
  renderer = new THREE.WebGLRenderer({ antialias: true })
  renderer.setSize(width, height)
  renderer.setPixelRatio(window.devicePixelRatio)
  containerRef.value.appendChild(renderer.domElement)

  // Lights - multiple sources for better depth perception
  // Hemisphere light for sky/ground ambient (gives different color from above vs below)
  const hemiLight = new THREE.HemisphereLight(0x8888ff, 0x444422, 0.4)
  scene.add(hemiLight)

  // Main directional light (sun)
  const mainLight = new THREE.DirectionalLight(0xffffff, 0.7)
  mainLight.position.set(1000, 1000, 2000)
  scene.add(mainLight)

  // Fill light from opposite side (softer)
  const fillLight = new THREE.DirectionalLight(0x8888aa, 0.3)
  fillLight.position.set(-1000, -1000, 500)
  scene.add(fillLight)

  // Rim light from behind/below for edge definition
  const rimLight = new THREE.DirectionalLight(0xffffaa, 0.2)
  rimLight.position.set(0, 0, -1000)
  scene.add(rimLight)

  // Add fog for depth perception
  scene.fog = new THREE.Fog(0x1a1a2e, 100, 5000)

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

    renderer.render(scene, camera)
  }
  animate()

  // Handle resize, keyboard and mouse
  window.addEventListener('resize', onResize)
  window.addEventListener('keydown', onKeyDown)
  window.addEventListener('keyup', onKeyUp)
  containerRef.value.addEventListener('mousedown', onMouseDown)
  containerRef.value.addEventListener('mouseup', onMouseUp)
  containerRef.value.addEventListener('mousemove', onMouseMove)
  containerRef.value.addEventListener('mouseleave', onMouseUp)
  containerRef.value.addEventListener('click', onClick)
  containerRef.value.addEventListener('wheel', onWheel)
}

function updateMovement() {
  if (!camera) return

  // Get forward direction on XY plane (horizontal movement)
  const forward = new THREE.Vector3(
    Math.cos(cameraYaw),
    Math.sin(cameraYaw),
    0
  )

  // Get right vector (perpendicular to forward on XY plane)
  // cameraYaw - PI/2 points to the right of camera direction
  const right = new THREE.Vector3(
    Math.cos(cameraYaw - Math.PI / 2),
    Math.sin(cameraYaw - Math.PI / 2),
    0
  )

  if (keys.forward) {
    camera.position.addScaledVector(forward, moveSpeed)
  }
  if (keys.backward) {
    camera.position.addScaledVector(forward, -moveSpeed)
  }
  if (keys.left) {
    camera.position.addScaledVector(right, -moveSpeed)
  }
  if (keys.right) {
    camera.position.addScaledVector(right, moveSpeed)
  }
  if (keys.up) {
    camera.position.z += moveSpeed
  }
  if (keys.down) {
    camera.position.z -= moveSpeed
  }
}

function onMouseDown(e: MouseEvent) {
  if (e.button === 0 || e.button === 2) { // Left or right mouse button
    // Request pointer lock for smooth camera control
    containerRef.value?.requestPointerLock()
  }
}

function onMouseUp() {
  // Release pointer lock
  if (document.pointerLockElement === containerRef.value) {
    document.exitPointerLock()
  }
}

function onMouseMove(e: MouseEvent) {
  // Only respond to mouse movement when pointer is locked
  if (document.pointerLockElement !== containerRef.value) return

  // Use movementX/Y for pointer lock (relative movement)
  const deltaX = e.movementX
  const deltaY = e.movementY

  // Update camera angles
  cameraYaw -= deltaX * mouseSensitivity
  cameraPitch -= deltaY * mouseSensitivity

  // Clamp pitch to avoid flipping
  cameraPitch = Math.max(-Math.PI / 2 + 0.01, Math.min(Math.PI / 2 - 0.01, cameraPitch))

  updateCameraDirection()
}

function onWheel(e: WheelEvent) {
  e.preventDefault()

  // Move camera forward/backward based on scroll
  const forward = new THREE.Vector3(
    Math.cos(cameraPitch) * Math.cos(cameraYaw),
    Math.cos(cameraPitch) * Math.sin(cameraYaw),
    Math.sin(cameraPitch)
  )

  const scrollSpeed = moveSpeed * 5
  camera.position.addScaledVector(forward, -e.deltaY * 0.01 * scrollSpeed)
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

function onClick(event: MouseEvent) {
  if (!containerRef.value) return

  const rect = containerRef.value.getBoundingClientRect()
  mouse.x = ((event.clientX - rect.left) / rect.width) * 2 - 1
  mouse.y = -((event.clientY - rect.top) / rect.height) * 2 + 1

  raycaster.setFromCamera(mouse, camera)
  const intersects = raycaster.intersectObjects(meshGroup.children, true)

  if (intersects.length > 0) {
    // Find the top-level object (group) that was clicked
    let obj = intersects[0].object
    while (obj.parent && obj.parent !== meshGroup) {
      obj = obj.parent
    }

    const spawnInfo = meshToSpawn.get(obj)
    if (spawnInfo) {
      selectedSpawn.value = spawnInfo
      console.log('Selected spawn:', spawnInfo)
    }
  } else {
    selectedSpawn.value = null
  }
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
  if (containerRef.value) {
    containerRef.value.removeEventListener('mousedown', onMouseDown)
    containerRef.value.removeEventListener('mouseup', onMouseUp)
    containerRef.value.removeEventListener('mousemove', onMouseMove)
    containerRef.value.removeEventListener('mouseleave', onMouseUp)
    containerRef.value.removeEventListener('click', onClick)
    containerRef.value.removeEventListener('wheel', onWheel)
  }
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
