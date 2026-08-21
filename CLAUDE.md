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

### 5b. SVG import safety

Untrusted SVG (files, drag-drop, AI output, traced images) is XSS-risky because
`rawDefs`/`rawContent` are injected via `dangerouslySetInnerHTML`. `parseSVG` runs
`sanitizeSvgDom` on the parsed DOM **before** reading any attribute or innerHTML —
it removes `<script>`/`<foreignObject>` subtrees, all `on*` event-handler
attributes, and any URL whose scheme is not allowlisted. URL checking strips
control characters first and then **allowlists** schemes (http/https/mailto/tel,
plus raster `data:image/*`): browsers strip tab/newline/CR from URLs before
resolving the scheme, so a denylist like `/^\s*javascript:/` is defeated by
`java&#10;script:`. `data:image/svg+xml` is rejected — it can carry its own script.
Text typed into the Properties panel is XML-escaped before it reaches
`rawContent`, which is injected as markup. Defense-in-depth: `tauri.conf.json` now sets a
strict CSP (`script-src 'self'`, no inline scripts in prod); `devCsp` loosens it for
Vite HMR only. Do not reintroduce `csp: null` or inline `<script>` in index.html.

### 6. Artboard shadow div must have pointer-events-none

The shadow `<div className="absolute inset-0">` inside the artboard is positioned,
so it sits above in-flow SVG elements in the browser's hit-test stack. Without
`pointer-events-none` it silently swallows all clicks, preventing canvas element
selection. It must always have `pointer-events-none`.

### 7. Undo batching — collapse a burst of edits into one step

Drags, streamed AI generations, and per-keystroke text edits each fire many
`set()` calls but should be **one** undo entry. Use the shared helpers in
`documentStore.ts` rather than poking zundo internals inline:
```typescript
import { beginUndoBatch, endUndoBatch } from "../store/documentStore";

beginUndoBatch();   // snapshot current doc into history, then pause()
// ... many pointermove / streamed / keystroke updates ...
endUndoBatch();     // resume() → the whole burst is a single undo step
```
`beginUndoBatch()` must snapshot **before** pausing — `resume()` alone does not
create a history entry. Call sites: `SelectionOverlay` (move/resize/rotate),
`PathEditOverlay` (node drag), `PromptBar` (AI generation), `PropertiesPanel`
(text content edit). Single store actions (`duplicateNodes`, `reorderNodes`,
`nudgeNodes`, etc.) are already one `set()` → one step, so they don't batch.

**Batches are depth-counted.** A bare `pause()`/`resume()` pair is unsafe here: an
unmatched `begin` — an interrupted drag, a component unmounting mid-edit — used to
leave the temporal store paused *forever*, silently dropping every later edit from
history. Undo looked enabled but recorded nothing for the rest of the session.
- In components, prefer the `useUndoBatch()` hook over calling begin/end directly:
  it makes `begin` idempotent and closes the batch automatically on unmount.
- Drag surfaces must handle `onPointerCancel` **and** `onLostPointerCapture`, not
  just `onPointerUp` — a cancelled drag never reaches pointerup.
- Anything dragging without pointer capture (e.g. a range input) must close its
  batch from a **window**-level pointerup listener; releasing outside the window
  never fires the element's own handler.
- `resetUndoBatch()` force-closes any depth as a last-resort recovery.

---

### 8. Releases are triggered by the version field, not by pushing

`npm run release:*` bumps `tauri.conf.json`, `package.json` and `Cargo.toml`
together; pushing to `main` with a changed version tags, builds four installers,
and publishes. Pushing without a version change just runs tests.

The release workflow is split into gate → build → publish **on purpose**. If every
matrix job publishes to the release itself, each generates its own `latest.json`
and they race — the last writer wins and the other platforms disappear from the
manifest, leaving installers attached to a release whose updater endpoint 404s.
So: exactly one job writes the manifest, and it runs only after all four builds
succeed. Never move manifest generation into the matrix.

Auto-update is **consent-first**. Vecto holds unsaved artwork behind `isDirty`,
so nothing downloads or relaunches unasked, and the restart path writes a
crash-recovery snapshot first. See [RELEASING.md](RELEASING.md).

