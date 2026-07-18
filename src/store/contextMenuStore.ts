import { create } from "zustand";

export interface ContextMenuItem {
  label?: string;
  shortcut?: string;
  onClick?: () => void;
  disabled?: boolean;
  danger?: boolean;
  /** Render a divider instead of a clickable row. */
  separator?: boolean;
}

interface ContextMenuState {
  open: boolean;
  x: number;
  y: number;
  items: ContextMenuItem[];
  openMenu: (x: number, y: number, items: ContextMenuItem[]) => void;
  closeMenu: () => void;
}

export const useContextMenuStore = create<ContextMenuState>((set) => ({
  open: false,
  x: 0,
  y: 0,
  items: [],
  openMenu: (x, y, items) => set({ open: true, x, y, items }),
  closeMenu: () => set({ open: false, items: [] }),
}));
