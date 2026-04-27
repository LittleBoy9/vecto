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
  → this.viewport.style.transform = `translate(px, py)`   ← pan only
  → zoom is expressed as SVG width/height (vb.width * zoom)
  → zero React re-renders during pan / zoom
```

**Critical zoom rule:** zoom is applied as explicit `width`/`height` on the `<svg>` element
(`vb.width * zoom`, `vb.height * zoom`), NOT via CSS `scale()`. CSS scale rasterizes the
SVG into a GPU texture at the original size → pixelation at high zoom. SVG dimensions
force a fresh vector render at the correct resolution.

The Zustand `uiStore.setTransform()` is called **only at the end** of an
interaction (wheel debounce 80 ms, pointerup). It drives the zoom indicator only.

**Never add `willChange: transform`** to the viewport — it rasterizes the SVG.

### 2. Single source of truth: VectoDocument

All SVG content lives in `documentStore.document` (a `VectoDocument` tree).
Every edit goes through store actions (Immer + temporal for undo/redo). The
canvas reads from this tree and renders it — it never writes back directly.

### 3. Four Zustand stores — strictly separated

| Store | What it holds | Undo? |
|---|---|---|
| `documentStore` | `VectoDocument`, filePath, isDirty | Yes (zundo, limit 100) |
| `selectionStore` | selectedIds[], hoveredId | No |
| `uiStore` | activeTool, zoom, panX, panY, panel state | No |
| `pathEditStore` | editingElementId, selectedNodeIds | No |

`settingsStore` (persisted) holds the Anthropic API key in localStorage.

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

### 6. Artboard shadow div must have pointer-events-none

The shadow `<div className="absolute inset-0">` inside the artboard is positioned,
so it sits above in-flow SVG elements in the browser's hit-test stack. Without
`pointer-events-none` it silently swallows all clicks, preventing canvas element
selection. It must always have `pointer-events-none`.

### 7. Path editing — temporal pause during drag

When dragging path nodes/handles in `PathEditOverlay`, the undo temporal middleware
is paused at drag start and resumed on pointerup:
```typescript
useDocumentStore.temporal.getState().pause();  // drag start
// ... many pointermove updates ...
useDocumentStore.temporal.getState().resume(); // drag end → one undo step
```
This keeps the full drag as a single undo entry instead of hundreds.

---

## File Map

```
src/
├── types/svg.ts                   Core VectoDocument / VectoNode types
│                                  VectoNode has rawContent?: string for text elements
├── store/
│   ├── documentStore.ts           SVG document tree + undo/redo (Immer + zundo)
│   ├── selectionStore.ts          Selected / hovered element IDs
│   ├── uiStore.ts                 Tool ("select"|"pan"|"nodeEdit"), zoom, panel state
│   ├── pathEditStore.ts           Path node editor state (editingElementId, selectedNodeIds)
│   └── settingsStore.ts           API key (localStorage persist)
├── lib/
│   ├── svgParser.ts               SVG string → VectoDocument
│   │                              TEXT_CONTENT_TAGS capture el.innerHTML as rawContent
│   ├── svgSerializer.ts           VectoDocument → SVG string
│   ├── pathParser.ts              SVG d attr ↔ PathContour[]/AnchorNode[]
│   │                              parsePath(d) / serializePath(contours)
│   ├── canvasRegistry.ts          nodeId → SVGGraphicsElement map
│   └── utils.ts                   cn(), nodeIcon(), colorToHex()
├── components/
│   ├── canvas/
│   │   ├── CanvasManager.ts       CSS translate owner (no React); wheel → zoom/pan
│   │   ├── Canvas.tsx             React shell, pointer routing, mounts overlays
│   │   ├── SvgDocument.tsx        Renders VectoNode tree as SVG
│   │   │                          Double-click path → nodeEdit; double-click text → focus textarea
│   │   ├── SelectionOverlay.tsx   getBBox-based selection rects (hidden in nodeEdit mode)
│   │   └── PathEditOverlay.tsx    Path node editor — anchor squares + bezier handle circles
│   ├── toolbar/Toolbar.tsx        Tools (V/H/N) + file actions + undo/redo
│   ├── sidebar/
│   │   ├── LayerPanel.tsx         Resizable layer tree (drag handle on right edge)
│   │   ├── LayerNode.tsx          Individual layer row — bidirectional hover sync
│   │   └── PropertiesPanel.tsx    Attribute editor; text content live editing (onChange)
│   │                              Label column is w-20 to fit long attribute names
│   └── prompt/PromptBar.tsx       2-row textarea, char counter, expand modal
├── hooks/useKeyboardShortcuts.ts  V/H/N/Delete/Esc/⌘Z
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
| `N` | Node edit tool (path editing) |
| `Delete` / `Backspace` | Delete selected nodes |
| `Escape` | In nodeEdit: exit to select. Otherwise: clear selection |
| `⌘Z` / `Ctrl+Z` | Undo |
| `⌘⇧Z` / `Ctrl+⇧Z` | Redo |
| `⌘O` / `Ctrl+O` | Open file |
| `⌘S` / `Ctrl+S` | Save file |
| Scroll | Pan canvas |
| `⌘`+Scroll / Pinch | Zoom canvas |
| Double-click `<path>` | Enter node edit mode for that path |
| Double-click `<text>` | Focus text content editor in Properties panel |

---

## Path Node Editor

