import { useEffect, useRef, useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";
import { parseSVG } from "../../lib/svgParser";
import { useDocumentStore, beginUndoBatch, endUndoBatch } from "../../store/documentStore";
import type { VectoDocument } from "../../types/svg";
import { useSelectionStore } from "../../store/selectionStore";
import { useUIStore } from "../../store/uiStore";
import { useSettingsStore, activeKey, activeModel, PROVIDER_MODELS, type Provider } from "../../store/settingsStore";
import { extractSvg, extractPartialSvg } from "../../lib/svgExtract";
import { cn } from "../../lib/utils";

const MAX_CHARS = 4000;

// ── Shared generate logic ─────────────────────────────────────────────────────

interface UseGenerateOptions {
  prompt: string;
  apiKey: string;
  provider: string;
  model: string;
  hasKey: boolean;
  openSettings: () => void;
  isGenerating: boolean;
  setGenerating: (v: boolean) => void;
  setDocument: (doc: VectoDocument, filePath?: string) => void;
  clearSelection: () => void;
  onError: (msg: string | null) => void;
  /** True if the user pressed Stop — suppresses the "no valid SVG" error. */
  wasCancelled: () => boolean;
}

async function runGenerate({
  prompt,
  apiKey,
  provider,
  model,
  hasKey,
  openSettings,
  isGenerating,
  setGenerating,
  setDocument,
  clearSelection,
  onError,
  wasCancelled,
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

  // Whole generation (all streamed partials + final) = one undo entry.
  beginUndoBatch();

  const accumulated = { text: "" };
  let lastRenderMs = 0;
  // Reuse one stable doc id across every partial parse. parseSVG mints a fresh
  // id per call, and the canvas re-fits the view whenever the id changes — so
  // without this the artwork would jump on every streamed chunk.
  const streamDocId = crypto.randomUUID();

  const render = (svg: string) => {
    const doc = parseSVG(svg);
    doc.id = streamDocId;
    setDocument(doc);
  };

  const unlisten = await listen<string>("svg:chunk", (event) => {
    accumulated.text += event.payload;

    // Throttle canvas updates to ~10 fps during streaming
    const now = Date.now();
    if (now - lastRenderMs < 100) return;
    lastRenderMs = now;

    const partial = extractPartialSvg(accumulated.text);
    if (!partial) return;
    try {
      render(partial);
    } catch {
      // Ignore — partial SVG may be temporarily malformed mid-stream
    }
  });

  try {
    await invoke("generate_svg_stream", { prompt: trimmed, apiKey, provider, model });

    // Final authoritative render from the complete response
    const final = extractSvg(accumulated.text);
    if (final) {
      render(final);
    } else if (!wasCancelled() && !accumulated.text.includes("<svg")) {
      // A cancelled run legitimately ends with no complete SVG — not an error.
      onError("The model did not return valid SVG markup. Try rephrasing your prompt.");
    }
  } catch (err) {
    onError(String(err));
  } finally {
    unlisten();
    endUndoBatch();
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

// ── Variant picker ────────────────────────────────────────────────────────────

interface VariantTrayProps {
  svgs: string[];
  busy: boolean;
  count: number;
  onPick: (svg: string) => void;
  onClose: () => void;
  onRegenerate: () => void;
}

function VariantTray({ svgs, busy, count, onPick, onClose, onRegenerate }: VariantTrayProps) {
  const slots = busy && svgs.length === 0 ? Array.from({ length: count }) : svgs;
  return (
    <>
      <div className="fixed inset-0 bg-black/60 z-40" onClick={onClose} />
      <div className="fixed inset-0 flex items-center justify-center z-50 p-6 pointer-events-none">
        <div
          className="pointer-events-auto w-full max-w-3xl bg-panel border border-border rounded-xl shadow-2xl flex flex-col"
          onClick={(e) => e.stopPropagation()}
        >
          <div className="flex items-center justify-between px-4 py-3 border-b border-border">
            <span className="text-text-secondary text-xs font-medium uppercase tracking-wide">
              {busy && svgs.length === 0 ? "Generating variants…" : "Pick a variant"}
            </span>
            <button
              onClick={onClose}
              className="w-6 h-6 flex items-center justify-center text-text-muted hover:text-text-primary rounded hover:bg-surface transition-colors"
            >
              ✕
            </button>
          </div>

          <div className="grid grid-cols-2 gap-3 p-4">
            {slots.map((svg, i) =>
              svg ? (
                <button
                  key={i}
                  onClick={() => onPick(svg as string)}
                  title="Use this variant"
                  className="group relative aspect-[4/3] bg-canvas rounded-lg border border-border hover:border-accent overflow-hidden transition-colors"
                >
                  <img
                    src={`data:image/svg+xml,${encodeURIComponent(svg as string)}`}
                    alt={`Variant ${i + 1}`}
                    className="w-full h-full object-contain p-2"
                  />
                  <span className="absolute bottom-1 right-2 text-[10px] text-text-muted group-hover:text-accent">
                    {i + 1}
                  </span>
                </button>
              ) : (
                <div
                  key={i}
                  className="aspect-[4/3] bg-canvas rounded-lg border border-border flex items-center justify-center"
                >
                  <span className="animate-spin text-text-muted">⟳</span>
                </div>
              )
            )}
          </div>

          <div className="flex items-center justify-end px-4 py-3 border-t border-border">
            <button
              onClick={onRegenerate}
              disabled={busy}
              className="text-xs text-text-secondary hover:text-text-primary underline disabled:opacity-40"
            >
              ↻ Regenerate
            </button>
          </div>
        </div>
      </div>
    </>
  );
}

// ── Prompt bar (inline, bottom of app) ───────────────────────────────────────

const VARIANT_COUNT = 4;

const STYLE_PRESETS = [
  { id: "flat", label: "Flat", text: "flat vector illustration, clean solid colors, minimal detail" },
  { id: "gradient", label: "Gradient", text: "modern gradient style, smooth color transitions" },
  { id: "3d", label: "3D", text: "3D-style with depth, soft shadows and highlights" },
  { id: "line", label: "Line art", text: "clean line-art, consistent stroke weight, no fills" },
  { id: "sticker", label: "Sticker", text: "die-cut sticker style, bold outline, vibrant colors" },
  { id: "minimal", label: "Minimal", text: "minimalist geometric style, few shapes, negative space" },
];

export function PromptBar() {
  const [prompt, setPrompt] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [expanded, setExpanded] = useState(false);
  const [variants, setVariants] = useState<string[] | null>(null);
  const [variantsBusy, setVariantsBusy] = useState(false);
  const [styleId, setStyleId] = useState<string | null>(null);
  const cancelledRef = useRef(false);

  // Prepend the chosen style preset to the prompt before generation.
  const styled = (p: string) => {
    const preset = STYLE_PRESETS.find((s) => s.id === styleId);
    return preset ? `${p.trim()}. Style: ${preset.text}` : p;
  };

  const isGenerating = useUIStore((s) => s.isGenerating);
  const setGenerating = useUIStore((s) => s.setGenerating);
  const setDocument = useDocumentStore((s) => s.setDocument);
  const clearSelection = useSelectionStore((s) => s.clearSelection);
  const settingsState = useSettingsStore();
  const { openSettings } = settingsState;
  const apiKey = activeKey(settingsState);
  const provider = settingsState.provider;
  const model = activeModel(settingsState);
  const modelShort =
    PROVIDER_MODELS[provider as Provider].find((m) => m.id === model)?.label.split(" — ")[0] ?? model;

  const hasKey = apiKey.trim().length > 0;
  const charCount = prompt.length;
  const nearLimit = charCount > MAX_CHARS * 0.85;

  const generateArgs: UseGenerateOptions = {
    prompt,
    apiKey,
    provider,
    model,
    hasKey,
    openSettings,
    isGenerating,
    setGenerating,
    setDocument,
    clearSelection,
    onError: setError,
    wasCancelled: () => cancelledRef.current,
  };

  const handleGenerate = () => {
    cancelledRef.current = false;
    runGenerate({ ...generateArgs, prompt: styled(prompt) }).then(() => {
      if (expanded) setExpanded(false);
    });
  };

  const runVariants = async () => {
    const trimmed = styled(prompt).trim();
    if (!prompt.trim() || variantsBusy || isGenerating) return;
    if (!hasKey) { openSettings(); return; }
    cancelledRef.current = false;
    setError(null);
    setVariants([]);
    setVariantsBusy(true);
    try {
      const svgs = await invoke<string[]>("generate_svg_variants", {
        prompt: trimmed, apiKey, provider, model, count: VARIANT_COUNT,
      });
      setVariants(svgs.length ? svgs : null); // empty = cancelled

    } catch (err) {
      if (!cancelledRef.current) setError(String(err));
      setVariants(null);
    } finally {
      setVariantsBusy(false);
    }
  };

  /** Ask the backend to abort whatever generation is in flight. */
  const cancelRun = () => {
    cancelledRef.current = true;
    invoke("cancel_ai").catch(() => { /* nothing in flight */ });
  };

  const applyVariant = (svg: string) => {
    try {
      setDocument(parseSVG(svg));
      clearSelection();
    } catch {
      setError("That variant couldn't be parsed.");
    }
    setVariants(null);
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

        {/* Style preset chips */}
        <div className="flex items-center gap-1 px-4 pt-2 overflow-x-auto scrollbar-thin">
          <span className="text-[10px] text-text-muted flex-shrink-0 mr-1">Style:</span>
          {STYLE_PRESETS.map((s) => (
            <button
              key={s.id}
              onClick={() => setStyleId((id) => (id === s.id ? null : s.id))}
              className={cn(
                "flex-shrink-0 px-2 py-0.5 rounded-full text-[10px] border transition-colors",
                styleId === s.id
                  ? "bg-accent/15 border-accent text-accent"
                  : "bg-surface border-border text-text-secondary hover:text-text-primary"
              )}
            >
              {s.label}
            </button>
          ))}
        </div>

        <div className="flex items-start gap-2 px-4 pt-2 pb-2">
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
            {hasKey ? (
              <button
                onClick={openSettings}
                title={`${provider} · ${model} — click to change`}
                className="flex items-center gap-1 text-[10px] text-text-muted hover:text-text-primary transition-colors max-w-[160px]"
              >
                <span className="text-accent">✦</span>
                <span className="truncate">{modelShort}</span>
                <span className="opacity-60">▾</span>
              </button>
            ) : (
              <button
                onClick={openSettings}
                className="text-accent hover:text-accent-hover text-[10px] underline"
              >
                Set API key
              </button>
            )}
            <div className="flex items-center gap-1.5">
              <button
                onClick={runVariants}
                disabled={isGenerating || variantsBusy || !prompt.trim()}
                title={`Generate ${VARIANT_COUNT} variations to choose from`}
                className={cn(
                  "flex items-center justify-center w-8 h-8 rounded-md text-sm",
                  "bg-surface text-text-secondary hover:text-text-primary hover:bg-surface-hover",
                  "border border-border disabled:opacity-40 disabled:cursor-not-allowed transition-colors"
                )}
              >
                {variantsBusy ? <span className="animate-spin inline-block">⟳</span> : "⊞"}
              </button>
              {isGenerating || variantsBusy ? (
                <button
                  onClick={cancelRun}
                  title="Stop the request in flight"
                  className={cn(
                    "flex items-center gap-1.5 px-3 py-1.5 rounded-md text-sm font-medium",
                    "bg-surface border border-border text-text-secondary",
                    "hover:text-danger hover:border-danger transition-colors"
                  )}
                >
                  <span className="animate-spin inline-block">⟳</span> Stop
                </button>
              ) : (
                <button
                  onClick={handleGenerate}
                  disabled={!prompt.trim()}
                  className={cn(
                    "flex items-center gap-1.5 px-3 py-1.5 rounded-md text-sm font-medium",
                    "bg-accent text-white hover:bg-accent-hover",
                    "disabled:opacity-40 disabled:cursor-not-allowed transition-colors"
                  )}
                >
                  ✦ Generate
                </button>
              )}
            </div>
          </div>
        </div>
      </div>

      {/* Variant picker */}
      {(variants !== null || variantsBusy) && (
        <VariantTray
          svgs={variants ?? []}
          busy={variantsBusy}
          count={VARIANT_COUNT}
          onPick={applyVariant}
          onClose={() => setVariants(null)}
          onRegenerate={runVariants}
        />
      )}

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
