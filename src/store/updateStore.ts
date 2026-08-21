import { create } from "zustand";

/**
 * Auto-update state.
 *
 * Deliberately NOT part of documentStore — update progress must never enter the
 * undo history, and it has to survive document swaps.
 */
export type UpdatePhase =
  | "idle"         // nothing found, or not checked yet
  | "available"    // a newer version exists, waiting on the user
  | "downloading"  // user accepted; bytes are moving
  | "ready"        // downloaded and staged, waiting to restart
  | "error";

interface UpdateState {
  phase: UpdatePhase;
  /** Version string of the pending update, e.g. "0.2.0". */
  version: string | null;
  /** Release notes from latest.json, if the manifest carried any. */
  notes: string | null;
  /** 0–1, or null while the server sends no content-length. */
  progress: number | null;
  error: string | null;
  /**
   * Versions the user dismissed. "Later" must mean later — re-prompting on
   * every launch is how an update nag becomes something people learn to ignore.
   */
  dismissed: string[];
  /** True while a manual check from Settings is in flight. */
  checking: boolean;
}

interface UpdateActions {
  setAvailable: (version: string, notes: string | null) => void;
  setDownloading: () => void;
  setProgress: (p: number | null) => void;
  setReady: () => void;
  setError: (message: string) => void;
  setChecking: (v: boolean) => void;
  dismiss: () => void;
  reset: () => void;
}

export const useUpdateStore = create<UpdateState & UpdateActions>((set, get) => ({
  phase: "idle",
  version: null,
  notes: null,
  progress: null,
  error: null,
  dismissed: [],
  checking: false,

  setAvailable: (version, notes) => set({ phase: "available", version, notes, error: null }),
  setDownloading: () => set({ phase: "downloading", progress: 0, error: null }),
  setProgress: (progress) => set({ progress }),
  setReady: () => set({ phase: "ready", progress: 1 }),
  setError: (error) => set({ phase: "error", error }),
  setChecking: (checking) => set({ checking }),

  dismiss: () => {
    const v = get().version;
    set((s) => ({
      phase: "idle",
      progress: null,
      dismissed: v && !s.dismissed.includes(v) ? [...s.dismissed, v] : s.dismissed,
    }));
  },

  reset: () => set({ phase: "idle", version: null, notes: null, progress: null, error: null }),
}));

/** True if the user already said "Later" to this version. */
export function isDismissed(version: string) {
  return useUpdateStore.getState().dismissed.includes(version);
}
