import { create } from "zustand";

export interface SelectedNodeKey {
  contourIdx: number;
  nodeIdx: number;
}

interface PathEditState {
  /** The VectoNode ID of the <path> element currently being edited. */
  editingElementId: string | null;
  /** Selected anchor nodes (by their deterministic "c{ci}_n{ni}" ID). */
  selectedNodeIds: string[];
}

interface PathEditActions {
  startEditing: (elementId: string) => void;
  stopEditing: () => void;
  selectNodes: (ids: string[]) => void;
  addNodeToSelection: (id: string) => void;
  clearNodeSelection: () => void;
}

export const usePathEditStore = create<PathEditState & PathEditActions>(
  (set) => ({
    editingElementId: null,
    selectedNodeIds: [],

    startEditing: (elementId) =>
      set({ editingElementId: elementId, selectedNodeIds: [] }),

    stopEditing: () =>
      set({ editingElementId: null, selectedNodeIds: [] }),

    selectNodes: (ids) => set({ selectedNodeIds: ids }),

    addNodeToSelection: (id) =>
      set((s) =>
        s.selectedNodeIds.includes(id)
          ? s
          : { selectedNodeIds: [...s.selectedNodeIds, id] }
      ),

    clearNodeSelection: () => set({ selectedNodeIds: [] }),
  })
);
