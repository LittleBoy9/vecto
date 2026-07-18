import { create } from "zustand";
import { persist } from "zustand/middleware";

interface PanelState {
  leftWidth: number;
  rightWidth: number;
  setLeftWidth: (w: number) => void;
  setRightWidth: (w: number) => void;
}

/** Persisted panel widths so the layout survives restarts. */
export const usePanelStore = create<PanelState>()(
  persist(
    (set) => ({
      leftWidth: 208,
      rightWidth: 300,
      setLeftWidth: (leftWidth) => set({ leftWidth }),
      setRightWidth: (rightWidth) => set({ rightWidth }),
    }),
    { name: "vecto-panels" }
  )
);