`landing.html` deploys separately to GitHub Pages (`.github/workflows/pages.yml`)
on any push to main that touches it. The absolute URLs in the page are rewritten
at build time to wherever the site is actually served — do not hardcode a domain
the repo does not control, or canonical will point search engines away from the
real page.

---

## File Map

```
src/
├── types/svg.ts                   Core VectoDocument / VectoNode types
│                                  VectoNode has rawContent?: string for text elements
│                                  VectoGradient/GradientStop + VectoFilter; document.gradients[]/filters[]
├── store/
│   ├── documentStore.ts           SVG document tree + undo/redo (Immer + zundo)
│   │                              add/duplicate/group/ungroup/reorder/nudge/moveNode actions
│   │                              prependTransforms (align/flip) · replaceNodes (AI edit)
│   │                              gradient actions: add/update/remove/addGradients/upsertGradients
│   │                              beginUndoBatch()/endUndoBatch() collapse a burst to 1 undo step
│   ├── selectionStore.ts          Selected / hovered element IDs
│   ├── uiStore.ts                 Tool (select|pan|nodeEdit|rect|ellipse|line|pen|text), zoom, panels
│   │                              rulersVisible + guides[] (ruler guides)
│   ├── pathEditStore.ts           Path node editor state (editingElementId, selectedNodeIds)
│   ├── settingsStore.ts           API key + selected model per provider (persist)
│   │                              activeKey()/activeModel(); PROVIDER_MODELS preset lists
│   ├── themeStore.ts              "dark" | "light" theme (persist); toggles .light/.dark on <html>
│   ├── contextMenuStore.ts        Right-click menu state (open/x/y/items)
│   ├── panelStore.ts              Persisted left/right panel widths (vecto-panels)
│   ├── recentStore.ts             Recent file paths (persist, vecto-recent)
│   └── updateStore.ts             Auto-update phase/progress/dismissed versions
├── lib/
│   ├── svgParser.ts               SVG string → VectoDocument
│   │                              sanitizeSvgDom strips <script>/<foreignObject>/on*/javascript: on import
│   │                              TEXT_CONTENT_TAGS capture el.innerHTML as rawContent
│   │                              gradients + effect filters parsed out of <defs>
│   ├── svgSerializer.ts           VectoDocument → SVG string (gradients + filters + rawDefs → <defs>)
│   │                              serializeFragment auto-includes the defs its nodes reference
│   ├── pathParser.ts              SVG d attr ↔ PathContour[]/AnchorNode[]
│   │                              parsePath(d) / serializePath(contours)
│   │                              arcs (A) decomposed to cubic béziers on parse
│   ├── canvasRegistry.ts          nodeId → SVGGraphicsElement map
│   ├── nodeUtils.ts               cloneWithFreshIds / findNode / findParentList / containsId
│   │                              cloneNodesWithDefs (clone + gradient/filter ref remap)
│   ├── clipboard.ts               in-memory copy/cut/paste buffer (nodes + referenced gradients)
│   ├── bbox.ts                    getDocBBox / unionDocBBox / rectsIntersect (transform-aware)
│   ├── svgExtract.ts              extractSvg / extractPartialSvg (pull <svg> from model output)
│   ├── color.ts                   hex↔rgb↔hsv conversions + recent-colors buffer
│   ├── editActions.ts             duplicate/copy/cut/paste/group/reorder/convert/boolean (keys + menu)
│   ├── shapeToPath.ts             rect/circle/ellipse/line/poly → path `d` (+ GEOMETRY_KEYS)
│   ├── boolean.ts                 union/subtract/intersect/exclude (polygon-clipping; curves flattened)
│   ├── gradient.ts                make/angle/preview helpers for linear & radial gradients
│   ├── effects.ts                 makeFilter / newFilterId (drop-shadow & blur defaults)
│   ├── canvasController.ts        imperative bridge: fitToView / zoomToSelection (keys → Canvas)
│   ├── fileController.ts         imperative bridge: open / save / saveAs (keys → Toolbar)
│   ├── aiEdit.ts                  runAiEdit(nodeIds, instruction) — 1:1 in-place edit/recolor stream
│   ├── recovery.ts                localStorage crash-recovery snapshot (save/load/clear)
│   ├── updater.ts                 Consent-first auto-update: check/download/install
│   │                              Writes a recovery snapshot before relaunching
│   └── utils.ts                   cn(), nodeIcon(), colorToHex()
├── components/
│   ├── canvas/
│   │   ├── CanvasManager.ts       CSS translate owner (no React); wheel → zoom/pan
│   │   │                          onViewportChange (every frame) + fitRect + zoomTo(z)
│   │   ├── Canvas.tsx             React shell, pointer routing, overlays + rulers + zoom control
│   │   ├── Rulers.tsx             Canvas-drawn top/left rulers; drag out guides
│   │   ├── GuidesOverlay.tsx      Render/drag/delete ruler guides (document space)
│   │   ├── SvgDocument.tsx        Renders VectoNode tree as SVG (+ live gradient/filter <defs>)
│   │   │                          Double-click path → nodeEdit; double-click text → focus textarea
│   │   ├── SelectionOverlay.tsx   selection rects + move/resize/rotate + click-through + snap guides
│   │   ├── PathEditOverlay.tsx    Path node editor — anchor squares + bezier handle circles
│   │   └── DrawOverlay.tsx        Rect/ellipse/line/pen/text drawing (document-space SVG)
│   │   (Canvas.tsx also owns marquee/rubber-band select on blank canvas)
│   ├── toolbar/Toolbar.tsx        Tools (V/H/N/R/E/L/P/T) + file actions + undo/redo + theme toggle
│   │                              undo/redo disable via useStore(temporal); Open/Recent(▾)/Save/Trace/Export(▾)
│   ├── toolbar/ExportMenu.tsx     Export popover: PNG/JPG/PDF · 1×/2×/3× · selection-only
│   ├── settings/SettingsModal.tsx Provider tabs + API key + model dropdown (preset or custom)
│   ├── sidebar/
│   │   ├── LayerPanel.tsx         Resizable layer tree (drag handle on right edge)
│   │   ├── LayerNode.tsx          Layer row — hover sync + drag-reorder + dbl-click rename
│   │   └── PropertiesPanel.tsx    Attribute editor + text editing + AiEditBox + ArrangePanel
│   │                              AiEditBox / RecolorBox: AiPromptBox over runAiEdit (selection / whole-doc)
│   │                              ArrangePanel: align / distribute / flip via prependTransforms
│   │                              FontSection (text): FontPicker + size + weight/style/align
│   │                              StyleSection: opacity slider, stroke width/cap/join/dash, rect radius
│   │                              GradientSection: stops/type/angle editor (fill="url(#id)")
│   │                              EffectsSection: drop-shadow (offset/blur/color/opacity) + blur (filter="url(#id)")
│   │                              ColorRow: swatch → ColorPopover; fill has a "→ gradient" button
│   │                              Width persisted via panelStore; label column w-20
│   ├── ui/ColorPopover.tsx        Themed, anchored color picker (SV field + hue + hex + recents)
│   │                              Portals to <body>; replaces the native <input type=color>
│   │                              Eyedropper: native EyeDropper API, else in-app SVG-fill sampler
│   ├── ui/ContextMenu.tsx         Global right-click menu (portal); canvas + layer rows
│   ├── ui/FontPicker.tsx          Font-family dropdown; each option previewed in its own font
│   ├── ui/RecoveryBanner.tsx      Restore/Discard autosaved doc after crash (top banner)
│   ├── ui/UpdateBanner.tsx        Update available → download → restart (unsaved-work guard)
│   └── prompt/PromptBar.tsx       2-row textarea, char counter, expand modal
│                                  ⊞ button → VariantTray (N thumbnails, click to apply)
│                                  style preset chips (flat/gradient/3D/line/sticker/minimal)
├── hooks/
│   ├── useUndoBatch.ts           Scoped undo batch; auto-closes on unmount
│   ├── useUpdateCheck.ts         Silent auto-update probe 4s after launch
│   ├── useKeyboardShortcuts.ts    Tools + edit/z-order/nudge/clipboard + view + Delete/Esc/⌘Z
│   ├── useFileDrop.ts             Drag .svg (open) / image (trace) onto the window
│   └── useAutosave.ts             Snapshot dirty doc to localStorage every 4s (crash recovery)
└── app/App.tsx                    Root layout

Tests live beside the code they cover (`*.test.ts`, run with `npm test`):
svgRoundTrip · sanitize · pathParser · undoBatch.

src-tauri/
├── src/
│   ├── main.rs                    Entry point
│   ├── lib.rs                     Plugin + handler registration
│   └── commands/
│       ├── mod.rs
│       ├── ai.rs                  cancel_ai + 180s request timeout on every call
│       │                          generate_svg_stream (full doc) + edit_svg_stream (selection)
│       │                          generate_svg_variants (N concurrent, non-streaming)
│       │                          multi-provider SSE; model id passed per-call from settings
│       │                          emits svg:chunk / svg:edit-chunk events
│       ├── export.rs              export_png / export_image (PNG+JPEG) / export_pdf (svg2pdf, vector)
│       ├── trace.rs               trace_image (raster → SVG via vtracer, spawn_blocking)
│       └── fs_commands.rs         open_svg_file / save_svg_file
├── tauri.conf.json                CSP set (prod strict, devCsp allows Vite HMR); no more csp:null
└── capabilities/default.json     dialog only — fs/shell plugins removed (were unused)
```

