# Vecto — CLAUDE.md

Vecto is a cross-platform desktop SVG generation + editing app.  
Target: Mac & Windows. Stack: Tauri 2 + React 18 + TypeScript + TailwindCSS 3.

---

## Architecture Principles

### 1. React is the UI shell — NOT the rendering engine

The canvas viewport transform (pan + zoom) is applied **directly to the DOM**
via `CanvasManager.ts`. It never goes through React state. This is non-negotiable
for 60 fps interaction.

```
CanvasManager.applyTransform()
  → this.viewport.style.transform = `translate(...)  scale(...)`
  → zero React re-renders during pan / zoom
```

The Zustand `uiStore.setTransform()` is called **only at the end** of an
interaction (wheel debounce 80 ms, pointerup). It drives the zoom indicator only.

### 2. Single source of truth: VectoDocument

All SVG content lives in `documentStore.document` (a `VectoDocument` tree).
Every edit goes through store actions (Immer + temporal for undo/redo). The
canvas reads from this tree and renders it — it never writes back directly.

### 3. Three Zustand stores — strictly separated

| Store | What it holds | Undo? |
|---|---|---|
| `documentStore` | `VectoDocument`, filePath, isDirty | Yes (zundo, limit 100) |
| `selectionStore` | selectedIds[], hoveredId | No |
| `uiStore` | activeTool, zoom, panX, panY, panel state | No |

### 4. Canvas registry — bounding boxes without React state

`canvasRegistry` (`Map<nodeId, SVGGraphicsElement>`) lets `SelectionOverlay`
call `getBBox()` on real DOM elements without touching React state. Every
`SvgNode` registers itself on mount via a callback ref.

### 5. API key — user-provided via Settings

The user enters their Anthropic API key in the in-app Settings modal.
It is saved to `localStorage` via `settingsStore` (Zustand persist middleware)
and passed to the `generate_svg` Rust command as a parameter at call time.
Rust never stores the key to disk — it uses it for the single request and discards it.

The key is **never** hard-coded or read from environment variables.

---

## File Map

```
src/
├── types/svg.ts                   Core VectoDocument / VectoNode types
├── store/
│   ├── documentStore.ts           SVG document tree + undo/redo
│   ├── selectionStore.ts          Selected / hovered element IDs
│   └── uiStore.ts                 Tool, zoom, panel state
├── lib/
│   ├── svgParser.ts               SVG string → VectoDocument
│   ├── svgSerializer.ts           VectoDocument → SVG string
│   ├── canvasRegistry.ts          nodeId → SVGGraphicsElement map
│   └── utils.ts                   cn(), nodeIcon()
├── components/
│   ├── canvas/
│   │   ├── CanvasManager.ts       CSS transform owner (no React)
│   │   ├── Canvas.tsx             React shell, pointer routing
│   │   ├── SvgDocument.tsx        Renders VectoNode tree as SVG
│   │   └── SelectionOverlay.tsx   getBBox-based selection rects
│   ├── toolbar/Toolbar.tsx        Tools + file actions
│   ├── sidebar/
│   │   ├── LayerPanel.tsx         Layer tree
│   │   ├── LayerNode.tsx          Individual layer row
│   │   └── PropertiesPanel.tsx    Attribute editor for selected node
│   └── prompt/PromptBar.tsx       AI generation input
├── hooks/useKeyboardShortcuts.ts  V/H/Delete/Esc/⌘Z
└── app/App.tsx                    Root layout

src-tauri/
├── src/
│   ├── main.rs                    Entry point
│   ├── lib.rs                     Plugin + handler registration
│   └── commands/
│       ├── mod.rs
│       ├── ai.rs                  generate_svg (Claude API — currently mocked)
│       └── fs_commands.rs         open_svg_file / save_svg_file
├── tauri.conf.json
└── capabilities/default.json
```

---

## Keyboard Shortcuts

| Key | Action |
|---|---|
| `V` | Select tool |
| `H` | Pan tool |
| `Delete` / `Backspace` | Delete selected nodes |
| `Escape` | Clear selection |
| `⌘Z` / `Ctrl+Z` | Undo |
| `⌘⇧Z` / `Ctrl+⇧Z` | Redo |
| `⌘O` / `Ctrl+O` | Open file (Toolbar) |
| `⌘S` / `Ctrl+S` | Save file (Toolbar) |
| Scroll | Pan canvas |
| `⌘`+Scroll / Pinch | Zoom canvas |

---

## Design System (Dark)

| Token | Value |
|---|---|
| canvas bg | `#141414` |
| panel bg | `#1e1e1e` |
| surface | `#2a2a2a` |
| border | `#333333` |
| text primary | `#e5e5e5` |
| text secondary | `#888888` |
| text muted | `#555555` |
| accent | `#0ea5e9` |
| danger | `#ef4444` |

All tokens are in `tailwind.config.js` as custom colors. Use them via
`bg-panel`, `text-text-secondary`, `border-border`, etc.

---

## Running the App

```bash
# Install dependencies
npm install

# Dev mode (hot reload)
npm run tauri dev

# Production build
npm run tauri build
```

Open the app, click the ⚙ icon in the toolbar (or "Set API key" in the prompt bar),
and enter your Anthropic API key. It is saved to localStorage and never leaves
the machine.

---

## MVP Milestone 1 — Checklist

- [x] Project bootstrapped (Tauri 2 + React + TypeScript + Tailwind)
- [x] 3-panel layout (layers | canvas | properties) + toolbar + prompt bar
- [x] SVG parser (`parseSVG`) — SVG string → `VectoDocument`
- [x] SVG serializer (`serializeDocument`) — `VectoDocument` → SVG string
- [x] Canvas renders `VectoDocument` as real SVG DOM (not raster)
- [x] Pan (scroll or pan tool) — CSS transform, zero re-renders
- [x] Zoom (⌘+scroll / pinch) — toward cursor, 60 fps
- [x] Fit-to-view on document load
- [x] Click element → selects in canvas + layer panel synced
- [x] Shift-click → multi-select
- [x] Selection overlay (bounding box + corner handles)
- [x] Layer panel — tree with expand/collapse, visibility, lock toggle
- [x] Properties panel — attribute editing (fill, stroke, etc.)
- [x] File open (Tauri dialog → read → parse → render)
- [x] File save + Save As (serialize → write)
- [x] Upload SVG → same editing experience as generated SVG
- [x] Keyboard shortcuts (V, H, Delete, Esc, ⌘Z, ⌘⇧Z)
- [x] Undo/redo (zundo temporal middleware, 100 steps)
- [x] AI generation (mocked — real Claude API stub in `ai.rs`)
- [ ] Real Claude API integration (uncomment stub in `ai.rs`, set env key)
- [ ] Transform handles (move/resize by dragging handles on canvas)
- [ ] Export to PNG

---

## Next Milestones

**Milestone 2 — Editing**
- Drag to move selected elements (pointermove → attribute update)
- Resize via corner handles
- Group/ungroup (`<g>`)

**Milestone 3 — Real AI**
- Wire up Claude API in `ai.rs`
- Prompt engineering for clean SVG output
- Streaming response (show partial SVG as it generates)

**Milestone 4 — Export**
- PNG export via `resvg` Rust crate
- SVG copy to clipboard

**Milestone 5 — Plugin system**
- Define plugin API surface (which store actions are public)
- Rust-side plugin host
