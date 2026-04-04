import { create } from "zustand";

interface SelectionState {
  selectedIds: string[];
  hoveredId: string | null;
}

interface SelectionActions {
  /** Replace selection with exactly these IDs. */
  select: (ids: string[]) => void;
  /** Add one ID to the existing selection (shift-click). */
  addToSelection: (id: string) => void;
  /** Remove one ID from the selection. */
  removeFromSelection: (id: string) => void;
  clearSelection: () => void;
  setHovered: (id: string | null) => void;
}

export const useSelectionStore = create<SelectionState & SelectionActions>(
  (set, get) => ({
    selectedIds: [],
    hoveredId: null,

    select: (ids) => set({ selectedIds: ids }),

    addToSelection: (id) =>
      set((state) => ({
        selectedIds: state.selectedIds.includes(id)
          ? state.selectedIds
          : [...state.selectedIds, id],
      })),

    removeFromSelection: (id) =>
      set((state) => ({
        selectedIds: state.selectedIds.filter((x) => x !== id),
      })),

    clearSelection: () => set({ selectedIds: [] }),

    setHovered: (id) => set({ hoveredId: id }),

    // Convenience — not stored, just reads current state
    isSelected: (id: string) => get().selectedIds.includes(id),
  })
);
