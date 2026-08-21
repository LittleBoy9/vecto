import { create } from "zustand";
import { persist } from "zustand/middleware";

export type Provider = "anthropic" | "openai" | "gemini";

interface SettingsState {
  provider: Provider;
  anthropicKey: string;
  openaiKey: string;
  geminiKey: string;
  /** Selected model id per provider. */
  anthropicModel: string;
  openaiModel: string;
  geminiModel: string;
  settingsOpen: boolean;
}

interface SettingsActions {
  setProvider: (p: Provider) => void;
  setAnthropicKey: (k: string) => void;
  setOpenaiKey: (k: string) => void;
  setGeminiKey: (k: string) => void;
  setModel: (p: Provider, m: string) => void;
  openSettings: () => void;
  closeSettings: () => void;
}

/** Default + suggested model ids per provider (the id field is sent to the API). */
export const PROVIDER_MODELS: Record<Provider, { id: string; label: string }[]> = {
  anthropic: [
    { id: "claude-opus-5", label: "Claude Opus 5 — most capable" },
    { id: "claude-sonnet-5", label: "Claude Sonnet 5 — balanced" },
    { id: "claude-haiku-4-5-20251001", label: "Claude Haiku 4.5 — fastest" },
    { id: "claude-fable-5", label: "Claude Fable 5" },
  ],
  openai: [
    { id: "gpt-4o", label: "GPT-4o" },
    { id: "gpt-4o-mini", label: "GPT-4o mini" },
    { id: "gpt-4.1", label: "GPT-4.1" },
  ],
  gemini: [
    { id: "gemini-2.0-flash", label: "Gemini 2.0 Flash" },
    { id: "gemini-2.5-pro", label: "Gemini 2.5 Pro" },
    { id: "gemini-2.5-flash", label: "Gemini 2.5 Flash" },
  ],
};

export const useSettingsStore = create<SettingsState & SettingsActions>()(
  persist(
    (set) => ({
      provider: "anthropic",
      anthropicKey: "",
      openaiKey: "",
      geminiKey: "",
      anthropicModel: PROVIDER_MODELS.anthropic[1].id, // Sonnet 5
      openaiModel: PROVIDER_MODELS.openai[0].id,
      geminiModel: PROVIDER_MODELS.gemini[0].id,
      settingsOpen: false,

      setProvider: (provider) => set({ provider }),
      setAnthropicKey: (anthropicKey) => set({ anthropicKey }),
      setOpenaiKey: (openaiKey) => set({ openaiKey }),
      setGeminiKey: (geminiKey) => set({ geminiKey }),
      setModel: (p, m) =>
        set(
          p === "openai" ? { openaiModel: m } : p === "gemini" ? { geminiModel: m } : { anthropicModel: m }
        ),
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
        anthropicModel: s.anthropicModel,
        openaiModel: s.openaiModel,
        geminiModel: s.geminiModel,
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

/** Returns the selected model id for the currently selected provider. */
export function activeModel(state: Pick<SettingsState, "provider" | "anthropicModel" | "openaiModel" | "geminiModel">) {
  if (state.provider === "openai") return state.openaiModel;
  if (state.provider === "gemini") return state.geminiModel;
  return state.anthropicModel;
}
