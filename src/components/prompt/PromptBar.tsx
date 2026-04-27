import { useEffect, useRef, useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";
import { parseSVG } from "../../lib/svgParser";
import { useDocumentStore } from "../../store/documentStore";
import type { VectoDocument } from "../../types/svg";
import { useSelectionStore } from "../../store/selectionStore";
import { useUIStore } from "../../store/uiStore";
import { useSettingsStore, activeKey } from "../../store/settingsStore";
import { cn } from "../../lib/utils";

const MAX_CHARS = 4000;

// ── Shared generate logic ─────────────────────────────────────────────────────

interface UseGenerateOptions {
  prompt: string;
  apiKey: string;
  provider: string;
  hasKey: boolean;
  openSettings: () => void;
  isGenerating: boolean;
  setGenerating: (v: boolean) => void;
  setDocument: (doc: VectoDocument, filePath?: string) => void;
  clearSelection: () => void;
  onError: (msg: string | null) => void;
}

/** Find the complete <svg>...</svg> block in accumulated text. */
function extractSvg(text: string): string | null {
  const start = text.indexOf("<svg");
  if (start === -1) return null;
  const end = text.lastIndexOf("</svg>");
  if (end === -1 || end < start) return null;
  return text.slice(start, end + "</svg>".length);
}

/**
 * Extract whatever SVG we have so far — close the tag artificially if the
 * stream hasn't finished yet so the browser can attempt a render.
 */
function extractPartialSvg(text: string): string | null {
  const start = text.indexOf("<svg");
  if (start === -1) return null;
  const end = text.lastIndexOf("</svg>");
  if (end !== -1) return text.slice(start, end + "</svg>".length);
  // Partial: close it so the SVG parser has something valid to attempt
  return text.slice(start) + "</svg>";
}

async function runGenerate({
  prompt,
  apiKey,
  provider,
  hasKey,
  openSettings,
  isGenerating,
  setGenerating,
  setDocument,
  clearSelection,
  onError,
}: UseGenerateOptions) {
  const trimmed = prompt.trim();
  if (!trimmed || isGenerating) return;

  if (!hasKey) {
    openSettings();
    return;
  }

  onError(null);
  setGenerating(true);
  clearSelection();

  // Pause undo history — streaming produces many intermediate states;
  // resume at the end so the final SVG is a single undo entry.
  useDocumentStore.temporal.getState().pause();

  const accumulated = { text: "" };
  let lastRenderMs = 0;

  const unlisten = await listen<string>("svg:chunk", (event) => {
    accumulated.text += event.payload;

    // Throttle canvas updates to ~10 fps during streaming
    const now = Date.now();
    if (now - lastRenderMs < 100) return;
    lastRenderMs = now;

    const partial = extractPartialSvg(accumulated.text);
    if (!partial) return;
    try {
      setDocument(parseSVG(partial));
    } catch {
      // Ignore — partial SVG may be temporarily malformed mid-stream
    }
  });

  try {
    await invoke("generate_svg_stream", { prompt: trimmed, apiKey, provider });

    // Final authoritative render from the complete response
    const final = extractSvg(accumulated.text);
    if (final) {
      setDocument(parseSVG(final));
    } else if (!accumulated.text.includes("<svg")) {
      onError("Claude did not return valid SVG markup. Try rephrasing your prompt.");
    }
  } catch (err) {
    onError(String(err));
  } finally {
    unlisten();
    useDocumentStore.temporal.getState().resume();
    setGenerating(false);
  }
}

// ── Expand modal ──────────────────────────────────────────────────────────────

interface ExpandModalProps {
  prompt: string;
  onChange: (v: string) => void;
  onClose: () => void;
  onGenerate: () => void;
  isGenerating: boolean;
  error: string | null;
  onClearError: () => void;
  hasKey: boolean;
  openSettings: () => void;
}

function ExpandModal({
  prompt,
  onChange,
  onClose,
  onGenerate,
  isGenerating,
  error,
  onClearError,
  hasKey,
  openSettings,
}: ExpandModalProps) {
  const textareaRef = useRef<HTMLTextAreaElement>(null);

  // Focus on mount, close on Escape
  useEffect(() => {
    textareaRef.current?.focus();
    const handler = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    window.addEventListener("keydown", handler);
    return () => window.removeEventListener("keydown", handler);
  }, [onClose]);

  const handleKeyDown = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) {
      e.preventDefault();
      onGenerate();
    }
  };

  const charCount = prompt.length;
  const nearLimit = charCount > MAX_CHARS * 0.85;

  return (
    <>
      {/* Backdrop */}
      <div className="fixed inset-0 bg-black/60 z-40" onClick={onClose} />

      {/* Modal */}
      <div className="fixed inset-0 flex items-end justify-center z-50 pb-6 px-6 pointer-events-none">
        <div
          className="pointer-events-auto w-full max-w-3xl bg-panel border border-border rounded-xl shadow-2xl flex flex-col"
          onClick={(e) => e.stopPropagation()}
        >
          {/* Header */}
          <div className="flex items-center justify-between px-4 py-3 border-b border-border">
            <div className="flex items-center gap-2">
              <span className="text-accent text-sm">✦</span>
              <span className="text-text-secondary text-xs font-medium uppercase tracking-wide">
                Prompt
              </span>
            </div>
            <div className="flex items-center gap-2">
              <span className="text-[10px] text-text-muted">
                ⌘↵ to generate · Esc to close
              </span>
              <button
                onClick={onClose}
                className="w-6 h-6 flex items-center justify-center text-text-muted hover:text-text-primary rounded hover:bg-surface transition-colors"
              >
                ✕
              </button>
            </div>
          </div>

          {/* Error */}
          {error && (
            <div className="flex items-center gap-2 px-4 py-2 text-[11px] text-danger bg-danger/10 border-b border-danger/20">
              <span className="flex-1">{error}</span>
              {error.toLowerCase().includes("api key") && (
                <button
                  className="underline text-accent"
                  onClick={() => { onClearError(); openSettings(); onClose(); }}
                >
                  Open Settings
                </button>
              )}
              <button className="underline opacity-60" onClick={onClearError}>
                dismiss
              </button>
            </div>
          )}

          {/* Textarea */}
          <div className="relative p-4">
            <textarea
              ref={textareaRef}
              value={prompt}
              onChange={(e) => onChange(e.target.value.slice(0, MAX_CHARS))}
              onKeyDown={handleKeyDown}
              disabled={isGenerating}
              placeholder={
                hasKey
                  ? "Describe what you want to generate in detail…"
                  : "Add your Anthropic API key in Settings first"
              }
              rows={8}
              className={cn(
                "w-full resize-none bg-surface text-text-primary text-sm px-3 py-2.5 rounded-lg",
                "border border-border focus:outline-none focus:border-accent",
                "placeholder:text-text-muted disabled:opacity-50",
                "transition-colors leading-relaxed"
              )}
            />
            {/* Char counter */}
            <span
              className={cn(
                "absolute bottom-6 right-6 text-[10px] pointer-events-none",
                nearLimit ? "text-danger" : "text-text-muted"
              )}
            >
              {charCount}/{MAX_CHARS}
            </span>
          </div>

          {/* Footer */}
          <div className="flex items-center justify-between px-4 py-3 border-t border-border">
            {!hasKey ? (
              <button
                onClick={() => { openSettings(); onClose(); }}
                className="text-accent hover:text-accent-hover text-xs underline"
              >
                Set API key first
              </button>
            ) : (
              <span className="text-text-muted text-[11px]">API key configured ✓</span>
            )}

            <button
              onClick={onGenerate}
              disabled={isGenerating || !prompt.trim()}
              className={cn(
                "flex items-center gap-1.5 px-4 py-2 rounded-lg text-sm font-medium",
                "bg-accent text-white hover:bg-accent-hover",
                "disabled:opacity-40 disabled:cursor-not-allowed transition-colors"
              )}
            >
              {isGenerating ? (
                <><span className="animate-spin inline-block">⟳</span> Generating…</>
              ) : (
                <>✦ Generate</>
              )}
            </button>
          </div>
        </div>
      </div>
    </>
  );
}

