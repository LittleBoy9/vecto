import { create } from "zustand";
import { persist } from "zustand/middleware";

interface RecentState {
  paths: string[];
  addRecent: (path: string) => void;
  clearRecent: () => void;
}

/** Most-recently opened/saved file paths (newest first, max 8). */
export const useRecentStore = create<RecentState>()(
  persist(
    (set) => ({
      paths: [],
      addRecent: (path) =>
        set((s) => ({ paths: [path, ...s.paths.filter((p) => p !== path)].slice(0, 8) })),
      clearRecent: () => set({ paths: [] }),
    }),
    { name: "vecto-recent" }
  )
);
