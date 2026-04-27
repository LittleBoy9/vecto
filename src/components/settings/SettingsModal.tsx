import { useEffect, useRef, useState } from "react";
import { useSettingsStore, type Provider } from "../../store/settingsStore";
import { cn } from "../../lib/utils";

// ── Provider config ───────────────────────────────────────────────────────────

const PROVIDERS: { id: Provider; label: string; placeholder: string; steps: string[] }[] = [
  {
    id: "anthropic",
    label: "Anthropic",
    placeholder: "sk-ant-api03-…",
    steps: [
      "Go to console.anthropic.com",
      "Sign in and open API Keys",
      "Click Create Key and copy it here",
    ],
  },
  {
    id: "openai",
    label: "OpenAI",
    placeholder: "sk-…",
    steps: [
      "Go to platform.openai.com",
      "Sign in and open API keys",
      "Click Create new secret key and copy it here",
    ],
  },
  {
    id: "gemini",
    label: "Gemini",
    placeholder: "AIza…",
    steps: [
      "Go to aistudio.google.com",
      "Sign in with your Google account",
      "Click Get API key and copy it here",
    ],
  },
];

// ── Modal ─────────────────────────────────────────────────────────────────────

export function SettingsModal() {
  const {
    provider, settingsOpen,
    anthropicKey, openaiKey, geminiKey,
    setProvider, setAnthropicKey, setOpenaiKey, setGeminiKey,
    closeSettings,
  } = useSettingsStore();

  const [drafts, setDrafts] = useState({ anthropic: "", openai: "", gemini: "" });
  const [activeTab, setActiveTab] = useState<Provider>(provider);
  const [saved, setSaved] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (settingsOpen) {
      setDrafts({ anthropic: anthropicKey, openai: openaiKey, gemini: geminiKey });
      setActiveTab(provider);
      setSaved(false);
      setTimeout(() => inputRef.current?.focus(), 50);
    }
  }, [settingsOpen]); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if (e.key === "Escape" && settingsOpen) closeSettings();
    };
    window.addEventListener("keydown", handler);
    return () => window.removeEventListener("keydown", handler);
  }, [settingsOpen, closeSettings]);

  if (!settingsOpen) return null;

  const currentDraft = drafts[activeTab];
  const setCurrentDraft = (v: string) =>
    setDrafts((d) => ({ ...d, [activeTab]: v }));

  const handleSave = () => {
    setAnthropicKey(drafts.anthropic.trim());
    setOpenaiKey(drafts.openai.trim());
    setGeminiKey(drafts.gemini.trim());
    setProvider(activeTab);
    setSaved(true);
    setTimeout(() => setSaved(false), 2000);
  };

  const cfg = PROVIDERS.find((p) => p.id === activeTab)!;
  const isKeySet = currentDraft.trim().length > 8;
  const savedKeys = { anthropic: anthropicKey, openai: openaiKey, gemini: geminiKey };
  const maskKey = (k: string) =>
    k.length > 8 ? k.slice(0, 4) + "••••••••••••" + k.slice(-4) : k;

  return (
    <>
      <div className="fixed inset-0 bg-black/60 z-40" onClick={closeSettings} />

      <div className="fixed inset-0 flex items-center justify-center z-50 pointer-events-none">
        <div
          className="pointer-events-auto w-full max-w-md bg-panel border border-border rounded-xl shadow-2xl"
          onClick={(e) => e.stopPropagation()}
        >
          {/* Header */}
          <div className="flex items-center justify-between px-5 py-4 border-b border-border">
            <h2 className="text-text-primary font-semibold text-sm">Settings</h2>
            <button
              onClick={closeSettings}
              className="text-text-muted hover:text-text-primary w-6 h-6 flex items-center justify-center rounded hover:bg-surface transition-colors"
            >
              ✕
            </button>
          </div>

          {/* Body */}
          <div className="px-5 py-5 space-y-5">
            {/* Provider tabs */}
            <div>
              <p className="text-xs font-medium text-text-secondary uppercase tracking-wide mb-3">
                AI Provider
              </p>
              <div className="flex gap-1 bg-surface rounded-lg p-1">
                {PROVIDERS.map((p) => {
                  const hasKey = savedKeys[p.id].trim().length > 0;
                  const isActive = activeTab === p.id;
                  const isSelected = provider === p.id;
                  return (
                    <button
                      key={p.id}
                      onClick={() => { setActiveTab(p.id); setSaved(false); }}
                      className={cn(
                        "relative flex-1 py-1.5 rounded-md text-xs font-medium transition-colors",
                        isActive
                          ? "bg-panel text-text-primary shadow-sm"
                          : "text-text-secondary hover:text-text-primary"
                      )}
                    >
                      {p.label}
                      {hasKey && (
                        <span
                          className={cn(
                            "absolute top-1 right-1.5 w-1.5 h-1.5 rounded-full",
                            isSelected ? "bg-accent" : "bg-green-500"
                          )}
                        />
                      )}
                    </button>
                  );
                })}
              </div>
              {provider !== activeTab && (
                <p className="text-[10px] text-text-muted mt-1.5">
                  Active provider:{" "}
                  <span className="text-accent capitalize">{provider}</span>.
                  Save to switch to {cfg.label}.
                </p>
              )}
            </div>

            {/* API Key input */}
            <div className="space-y-2">
              <label className="block text-xs font-medium text-text-secondary uppercase tracking-wide">
                {cfg.label} API Key
              </label>

              <div className="relative">
                <input
                  ref={inputRef}
                  type="password"
                  value={currentDraft}
                  onChange={(e) => { setCurrentDraft(e.target.value); setSaved(false); }}
                  onKeyDown={(e) => e.key === "Enter" && handleSave()}
                  placeholder={cfg.placeholder}
                  className={cn(
                    "w-full bg-surface border rounded-md px-3 py-2 text-sm text-text-primary",
                    "focus:outline-none placeholder:text-text-muted font-mono tracking-wider",
                    isKeySet ? "border-accent/50" : "border-border focus:border-accent"
                  )}
                />
                {isKeySet && (
                  <span className="absolute right-3 top-1/2 -translate-y-1/2 text-accent text-xs">
                    ✓
                  </span>
                )}
              </div>

              {savedKeys[activeTab] && (
                <p className="text-text-muted text-[11px]">
                  Saved:{" "}
                  <span className="font-mono text-text-secondary">
                    {maskKey(savedKeys[activeTab])}
                  </span>
                </p>
              )}
            </div>

            {/* How to get a key */}
            <div className="bg-surface border border-border rounded-lg px-4 py-3 text-[11px] text-text-muted space-y-1">
              <p className="font-medium text-text-secondary">How to get a key</p>
              {cfg.steps.map((step, i) => (
                <p key={i}>{i + 1}. {step}</p>
              ))}
            </div>
          </div>

          {/* Footer */}
          <div className="flex items-center justify-end gap-2 px-5 py-4 border-t border-border">
            <button
              onClick={closeSettings}
              className="px-3 py-1.5 text-sm text-text-secondary hover:text-text-primary rounded-md hover:bg-surface transition-colors"
            >
              Cancel
            </button>
            <button
              onClick={handleSave}
              className={cn(
                "px-4 py-1.5 text-sm rounded-md font-medium transition-colors",
                saved
                  ? "bg-green-600 text-white"
                  : "bg-accent hover:bg-accent-hover text-white"
              )}
            >
              {saved ? "✓ Saved" : "Save"}
            </button>
          </div>
        </div>
      </div>
    </>
  );
}