// ── Prompt bar (inline, bottom of app) ───────────────────────────────────────

export function PromptBar() {
  const [prompt, setPrompt] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [expanded, setExpanded] = useState(false);

  const isGenerating = useUIStore((s) => s.isGenerating);
  const setGenerating = useUIStore((s) => s.setGenerating);
  const setDocument = useDocumentStore((s) => s.setDocument);
  const clearSelection = useSelectionStore((s) => s.clearSelection);
  const settingsState = useSettingsStore();
  const { openSettings } = settingsState;
  const apiKey = activeKey(settingsState);
  const provider = settingsState.provider;

  const hasKey = apiKey.trim().length > 0;
  const charCount = prompt.length;
  const nearLimit = charCount > MAX_CHARS * 0.85;

  const generateArgs: UseGenerateOptions = {
    prompt,
    apiKey,
    provider,
    hasKey,
    openSettings,
    isGenerating,
    setGenerating,
    setDocument,
    clearSelection,
    onError: setError,
  };

  const handleGenerate = () => {
    runGenerate(generateArgs).then(() => {
      if (expanded) setExpanded(false);
    });
  };

  const handleKeyDown = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    // Enter without Shift → generate
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      handleGenerate();
    }
  };

  return (
    <>
      <div className="flex-shrink-0 border-t border-border bg-panel">
        {/* Error banner */}
        {error && (
          <div className="flex items-center gap-2 px-4 py-1.5 text-[11px] text-danger bg-danger/10 border-b border-danger/20">
            <span className="flex-1">{error}</span>
            {error.toLowerCase().includes("api key") && (
              <button
                className="underline text-accent hover:text-accent-hover"
                onClick={() => { setError(null); openSettings(); }}
              >
                Open Settings
              </button>
            )}
            <button
              className="underline opacity-60 hover:opacity-100"
              onClick={() => setError(null)}
            >
              dismiss
            </button>
          </div>
        )}

        <div className="flex items-start gap-2 px-4 pt-2.5 pb-2">
          {/* Spark icon */}
          <span className="text-text-muted text-sm flex-shrink-0 mt-[7px]">✦</span>

          {/* Textarea wrapper — relative so we can position the char counter */}
          <div className="relative flex-1">
            <textarea
              value={prompt}
              onChange={(e) => setPrompt(e.target.value.slice(0, MAX_CHARS))}
              onKeyDown={handleKeyDown}
              disabled={isGenerating}
              placeholder={
                hasKey
                  ? "Describe what to generate… (Enter to send, Shift+Enter for new line)"
                  : "Add your Anthropic API key in Settings to generate SVGs"
              }
              rows={2}
              className={cn(
                "w-full resize-none bg-surface text-text-primary text-sm px-3 py-2 rounded-md",
                "border border-border focus:outline-none focus:border-accent",
                "placeholder:text-text-muted disabled:opacity-50 transition-colors",
                "leading-relaxed pb-4" // extra bottom padding for the char counter
              )}
            />

            {/* Char counter — bottom right of textarea */}
            {charCount > 0 && (
              <span
                className={cn(
                  "absolute bottom-1.5 right-2 text-[10px] pointer-events-none select-none",
                  nearLimit ? "text-danger" : "text-text-muted"
                )}
              >
                {charCount}/{MAX_CHARS}
              </span>
            )}

            {/* Expand button — top right of textarea */}
            <button
              title="Expand prompt editor"
              onClick={() => setExpanded(true)}
              className="absolute top-1.5 right-1.5 w-5 h-5 flex items-center justify-center text-text-muted hover:text-text-primary hover:bg-surface-hover rounded transition-colors"
            >
              <svg width="11" height="11" viewBox="0 0 11 11" fill="none">
                <path d="M1 10L10 1M10 1H6M10 1V5" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" strokeLinejoin="round"/>
              </svg>
            </button>
          </div>

          {/* Right column — API key hint + Generate button */}
          <div className="flex flex-col items-end gap-1 flex-shrink-0">
            {!hasKey && (
              <button
                onClick={openSettings}
                className="text-accent hover:text-accent-hover text-[10px] underline"
              >
                Set API key
              </button>
            )}
            <button
              onClick={handleGenerate}
              disabled={isGenerating || !prompt.trim()}
              className={cn(
                "flex items-center gap-1.5 px-3 py-1.5 rounded-md text-sm font-medium",
                "bg-accent text-white hover:bg-accent-hover",
                "disabled:opacity-40 disabled:cursor-not-allowed transition-colors"
              )}
            >
              {isGenerating ? (
                <><span className="animate-spin inline-block">⟳</span> Generating</>
              ) : (
                <>✦ Generate</>
              )}
            </button>
          </div>
        </div>
      </div>

      {/* Expand modal */}
      {expanded && (
        <ExpandModal
          prompt={prompt}
          onChange={setPrompt}
          onClose={() => setExpanded(false)}
          onGenerate={handleGenerate}
          isGenerating={isGenerating}
          error={error}
          onClearError={() => setError(null)}
          hasKey={hasKey}
          openSettings={openSettings}
        />
      )}
    </>
  );
}