When `activeTool === "nodeEdit"`:
- `SelectionOverlay` is hidden; `PathEditOverlay` takes over
- Cursor is `crosshair` on canvas
- The overlay renders anchor point squares and bezier handle circles
- Clicking blank canvas → exits node edit, returns to select
- All node sizes (anchors, handles, strokes) are divided by zoom to stay constant on screen
- `pathEditStore.editingElementId` holds the VectoNode ID of the path being edited
- Only `<path>` elements (with a `d` attribute) support node editing

### Path data flow
```
VectoNode.attributes.d
  → parsePath(d) → PathContour[]   (on mount / d-change)
  → drag interaction mutates working copy
  → serializePath(contours) → new d string
  → documentStore.updateNodeAttributes(id, { d })
```

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

## Milestone Checklist

### Milestone 1 — Foundation ✅
- [x] Project bootstrapped (Tauri 2 + React + TypeScript + Tailwind)
- [x] 3-panel layout (layers | canvas | properties) + toolbar + prompt bar
- [x] SVG parser (`parseSVG`) — SVG string → `VectoDocument`
- [x] SVG serializer (`serializeDocument`) — `VectoDocument` → SVG string
- [x] Canvas renders `VectoDocument` as real SVG DOM (not raster)
- [x] Pan (scroll or pan tool) — CSS transform, zero re-renders
- [x] Zoom (⌘+scroll / pinch) — toward cursor, 60 fps, crisp at any zoom (SVG dimensions)
- [x] Fit-to-view on document load
- [x] Click element on canvas → selects (shadow div bug fixed with pointer-events-none)
- [x] Shift-click → multi-select
- [x] Bidirectional hover (canvas ↔ layer panel)
- [x] Selection overlay (bounding box + corner handles, zoom-aware sizes)
- [x] Layer panel — resizable, tree with expand/collapse, visibility, lock toggle
- [x] Properties panel — resizable, attribute editing, hex colors, w-20 label column
- [x] Text element rendering (rawContent / dangerouslySetInnerHTML)
- [x] Text content editing — live onChange in Properties panel, double-click to focus
- [x] File open (Tauri dialog → read → parse → render)
- [x] File save + Save As (serialize → write)
- [x] Keyboard shortcuts (V, H, N, Delete, Esc, ⌘Z, ⌘⇧Z)
- [x] Undo/redo (zundo temporal middleware, 100 steps)
- [x] AI generation (real Claude API — `generate_svg` in `ai.rs`)
- [x] Prompt bar — 2-row, char counter, expand modal

### Milestone 2 — Path Editing ✅
- [x] `pathParser.ts` — full SVG `d` parser (M L H V C S Q T A Z + relative variants)
- [x] `pathEditStore` — editing state
- [x] `PathEditOverlay` — interactive anchor + handle editor
- [x] Node edit tool (`N` key, toolbar button `◈`)
- [x] Double-click path → enter node edit mode
- [x] Drag anchors (moves anchor + both handles together)
- [x] Drag bezier handles (smooth nodes mirror opposite handle)
- [x] Live `d` attribute update during drag
- [x] Single undo step per drag (temporal pause/resume)
- [x] Escape exits node edit, returns to select tool
- [x] Delete selected anchor nodes (Delete/Backspace in nodeEdit mode)
- [x] Insert node by clicking on a path segment (De Casteljau split at projected t)
- [x] Smooth ↔ corner node toggle (double-click anchor; diamond = smooth, square = corner)

### Milestone 3 — Transform Handles ✅
- [x] Drag to move selected elements (prepend translate to existing transform)
- [x] Resize via corner handles (scale around opposite pivot corner)
- [x] Works for multi-element selection (union bbox)
- [x] Transform consolidated to single matrix on drag end
- [x] Single undo step per drag (temporal pause/resume)

### Milestone 4 — Real AI ✅
- [x] Wire up Claude API in `ai.rs` (model: claude-sonnet-4-6, max_tokens: 8000)
- [x] Prompt engineering for clean SVG output (12-rule system prompt, presentation attrs only, no CSS)
- [x] Robust SVG extraction (`extract_svg` strips markdown fences, finds `<svg…</svg>` block)
- [x] Streaming response — SSE via `generate_svg_stream`; partial SVG rendered live every 100 ms; single undo entry on completion

### Milestone 5 — Export ✅
- [x] PNG export via `resvg` Rust crate (2× retina by default, max 16 384 px)
- [x] SVG copy to clipboard (`navigator.clipboard.writeText`)
- [x] Export buttons in toolbar: "Copy SVG" + "Export PNG"
- [x] `src-tauri/src/commands/export.rs` — `export_png(svg_content, path, scale)`
- [x] System font loading so `<text>` elements render correctly in PNG

### Milestone 6 — Drawing Tools ✅
- [x] Rectangle tool (R) — drag to draw, click for 100×100 default, Shift = square
- [x] Ellipse tool (E) — drag to draw, click for circle default, Shift = circle
- [x] Line tool (L) — drag to draw
- [x] Pen tool (P) — click to add points, double-click / Enter to finish open path, click start point to close
- [x] Live dashed preview during drag (zoom-aware stroke width)
- [x] Auto-creates blank 800×600 document if nothing is open
- [x] After commit: switches back to select tool, selects new element
- [x] Escape cancels drawing; R/E/L/P keyboard shortcuts
- [x] `documentStore.addNode` action for appending new nodes
- [x] `DrawOverlay.tsx` — overlay SVG in document-space coordinates

### Milestone 7 — Plugin system
- [ ] Define plugin API surface (which store actions are public)
- [ ] Rust-side plugin host
