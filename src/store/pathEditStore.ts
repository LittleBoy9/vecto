import { create } from "zustand";
import { useDocumentStore } from "./documentStore";
import { useSelectionStore } from "./selectionStore";
import { findNode } from "../lib/nodeUtils";

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

/** True if a node is an editable path (has a `d` attribute). */
export function isEditablePath(tagName: string, attrs: Record<string, string>) {
  return tagName === "path" && !!attrs.d;
}

/**
 * Begin node-editing whatever path is currently selected, if exactly one path
 * is selected. Lets the ◈ toolbar button / N key actually enter the editor
 * instead of only double-click.
 */
export function startNodeEditForSelectedPath() {
  const sel = useSelectionStore.getState().selectedIds;
  const doc = useDocumentStore.getState().document;
  if (sel.length !== 1 || !doc) return;
  const node = findNode(doc.nodes, sel[0]);
  if (node && isEditablePath(node.tagName, node.attributes)) {
    usePathEditStore.getState().startEditing(sel[0]);
  }
}