---

## Keyboard Shortcuts

| Key | Action |
|---|---|
| `V` | Select tool |
| `H` | Pan tool |
| `N` | Node edit tool — also enters the editor if a single path is selected |
| `R` / `E` / `L` / `P` / `T` | Rectangle / Ellipse / Line / Pen / Text tool |
| `⌘D` | Duplicate selection (in place, offset) |
| `⌘C` / `⌘X` / `⌘V` | Copy / Cut / Paste selection |
| `⌘G` / `⌘⇧G` | Group / Ungroup selection |
| `]` / `[` | Bring forward / Send backward (z-order) |
| `⌘]` / `⌘[` | Bring to front / Send to back |
| Arrow keys | Nudge selection 1px (`⇧` = 10px) — select tool only |
| `Delete` / `Backspace` | Delete selected nodes (or path anchors in nodeEdit) |
| `Escape` | In nodeEdit/draw: exit to select. Otherwise: clear selection |
| `⌘Z` / `Ctrl+Z` | Undo |
| `⌘⇧Z` / `Ctrl+⇧Z` | Redo |
| `⌘O` / `Ctrl+O` | Open file |
| `⌘S` / `Ctrl+S` | Save file |
| `⌘⇧S` / `Ctrl+⇧S` | Save As |
| Scroll | Pan canvas |
| `⌘`+Scroll / Pinch | Zoom canvas |
| Drag rotate handle | Rotate selection (`⇧` = snap 15°) |
| Drag on blank canvas | Marquee select (`⇧` = add to selection) — select tool |
| `Alt`/`Option` while moving | Bypass snapping / smart guides |
| `⌘A` / `Ctrl+A` | Select all top-level elements |
| `⇧1` / `⇧2` | Zoom to fit / zoom to selection (also in the ⊟ zoom control) |
| Drag from a ruler | Pull out a guide (needs a small drag); drop back on the ruler to cancel; double-click a guide to delete |
| Drag layer row | Reorder / reparent in the layer panel |
| Double-click `<path>` | Enter node edit mode for that path |
| Double-click `<text>` | Focus text content editor in Properties panel |
| Double-click a layer name | Rename it (persists via `data-name`) |

