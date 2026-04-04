import { create } from "zustand";
import { persist } from "zustand/middleware";

interface SettingsState {
  apiKey: string;
  settingsOpen: boolean;
}

interface SettingsActions {
  setApiKey: (key: string) => void;
  openSettings: () => void;
  closeSettings: () => void;
}

export const useSettingsStore = create<SettingsState & SettingsActions>()(
  persist(
    (set) => ({
      apiKey: "",
      settingsOpen: false,

      setApiKey: (apiKey) => set({ apiKey }),
      openSettings: () => set({ settingsOpen: true }),
      closeSettings: () => set({ settingsOpen: false }),
    }),
    {
      name: "vecto-settings",
      // Only persist the key — not the modal open state
      partialize: (state) => ({ apiKey: state.apiKey }),
    }
  )
);
