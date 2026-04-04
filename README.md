# Vecto

**AI-powered SVG generation and editing — desktop app for Mac & Windows.**

Type a prompt, get a vector graphic. Open any SVG file and edit it like a simplified Illustrator. Built on Tauri, React, and Claude AI.

![Vecto App](https://raw.githubusercontent.com/sounakdas/vecto/main/docs/preview.png)

---

## Features

- **AI Generation** — describe what you want in plain text, get production-ready SVG back
- **SVG Editor** — open any local `.svg` file and edit it directly
- **Element Selection** — click to select, shift-click to multi-select, bounding box overlay with handles
- **Layer Panel** — full element tree with expand/collapse, visibility toggle, lock toggle
- **Properties Panel** — live attribute editing (fill, stroke, opacity, position, etc.) with color picker
- **Bidirectional Hover** — hover a canvas element to highlight its layer row, and vice versa
- **Pan & Zoom** — scroll to pan, ⌘+scroll or pinch to zoom — crisp vector at any zoom level
- **Undo / Redo** — 100-step history via keyboard or toolbar (⌘Z / ⌘⇧Z)
- **Save & Export** — save as `.svg`, save-as to a new path
- **Resizable Panels** — drag the layer and properties panels to any width

---

## Stack

| Layer | Technology |
|---|---|
| Desktop shell | [Tauri 2](https://tauri.app) (Rust) |
| UI | React 18 + TypeScript |
| Build | Vite 6 |
| Styling | TailwindCSS 3 |
| State | Zustand 5 + Immer + zundo (undo/redo) |
| AI | Claude API (Anthropic) |

---

## Getting Started

### Prerequisites

- [Node.js](https://nodejs.org) 18+
- [Rust](https://rustup.rs) (stable toolchain)
- Tauri prerequisites for your OS → [tauri.app/start/prerequisites](https://tauri.app/start/prerequisites/)

### Install & Run

```bash
git clone https://github.com/sounakdas/vecto.git
cd vecto
npm install
npm run tauri dev
```

### API Key

Vecto uses the Claude API for SVG generation.

1. Get a key at [console.anthropic.com](https://console.anthropic.com)
2. Open Vecto → click **⚙** in the toolbar → paste your key → Save

The key is stored locally on your machine and never leaves it.

---

## Keyboard Shortcuts

| Key | Action |
|---|---|
| `V` | Select tool |
| `H` | Pan tool |
| `Delete` / `Backspace` | Delete selected elements |
| `Escape` | Clear selection |
| `⌘Z` / `Ctrl+Z` | Undo |
| `⌘⇧Z` / `Ctrl+⇧Z` | Redo |
| `⌘O` / `Ctrl+O` | Open SVG file |
| `⌘S` / `Ctrl+S` | Save |
| Scroll | Pan canvas |
| `⌘` + Scroll / Pinch | Zoom |

---

## Project Structure

```
src/
├── app/App.tsx                    Root layout
├── types/svg.ts                   VectoDocument / VectoNode types
├── store/
│   ├── documentStore.ts           SVG document tree + undo/redo
│   ├── selectionStore.ts          Selected / hovered element IDs
│   ├── uiStore.ts                 Tool, zoom, panel state
│   └── settingsStore.ts           API key (persisted to localStorage)
├── lib/
│   ├── svgParser.ts               SVG string → VectoDocument
│   ├── svgSerializer.ts           VectoDocument → SVG string
│   ├── canvasRegistry.ts          nodeId → SVGElement map for getBBox()
│   └── utils.ts                   cn(), nodeIcon(), colorToHex()
├── components/
│   ├── canvas/
│   │   ├── CanvasManager.ts       Pan via CSS translate, zoom via SVG dimensions
│   │   ├── Canvas.tsx             Pointer routing + fit-to-view
│   │   ├── SvgDocument.tsx        Renders VectoNode tree as live SVG
│   │   └── SelectionOverlay.tsx   Bounding boxes + handles via getBBox()
│   ├── toolbar/Toolbar.tsx
│   ├── sidebar/
│   │   ├── LayerPanel.tsx         Resizable layer tree
│   │   ├── LayerNode.tsx          Row with visibility/lock/hover sync
│   │   └── PropertiesPanel.tsx    Resizable attribute editor
│   ├── prompt/PromptBar.tsx       Multiline prompt + expand modal
│   └── settings/SettingsModal.tsx API key configuration
└── hooks/useKeyboardShortcuts.ts

src-tauri/src/commands/
├── ai.rs                          Claude API call (Rust — key never in JS)
└── fs_commands.rs                 File read/write
```

---

## Architecture Notes

**Pan/zoom is never in React state during interaction.** `CanvasManager` applies CSS `translate` directly to the viewport DOM element for pan (60 fps, no re-renders). Zoom is applied as `width`/`height` on the SVG element itself — the browser re-renders vector paths at the correct resolution instead of scaling a rasterized bitmap.

**Single source of truth.** All SVG content lives in `documentStore` as a `VectoDocument` tree. Every edit goes through Zustand actions (Immer + temporal for undo/redo). The canvas reads from this tree and never writes back directly.

---

## Roadmap

- [ ] Drag to move elements on canvas
- [ ] Resize via corner handles
- [ ] Real-time AI streaming response
- [ ] PNG export via `resvg`
- [ ] Group / ungroup elements
- [ ] Plugin system

---

## License

MIT © Sounak Das
