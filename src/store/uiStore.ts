import { create } from "zustand";

export type Tool = "select" | "pan";

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
}

interface UIActions {
  setTool: (tool: Tool) => void;
  /** Called by CanvasManager after wheel / pinch to keep store in sync. */
  setTransform: (zoom: number, panX: number, panY: number) => void;
  setGenerating: (v: boolean) => void;
  setFileLoading: (v: boolean) => void;
  toggleLeftPanel: () => void;
  toggleRightPanel: () => void;
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

  setTool: (activeTool) => set({ activeTool }),
  setTransform: (zoom, panX, panY) => set({ zoom, panX, panY }),
  setGenerating: (isGenerating) => set({ isGenerating }),
  setFileLoading: (isFileLoading) => set({ isFileLoading }),
  toggleLeftPanel: () => set((s) => ({ leftPanelOpen: !s.leftPanelOpen })),
  toggleRightPanel: () => set((s) => ({ rightPanelOpen: !s.rightPanelOpen })),
}));
