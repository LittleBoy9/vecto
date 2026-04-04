import { useEffect, useRef, useState } from "react";
import { useSettingsStore } from "../../store/settingsStore";
import { cn } from "../../lib/utils";

export function SettingsModal() {
  const { apiKey, settingsOpen, setApiKey, closeSettings } = useSettingsStore();
  const [draft, setDraft] = useState(apiKey);
  const [saved, setSaved] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);

  // Sync draft when modal opens
  useEffect(() => {
    if (settingsOpen) {
      setDraft(apiKey);
      setSaved(false);
      setTimeout(() => inputRef.current?.focus(), 50);
    }
  }, [settingsOpen, apiKey]);

  // Close on Escape
  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if (e.key === "Escape" && settingsOpen) closeSettings();
    };
    window.addEventListener("keydown", handler);
    return () => window.removeEventListener("keydown", handler);
  }, [settingsOpen, closeSettings]);

  if (!settingsOpen) return null;

  const handleSave = () => {
    setApiKey(draft.trim());
    setSaved(true);
    setTimeout(() => setSaved(false), 2000);
  };

  const masked = draft.length > 8
    ? draft.slice(0, 4) + "••••••••••••••••" + draft.slice(-4)
    : draft;
  const isKeySet = draft.trim().length > 10;

  return (
    <>
      {/* Backdrop */}
      <div
        className="fixed inset-0 bg-black/60 z-40"
        onClick={closeSettings}
      />

      {/* Modal */}
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
            {/* API Key section */}
            <div className="space-y-2">
              <label className="block text-xs font-medium text-text-secondary uppercase tracking-wide">
                Anthropic API Key
              </label>
              <p className="text-text-muted text-[11px] leading-relaxed">
                Your key is saved locally on this machine and sent only to the
                Anthropic API. It is never uploaded or shared.
              </p>

              <div className="relative">
                <input
                  ref={inputRef}
                  type="password"
                  value={draft}
                  onChange={(e) => {
                    setDraft(e.target.value);
                    setSaved(false);
                  }}
                  onKeyDown={(e) => e.key === "Enter" && handleSave()}
                  placeholder="sk-ant-api03-..."
                  className={cn(
                    "w-full bg-surface border rounded-md px-3 py-2 text-sm text-text-primary",
                    "focus:outline-none placeholder:text-text-muted",
                    "font-mono tracking-wider",
                    isKeySet ? "border-accent/50" : "border-border focus:border-accent"
                  )}
                />
                {isKeySet && (
                  <span className="absolute right-3 top-1/2 -translate-y-1/2 text-accent text-xs">
                    ✓
                  </span>
                )}
              </div>

              {/* Key status */}
              {apiKey && (
                <p className="text-text-muted text-[11px]">
                  Current key:{" "}
                  <span className="font-mono text-text-secondary">{masked}</span>
                </p>
              )}
            </div>

            {/* Info box */}
            <div className="bg-surface border border-border rounded-lg px-4 py-3 text-[11px] text-text-muted space-y-1">
              <p className="font-medium text-text-secondary">How to get an API key</p>
              <p>1. Go to console.anthropic.com</p>
              <p>2. Create an account or sign in</p>
              <p>3. Navigate to API Keys → Create Key</p>
              <p>4. Paste the key above</p>
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
              disabled={!draft.trim()}
              className={cn(
                "px-4 py-1.5 text-sm rounded-md font-medium transition-colors",
                saved
                  ? "bg-green-600 text-white"
                  : "bg-accent hover:bg-accent-hover text-white",
                "disabled:opacity-40 disabled:cursor-not-allowed"
              )}
            >
              {saved ? "✓ Saved" : "Save Key"}
            </button>
          </div>
        </div>
      </div>
    </>
  );
}