> Single-key tool shortcuts are normalized to lowercase and ignored while a
> modifier is held, so `⌘R` / `⌘P` etc. never hijack the active tool.

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
- Arcs (`A`) are decomposed to cubic béziers on parse, so they survive editing.
  `serializePath` emits only `M/L/C/Z`, so without that any edit to a path
  containing an arc flattened it to a straight line — a circle converted to a
  path collapsed to a zero-area sliver.

Entering node-edit (all set `editingElementId`):
- Double-click a `<path>` (from any tool) — `SvgNode.handleDoubleClick`
- ◈ toolbar button or `N` key with a single path selected — `startNodeEditForSelectedPath()`
- Single-click a path **while already in** node-edit mode — `SvgNode.handlePointerDown`

The ◈ button / `N` only switches the tool; without a path to edit, `PathEditOverlay`
renders nothing — so `startNodeEditForSelectedPath()` is what makes the button useful.

### Path data flow
```
VectoNode.attributes.d
  → parsePath(d) → PathContour[]   (on mount / d-change)
  → drag interaction mutates working copy
  → serializePath(contours) → new d string
  → documentStore.updateNodeAttributes(id, { d })
```

---

## Design System (Light + Dark)

Tokens are **CSS variables** defined in `src/index.css` and exposed to Tailwind
via `rgb(var(--color-x) / <alpha-value>)` in `tailwind.config.js`, so opacity
modifiers (`bg-accent/40`, `bg-danger/10`) keep working. Use them through the
semantic classes — `bg-canvas`, `bg-panel`, `text-text-secondary`, `border-border`,
`bg-accent-dim`, etc. — **never hard-code hex in components.**

