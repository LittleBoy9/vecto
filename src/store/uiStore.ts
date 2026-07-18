import { create } from "zustand";
import { nanoid } from "nanoid";

export type Tool =
  | "select"
  | "pan"
  | "nodeEdit"
  | "rect"
  | "ellipse"
  | "line"
  | "pen"
  | "text";

/** A ruler guide: axis "x" = vertical line at x=pos, "y" = horizontal line at y=pos. */
export interface Guide {
  id: string;
  axis: "x" | "y";
  pos: number;
}

interface UIState {
  activeTool: Tool;
  /** Current canvas zoom level (1 = 100%). */
  zoom: number;
  /** Canvas pan offset in screen pixels. */
  panX: number;
  panY: number;
  isGenerating: boolean;
  isFileLoading: boolean;
  /** Controls whether the left / right panels are open. */
  leftPanelOpen: boolean;
  rightPanelOpen: boolean;
  /** Show rulers + allow dragging out guides. */
  rulersVisible: boolean;
  guides: Guide[];
}

interface UIActions {
  setTool: (tool: Tool) => void;
  /** Called by CanvasManager after wheel / pinch to keep store in sync. */
  setTransform: (zoom: number, panX: number, panY: number) => void;
  setGenerating: (v: boolean) => void;
  setFileLoading: (v: boolean) => void;
  toggleLeftPanel: () => void;
  toggleRightPanel: () => void;
  toggleRulers: () => void;
  addGuide: (axis: "x" | "y", pos: number) => string;
  updateGuide: (id: string, pos: number) => void;
  removeGuide: (id: string) => void;
}

export const useUIStore = create<UIState & UIActions>((set) => ({
  activeTool: "select",
  zoom: 1,
  panX: 0,
  panY: 0,
  isGenerating: false,
  isFileLoading: false,
  leftPanelOpen: true,
  rightPanelOpen: true,
  rulersVisible: true,
  guides: [],

  setTool: (activeTool) => set({ activeTool }),
  setTransform: (zoom, panX, panY) => set({ zoom, panX, panY }),
  setGenerating: (isGenerating) => set({ isGenerating }),
  setFileLoading: (isFileLoading) => set({ isFileLoading }),
  toggleLeftPanel: () => set((s) => ({ leftPanelOpen: !s.leftPanelOpen })),
  toggleRightPanel: () => set((s) => ({ rightPanelOpen: !s.rightPanelOpen })),
  toggleRulers: () => set((s) => ({ rulersVisible: !s.rulersVisible })),
  addGuide: (axis, pos) => {
    const id = nanoid(6);
    set((s) => ({ guides: [...s.guides, { id, axis, pos }] }));
    return id;
  },
  updateGuide: (id, pos) =>
    set((s) => ({ guides: s.guides.map((g) => (g.id === id ? { ...g, pos } : g)) })),
  removeGuide: (id) => set((s) => ({ guides: s.guides.filter((g) => g.id !== id) })),
}));
