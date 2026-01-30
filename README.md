# VMAP Tile Visualizer

Browser-based visualizer for TrinityCore VMAP `.vmtile` files. Renders tile geometry using Three.js.

## Features

- Parse and visualize `.vmtile` files
- Load `.vmo` model files from vmaps folder
- Toggle visibility of Path-Only and M2 models
- Quick AABB bounds view mode
- Diagnostic info: spawn counts, vertices, triangles, missing models

## Installation

```bash
npm install
```

## Development

```bash
npm run dev
```

Open http://localhost:5173 in your browser.

## Production Build

```bash
npm run build
npm run preview
```

## Usage

1. **Select .vmtile file** - Choose the tile file you want to visualize (e.g., `0001_31_27.vmtile`)

2. **Select .vmtileidx file (optional)** - For validation of spawn counts

3. **Select vmaps folder** - Click "vmaps folder" input and select your entire `vmaps` directory. This loads all `.vmo` model files needed for rendering.

4. **Click "Load & Render"** - Parses files and displays the 3D scene

## File Structure Expected

```
vmaps/
├── 0000/
│   ├── 0000_31_27.vmtile
│   └── 0000_31_27.vmtileidx
├── 0001/
│   ├── 0001_31_27.vmtile
│   └── 0001_31_27.vmtileidx
├── world_m2_dungeon_archerbush01.vmo
├── world_m2_dungeon_somemodel.vmo
└── ... (other .vmo files)
```

## Controls

- **Left click + drag** - Rotate camera
- **Right click + drag** - Pan camera
- **Scroll** - Zoom in/out

## Display Options

- **Show Path-Only models** - Toggle visibility of collision-only models (MOD_PATH_ONLY flag)
- **Show M2 models** - Toggle visibility of M2-type models
- **Show bounds only (AABB)** - Display only bounding boxes instead of full geometry (faster)

## Technical Details

### File Formats

- `.vmtile` - Contains model spawn data (position, rotation, scale, model name)
- `.vmtileidx` - Index file for BIH tree lookup (optional for visualization)
- `.vmo` - World model geometry (vertices, triangles)

### Transform Order

Models are transformed using: Scale -> Rotation (ZYX Euler) -> Translation

### Coordinate System

Uses TrinityCore internal VMAP coordinate system. Tile size: 533.33333 units.