Dark reference (the `:root` defaults; `.light` overrides them in index.css):

| Token | Dark | Light |
|---|---|---|
| canvas bg | `#141414` | `#f4f4f5` |
| panel bg | `#1e1e1e` | `#ffffff` |
| surface | `#2a2a2a` | `#f1f1f3` |
| border | `#333333` | `#dadadf` |
| text primary | `#e5e5e5` | `#18181b` |
| text secondary | `#888888` | `#5a5a64` |
| text muted | `#555555` | `#a1a1aa` |
| accent | `#0ea5e9` | `#0ea5e9` |
| danger | `#ef4444` | `#dc2626` |

### Theme switching
- `themeStore` (persisted to `vecto-theme`) holds `"dark" | "light"`; `toggleTheme`
  / `setTheme` add/remove `.light` / `.dark` on `document.documentElement`.
- `main.tsx` applies the persisted theme before first paint (no flash); `index.css`
  also sets `html,body { background: rgb(var(--color-canvas)) }`.
- Toggle button (☀ / ☾) lives in the toolbar next to ⚙.
- Non-themed bits (still fine on both): canvas-overlay graphics (selection/handles/
  guides/draw previews) use the accent + a few fixed hexes; they read clearly on
  either background. Theme them later if needed.

---

## Running the App

