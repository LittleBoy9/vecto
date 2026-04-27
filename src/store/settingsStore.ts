import { create } from "zustand";
import { persist } from "zustand/middleware";

export type Provider = "anthropic" | "openai" | "gemini";

interface SettingsState {
  provider: Provider;
  anthropicKey: string;
  openaiKey: string;
  geminiKey: string;
  settingsOpen: boolean;
}

interface SettingsActions {
  setProvider: (p: Provider) => void;
  setAnthropicKey: (k: string) => void;
  setOpenaiKey: (k: string) => void;
  setGeminiKey: (k: string) => void;
  openSettings: () => void;
  closeSettings: () => void;
}

export const useSettingsStore = create<SettingsState & SettingsActions>()(
  persist(
    (set) => ({
      provider: "anthropic",
      anthropicKey: "",
      openaiKey: "",
      geminiKey: "",
      settingsOpen: false,

      setProvider: (provider) => set({ provider }),
      setAnthropicKey: (anthropicKey) => set({ anthropicKey }),
      setOpenaiKey: (openaiKey) => set({ openaiKey }),
      setGeminiKey: (geminiKey) => set({ geminiKey }),
      openSettings: () => set({ settingsOpen: true }),
      closeSettings: () => set({ settingsOpen: false }),
    }),
    {
      name: "vecto-settings",
      partialize: (s) => ({
        provider: s.provider,
        anthropicKey: s.anthropicKey,
        openaiKey: s.openaiKey,
        geminiKey: s.geminiKey,
      }),
    }
  )
);

/** Returns the API key for the currently selected provider. */
export function activeKey(state: Pick<SettingsState, "provider" | "anthropicKey" | "openaiKey" | "geminiKey">) {
  if (state.provider === "openai") return state.openaiKey;
  if (state.provider === "gemini") return state.geminiKey;
  return state.anthropicKey;
}