```bash
# Install dependencies
npm install

# Dev mode (hot reload)
npm run tauri dev

# Production build
npm run tauri build

# Tests (vitest + jsdom) — parser/serializer/path/undo regressions
npm test

# Cut a release — bumps all three version fields, then push to main
npm run release:patch   # or release:minor / release:major
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

### Milestone 8 — Object Editing ✅
- [x] Duplicate (⌘D) — deep clone in place, offset, new ids; selects the copies
- [x] Copy / Cut / Paste (⌘C / ⌘X / ⌘V) — in-memory `lib/clipboard.ts`, paste offset +10
- [x] Group / Ungroup (⌘G / ⌘⇧G) — wraps siblings in `<g>`; ungroup pushes group transform onto children
- [x] Z-order — `[` / `]` step, `⌘[` / `⌘]` to back/front (`reorderNodes`); later in tree = on top
- [x] Arrow-key nudge — 1px, Shift = 10px (`nudgeNodes`, select tool only)
- [x] Rotate handle in `SelectionOverlay` — drag to rotate about bbox center, Shift snaps 15°
- [x] Click-through reselect — clicking inside the selection bbox picks the element
      under the cursor; the move-rect distinguishes a click (reselect) from a drag (move)
- [x] Text tool (T) — click to place `<text>`, auto-focuses Properties text editor
- [x] Layer panel drag-to-reorder / reparent (`moveNode`, descendant-drop guard via `containsId`)
- [x] `nodeUtils.ts` shared tree helpers (clone / find / findParentList / containsId)
- [x] Save no longer drops hidden layers — serialized as `display:none`, round-tripped on parse

Notes / known limits:
- Move/resize/rotate/nudge all compose onto `attributes.transform`; move/resize/rotate
  consolidate to a single `matrix(...)` on pointerup, nudge leaves a transform chain
  (valid, just not consolidated).
- The selection move-rect (`pointerEvents:"all"`, covers the whole bbox) opens the
  undo batch lazily on the first move past a 4px threshold. A click that never moves
  is treated as a reselect via `topNodeUnderPoint` (scans `document.elementsFromPoint`
  for the first registered node), so it can't swallow clicks on inner elements.
- `groupNodes` only groups nodes that are siblings of the first selected node.
  `ungroupNodes` pushes the group's `transform` down to children but drops other
  group-level attributes (opacity/fill).
- Selection rects project `getBBox()` (element-local geometry) through the
  element→document matrix (`getScreenCTM`) so the box tracks moved/resized/rotated
  elements. Rotated elements get an axis-aligned box (it grows with rotation).
  During a live drag the box can trail by one frame; it settles correctly on
  pointerup.

### Milestone 9 — Selection, Alignment & AI Edit ✅
- [x] Marquee / rubber-band select — drag on blank canvas (select tool); Shift adds.
      Selects top-level nodes whose `getDocBBox` intersects the marquee (`Canvas.tsx`)
- [x] Align — left/center/right/top/middle/bottom (2+ selected) via `prependTransforms`
- [x] Distribute — horizontal/vertical, even center spacing, ends fixed (3+ selected)
- [x] Flip — horizontal/vertical about the selection's union-bbox center
- [x] `ArrangePanel` in the Properties panel (shown when ≥1 selected; buttons gated by count)
- [x] **Selection-scoped AI edit** — `AiEditBox`: serialize selected nodes (`serializeFragment`)
      → `edit_svg_stream` → stream replacement SVG → `replaceNodes` (live preview + final)
- [x] `EDIT_SYSTEM_PROMPT` in `ai.rs`; streams on `svg:edit-chunk`; one undo step per edit
- [x] Shared `lib/bbox.ts` (transform-aware bbox) and `lib/svgExtract.ts` (used by both
      generation and edit)

AI-edit data flow (`lib/aiEdit.ts`, shared by AiEditBox + RecolorBox):
```
selected nodes → serializeFragment(nodes, viewBox, usedGradients)  (standalone <svg>, gradients in <defs>)
  → invoke("edit_svg_stream", { instruction, svg, apiKey, provider, model })
  → Rust streams svg:edit-chunk deltas
  → accumulate → extractPartialSvg → parseSVG → replaceNodeInPlace(marker→orig) + upsertGradients
  → on completion: extractSvg → final apply → selection ids stable (in-place)
```
Gradients the selection references are sent in `<defs>` so the model can edit their stops;
any gradients it returns (edited or new) are merged back by id via `upsertGradients`.
Notes: edit replaces the whole selected set with the model's returned elements (not a 1:1
map), inserted at the first selection's position in its parent list. New nodes get fresh
nanoid ids. Wrapped in one `beginUndoBatch`/`endUndoBatch`.

### Milestone 10 — Variants, Snapping & 1:1 AI Edit ✅
- [x] **Generate N variants** — `generate_svg_variants` (Rust, N concurrent non-streaming
      requests via `generate_once` + `join_all`); `VariantTray` shows thumbnails as
      `data:image/svg+xml` `<img>`s; click one → `setDocument`. ⊞ button in `PromptBar`.
- [x] **Snapping / smart guides** — on move-drag, the selection's edges/centers snap to
      other elements' and the artboard's edges/centers (6px/zoom threshold). Pink guide
      lines render the active snap. Snap targets cached at drag start. **Alt** bypasses.
- [x] **1:1 per-element AI edit** — selected nodes get marker ids (`vecto-edit-{i}`); the
      model echoes them back; results map onto the ORIGINAL nodes in place via
      `replaceNodeInPlace` (id-match, positional fallback mid-stream). Ids/selection stable,
      structure preserved. `EDIT_SYSTEM_PROMPT` now requires same ids / same element count.

Notes / limits:
- 1:1 edit cannot change element count (no split/merge) — that's the trade for reliability.
  Marker ids live only in the serialized fragment; `replaceNodeInPlace` never copies svgId,
  so the original `id` (or lack of one) is preserved.
- Variants are independent generations (provider temperature gives the diversity); they
  replace the whole document when picked (one undo step).
- Snapping covers move only (not resize/rotate); guides are axis-aligned edge/center lines.

### Milestone 11 — UX polish, editor depth, AI & IO ✅
- [x] Right-click context menu (canvas + layer rows) — duplicate/copy/paste/delete/group/z-order
      via shared `lib/editActions.ts` (also used by keyboard shortcuts); `contextMenuStore` + `ui/ContextMenu`
- [x] Style controls in Properties — `StyleSection`: opacity slider, stroke width, cap/join toggles,
      dash presets, rect corner radius. These keys are hidden from the raw attribute list.
- [x] Persisted panel widths (`panelStore`, localStorage `vecto-panels`); committed on resize-release
- [x] Convert shape → path (context menu) — `shapeToPath.ts` + `convertSelectionToPath`, in-place
- [x] Boolean ops (Unite/Subtract/Intersect/Exclude) — `lib/boolean.ts` via `polygon-clipping`;
      flattens beziers to polygons in doc space, combines, replaces selection with one path.
      Limit: curves become fine polylines; per-node holes (donut subpaths) not preserved.
- [x] Gradient editor — gradients parsed from `<defs>` into `document.gradients`, rendered as
      live React `<defs>`, edited via `GradientSection` (stops/type/angle), `→ gradient` button
      on fill; `addGradient`/`updateGradient`/`removeGradient` store actions. `lib/gradient.ts`.
      Copy/duplicate/paste clone referenced gradients with fresh ids (`cloneNodesWithDefs`)
      so copies don't share or lose their gradient; stop edits collapse to one undo step.
      Limits: angle UI only for object-space linear; per-stop opacity not yet in UI.
- [x] Effects (drop shadow / blur) — `document.filters` (VectoFilter) parsed from `<defs>`
      (feDropShadow / feGaussianBlur), rendered as live React `<filter>`, edited via `EffectsSection`
      (`filter="url(#id)"`); `lib/effects.ts` + add/update/remove/addFilters store actions. Cloned on
      copy/duplicate/paste (`cloneNodesWithDefs`). `serializeFragment` now includes referenced
      gradients+filters so export-selection renders them. Unrecognized filters stay in `rawDefs`.
- [x] Rulers (canvas-drawn, `Rulers.tsx`) + drag-out guides (`GuidesOverlay`, uiStore.guides)
      + zoom-to-fit (`⇧1`) / zoom-to-selection (`⇧2`) via `CanvasManager.fitRect` + `canvasController`.
      Move-snapping also snaps to guides (SelectionOverlay adds uiStore.guides to snap targets).
- [x] Image → vector trace — `trace_image` Rust command (vtracer 0.6, on a blocking thread);
      "Trace" toolbar button → file picker → SVG → loaded as document. parser now derives a
      viewBox from width/height when absent (traced/exported SVGs).
- [x] AI recolor / palette swap — whole-document recolor via `RecolorBox` (shown when nothing
      selected) over the shared `runAiEdit`; AiEditBox now also uses it (1:1 in-place).
- [x] Prompt style presets — chips in PromptBar (flat/gradient/3D/line/sticker/minimal) prepended
      to the generation + variants prompt.
- [x] Export — `ExportMenu` (PNG/JPG/PDF · 1×/2×/3× · selection-only, cropped to selection bbox);
      Rust `export_image` (PNG via tiny-skia, JPEG composited over white) + `export_pdf` (svg2pdf,
      vector/selectable text). WebP still deferred (image crate dropped WebP encoding).
- [x] Drag-and-drop to open — `useFileDrop` (Tauri webview drag-drop): .svg opens, image traces.
- [x] Recent files — `recentStore` (persisted), "▾" menu by Open (reuses ContextMenu); recorded
      on open/save.
- [x] Autosave / crash recovery — `useAutosave` snapshots dirty docs to localStorage every 4s;
      `RecoveryBanner` offers Restore/Discard on next launch; cleared on clean save.

### Milestone 12 — Plugin system
- [ ] Define plugin API surface (which store actions are public)
- [ ] Rust-side plugin host
