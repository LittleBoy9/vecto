import { useCallback, useEffect, useRef, useState, type ReactNode } from "react";
import { useDocumentStore, beginUndoBatch, endUndoBatch } from "../../store/documentStore";
import { useSelectionStore } from "../../store/selectionStore";
import { usePanelStore } from "../../store/panelStore";
import { cn, colorToHex } from "../../lib/utils";
import { findNode } from "../../lib/nodeUtils";
import { getDocBBox, unionDocBBox } from "../../lib/bbox";
import { runAiEdit } from "../../lib/aiEdit";
import { makeFilter, newFilterId } from "../../lib/effects";
import { ColorPopover } from "../ui/ColorPopover";
import { FontPicker } from "../ui/FontPicker";
import {
  makeLinearGradient, newGradientId, gradientCss, linearAngle, setLinearAngle, toHexSeed,
} from "../../lib/gradient";
import type { VectoNode, VectoGradient, GradientStop, BoundingBox } from "../../types/svg";

function fmt(n: number) { return parseFloat(n.toFixed(3)).toString(); }

const MIN_WIDTH = 200;
const MAX_WIDTH = 520;

// ── Attribute row ─────────────────────────────────────────────────────────────

interface AttrRowProps {
  label: string;
  value: string;
  nodeId: string;
  attrKey: string;
}

function AttrRow({ label, value, nodeId, attrKey }: AttrRowProps) {
  const update = useDocumentStore((s) => s.updateNodeAttributes);

  return (
    <div className="flex items-center gap-2 pl-4 pr-3 py-[5px] w-full min-w-0">
      <label className="text-text-muted text-[10px] w-20 flex-shrink-0 uppercase tracking-wide truncate">
        {label}
      </label>
      <input
        className="flex-1 min-w-0 bg-surface border border-border rounded px-2 py-0.5 text-[11px] text-text-primary focus:outline-none focus:border-accent truncate"
        defaultValue={value}
        onBlur={(e) => {
          const next = e.currentTarget.value.trim();
          if (next !== value) update(nodeId, { [attrKey]: next });
        }}
        onKeyDown={(e) => {
          if (e.key === "Enter") e.currentTarget.blur();
          if (e.key === "Escape") {
            e.currentTarget.value = value;
            e.currentTarget.blur();
          }
        }}
      />
    </div>
  );
}

// ── Color row ─────────────────────────────────────────────────────────────────

interface ColorRowProps {
  label: string;
  value: string;
  nodeId: string;
  attrKey: string;
}

function ColorRow({ label, value, nodeId, attrKey }: ColorRowProps) {
  const update = useDocumentStore((s) => s.updateNodeAttributes);
  const addGradient = useDocumentStore((s) => s.addGradient);
  const [pickerOpen, setPickerOpen] = useState(false);
  const swatchRef = useRef<HTMLButtonElement>(null);
  // Collapse a whole pick (drag across the field) into one undo step.
  const batchingRef = useRef(false);

  const makeGradient = () => {
    const id = newGradientId();
    const base = !value || value === "none" ? "#888888" : toHexSeed(value);
    addGradient(makeLinearGradient(id, base));
    update(nodeId, { [attrKey]: `url(#${id})` });
  };

  const handlePick = (hex: string) => {
    if (!batchingRef.current) { beginUndoBatch(); batchingRef.current = true; }
    update(nodeId, { [attrKey]: hex });
  };
  const closePicker = () => {
    if (batchingRef.current) { endUndoBatch(); batchingRef.current = false; }
    setPickerOpen(false);
  };

  const isNone = !value || value === "none";
  // Always show hex — resolves named colors like "white" → "#ffffff"
  const hexValue = isNone ? "" : colorToHex(value);
  const pickerValue = isNone ? "#000000" : (hexValue.startsWith("#") ? hexValue : "#000000");

  return (
    <div className="flex items-center gap-2 pl-4 pr-3 py-[5px] w-full min-w-0">
      <label className="text-text-muted text-[10px] w-20 flex-shrink-0 uppercase tracking-wide truncate">
        {label}
      </label>
      <div className="flex items-center gap-1.5 flex-1 min-w-0">
        {/* Swatch → custom in-app color popover */}
        <button
          ref={swatchRef}
          type="button"
          onClick={() => setPickerOpen((o) => !o)}
          title="Pick a color"
          className="flex-shrink-0 relative w-5 h-5 rounded border border-border"
          style={{ background: isNone ? "transparent" : (hexValue || value) }}
        >
          {isNone && (
            <svg className="absolute inset-0" viewBox="0 0 20 20">
              <line x1="2" y1="2" x2="18" y2="18" stroke="#ef4444" strokeWidth="1.5" />
            </svg>
          )}
        </button>
        {pickerOpen && (
          <ColorPopover
            value={pickerValue}
            anchor={swatchRef.current}
            onChange={handlePick}
            onClose={closePicker}
          />
        )}

        {/* Hex text input */}
        <input
          className="flex-1 min-w-0 bg-surface border border-border rounded px-2 py-0.5 text-[11px] text-text-primary focus:outline-none focus:border-accent font-mono"
          defaultValue={isNone ? "none" : hexValue}
          key={isNone ? "none" : hexValue} // re-mount when value changes externally
          onBlur={(e) => {
            const next = e.currentTarget.value.trim();
            if (next !== value) update(nodeId, { [attrKey]: next });
          }}
          onKeyDown={(e) => {
            if (e.key === "Enter") e.currentTarget.blur();
            if (e.key === "Escape") {
              e.currentTarget.value = isNone ? "none" : hexValue;
              e.currentTarget.blur();
            }
          }}
        />
        {attrKey === "fill" && (
          <button
            type="button"
            onClick={makeGradient}
            title="Convert to gradient"
            className="flex-shrink-0 w-5 h-5 rounded border border-border overflow-hidden"
            style={{ background: "linear-gradient(135deg, #0ea5e9, #ec4899)" }}
          />
        )}
      </div>
    </div>
  );
}

// ── Node properties body ──────────────────────────────────────────────────────

const VISUAL_ATTRS = [
  "fill", "stroke", "stroke-width", "opacity", "fill-opacity", "stroke-opacity",
  "d", "cx", "cy", "r", "rx", "ry", "x", "y", "width", "height",
  "x1", "y1", "x2", "y2", "points", "transform",
  "font-size", "font-family", "font-weight", "text-anchor", "letter-spacing",
];
const COLOR_ATTRS = new Set(["fill", "stroke"]);
const TEXT_TAGS = new Set(["text", "tspan", "textpath"]);
// Handled by StyleSection — hidden from the raw attribute list to avoid dupes.
const STYLE_BASE_KEYS = ["opacity", "stroke-width", "stroke-linecap", "stroke-linejoin", "stroke-dasharray"];

const num = (v: string | undefined, d: number) => {
  const n = parseFloat(v ?? "");
  return Number.isFinite(n) ? n : d;
};

/** Extract visible plain text from an innerHTML string (strips tspan tags). */
function extractPlainText(raw: string): string {
  const el = document.createElement("span");
  el.innerHTML = raw;
  return el.textContent ?? "";
}

// ── Text content editor ───────────────────────────────────────────────────────

interface TextContentRowProps {
  node: VectoNode;
  focusRef?: React.RefObject<HTMLTextAreaElement>;
}

function TextContentRow({ node, focusRef }: TextContentRowProps) {
  const updateRawContent = useDocumentStore((s) => s.updateNodeRawContent);
  const plain = node.rawContent !== undefined ? extractPlainText(node.rawContent) : "";
  const [draft, setDraft] = useState(plain);
  // True while an edit batch is open, so the whole edit collapses to one undo step.
  const batchingRef = useRef(false);

  // Sync draft when node changes (e.g. different element selected)
  useEffect(() => {
    setDraft(extractPlainText(node.rawContent ?? ""));
  }, [node.id, node.rawContent]);

  const endBatch = () => {
    if (batchingRef.current) {
      endUndoBatch();
      batchingRef.current = false;
    }
  };

  return (
    <div className="px-4 py-2 w-full min-w-0 border-b border-border">
      <label className="block text-[10px] text-text-muted uppercase tracking-wide mb-1.5">
        Text Content
      </label>
      <textarea
        ref={focusRef}
        value={draft}
        rows={3}
        onChange={(e) => {
          // Open the undo batch on the first keystroke of an edit.
          if (!batchingRef.current) {
            beginUndoBatch();
            batchingRef.current = true;
          }
          setDraft(e.target.value);
          updateRawContent(node.id, e.target.value);
        }}
        onBlur={endBatch}
        onKeyDown={(e) => {
          // Don't let Escape propagate (would clear canvas selection)
          if (e.key === "Escape") {
            e.stopPropagation();
            setDraft(plain);
            updateRawContent(node.id, plain);
            endBatch();
            (e.target as HTMLTextAreaElement).blur();
          }
        }}
        className="w-full resize-none bg-surface border border-border rounded px-2 py-1.5
                   text-[11px] text-text-primary focus:outline-none focus:border-accent
                   leading-relaxed placeholder:text-text-muted"
        placeholder="Enter text content…"
      />
    </div>
  );
}

// ── Style controls (opacity / stroke / corner radius) ─────────────────────────

function StyleSlider({ label, value, min, max, step, onCommit, format }: {
  label: string; value: number; min: number; max: number; step: number;
  onCommit: (v: string) => void; format?: (v: number) => string;
}) {
  const [v, setV] = useState(value);
  const batching = useRef(false);
  useEffect(() => { setV(value); }, [value]);
  return (
    <div className="flex items-center gap-2">
      <label className="text-text-muted text-[10px] w-20 flex-shrink-0 uppercase tracking-wide truncate">{label}</label>
      <input
        type="range" min={min} max={max} step={step} value={v}
        onPointerDown={() => { if (!batching.current) { beginUndoBatch(); batching.current = true; } }}
        onChange={(e) => { const nv = parseFloat(e.target.value); setV(nv); onCommit(String(nv)); }}
        onPointerUp={() => { if (batching.current) { endUndoBatch(); batching.current = false; } }}
        className="flex-1 min-w-0 accent-accent"
      />
      <span className="text-[10px] text-text-secondary w-9 text-right tabular-nums">
        {format ? format(v) : v}
      </span>
    </div>
  );
}

function NumRow({ label, value, onCommit }: { label: string; value: string; onCommit: (v: string) => void }) {
  return (
    <div className="flex items-center gap-2">
      <label className="text-text-muted text-[10px] w-20 flex-shrink-0 uppercase tracking-wide truncate">{label}</label>
      <input
        type="number" min="0" step="0.5" defaultValue={value} key={value} placeholder="0"
        onBlur={(e) => onCommit(e.currentTarget.value.trim())}
        onKeyDown={(e) => { if (e.key === "Enter") e.currentTarget.blur(); }}
        className="flex-1 min-w-0 bg-surface border border-border rounded px-2 py-0.5 text-[11px] text-text-primary focus:outline-none focus:border-accent"
      />
    </div>
  );
}

function ToggleRow({ label, value, options, onChange }: {
  label: string; value: string; options: { v: string; label: string }[]; onChange: (v: string) => void;
}) {
  return (
    <div className="flex items-center gap-2">
      <label className="text-text-muted text-[10px] w-20 flex-shrink-0 uppercase tracking-wide truncate">{label}</label>
      <div className="flex-1 flex gap-1 min-w-0">
        {options.map((o) => (
          <button
            key={o.v}
            onClick={() => onChange(o.v)}
            className={cn(
              "flex-1 h-6 rounded text-[10px] border transition-colors truncate px-1",
              value === o.v
                ? "bg-accent/15 border-accent text-accent"
                : "bg-surface border-border text-text-secondary hover:text-text-primary"
            )}
          >
            {o.label}
          </button>
        ))}
      </div>
    </div>
  );
}

function StyleSection({ node }: { node: VectoNode }) {
  const update = useDocumentStore((s) => s.updateNodeAttributes);
  const a = node.attributes;
  const set = (k: string, v: string) => update(node.id, { [k]: v });
  const dash = (a["stroke-dasharray"] ?? "").trim();

  return (
    <div className="px-4 py-2 border-b border-border space-y-2">
      <label className="block text-[10px] text-text-muted uppercase tracking-wide">Style</label>

      <StyleSlider
        label="Opacity" value={num(a.opacity, 1)} min={0} max={1} step={0.01}
        onCommit={(v) => set("opacity", v)} format={(v) => `${Math.round(v * 100)}%`}
      />
      <NumRow label="Stroke W" value={a["stroke-width"] ?? ""} onCommit={(v) => set("stroke-width", v)} />
      <ToggleRow
        label="Cap" value={a["stroke-linecap"] ?? "butt"}
        options={[{ v: "butt", label: "Butt" }, { v: "round", label: "Round" }, { v: "square", label: "Square" }]}
        onChange={(v) => set("stroke-linecap", v)}
      />
      <ToggleRow
        label="Join" value={a["stroke-linejoin"] ?? "miter"}
        options={[{ v: "miter", label: "Miter" }, { v: "round", label: "Round" }, { v: "bevel", label: "Bevel" }]}
        onChange={(v) => set("stroke-linejoin", v)}
      />
      <ToggleRow
        label="Dash" value={dash === "8 4" ? "8 4" : dash === "1 4" ? "1 4" : ""}
        options={[{ v: "", label: "Solid" }, { v: "8 4", label: "Dashed" }, { v: "1 4", label: "Dotted" }]}
        onChange={(v) => set("stroke-dasharray", v)}
      />
      {node.tagName === "rect" && (
        <NumRow label="Radius" value={a.rx ?? ""} onCommit={(v) => set("rx", v)} />
      )}
    </div>
  );
}

// ── Font controls (text elements) ─────────────────────────────────────────────

function FontSection({ node }: { node: VectoNode }) {
  const update = useDocumentStore((s) => s.updateNodeAttributes);
  const a = node.attributes;
  const set = (k: string, v: string) => update(node.id, { [k]: v });

  const weight = a["font-weight"] ?? "normal";
  const isBold = weight === "bold" || (parseInt(weight) || 0) >= 600;
  const isItalic = (a["font-style"] ?? "normal") === "italic";
  const anchor = a["text-anchor"] ?? "start";

  return (
    <div className="px-4 py-2 border-b border-border space-y-2">
      <label className="block text-[10px] text-text-muted uppercase tracking-wide">Font</label>
      <div className="flex items-center gap-2">
        <label className="text-text-muted text-[10px] w-20 flex-shrink-0 uppercase tracking-wide truncate">Family</label>
        <FontPicker value={a["font-family"] ?? ""} onChange={(v) => set("font-family", v)} />
      </div>
      <NumRow label="Size" value={a["font-size"] ?? ""} onCommit={(v) => set("font-size", v)} />
      <ToggleRow
        label="Weight" value={isBold ? "bold" : "normal"}
        options={[{ v: "normal", label: "Normal" }, { v: "bold", label: "Bold" }]}
        onChange={(v) => set("font-weight", v)}
      />
      <ToggleRow
        label="Style" value={isItalic ? "italic" : "normal"}
        options={[{ v: "normal", label: "Normal" }, { v: "italic", label: "Italic" }]}
        onChange={(v) => set("font-style", v)}
      />
      <ToggleRow
        label="Align" value={anchor}
        options={[{ v: "start", label: "Left" }, { v: "middle", label: "Center" }, { v: "end", label: "Right" }]}
        onChange={(v) => set("text-anchor", v)}
      />
    </div>
  );
}

// ── Gradient editor ───────────────────────────────────────────────────────────

function StopRow({ stop, onChange, onDelete, canDelete }: {
  stop: GradientStop; onChange: (p: Partial<GradientStop>) => void; onDelete: () => void; canDelete: boolean;
}) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLButtonElement>(null);
  // Collapse a color-drag / offset-type burst into one undo step.
  const batching = useRef(false);
  const begin = () => { if (!batching.current) { beginUndoBatch(); batching.current = true; } };
  const end = () => { if (batching.current) { endUndoBatch(); batching.current = false; } };
  return (
    <div className="flex items-center gap-2">
      <button
        ref={ref}
        onClick={() => setOpen((o) => !o)}
        className="w-5 h-5 rounded border border-border flex-shrink-0"
        style={{ background: stop.color }}
      />
      {open && (
        <ColorPopover
          value={toHexSeed(stop.color)}
          anchor={ref.current}
          onChange={(hex) => { begin(); onChange({ color: hex }); }}
          onClose={() => { end(); setOpen(false); }}
        />
      )}
      <input
        type="number" min={0} max={100} value={Math.round(stop.offset * 100)}
        onChange={(e) => { begin(); onChange({ offset: Math.min(1, Math.max(0, (parseFloat(e.target.value) || 0) / 100)) }); }}
        onBlur={end}
        className="w-14 bg-surface border border-border rounded px-1.5 py-0.5 text-[11px] text-text-primary focus:outline-none focus:border-accent"
      />
      <span className="text-[10px] text-text-muted">%</span>
      <div className="flex-1" />
      <button
        disabled={!canDelete}
        onClick={onDelete}
        className="text-text-muted hover:text-danger disabled:opacity-30 text-xs"
      >
        ✕
      </button>
    </div>
  );
}

function GradientSection({ node, gradient }: { node: VectoNode; gradient: VectoGradient }) {
  const updateGradient = useDocumentStore((s) => s.updateGradient);
  const removeGradient = useDocumentStore((s) => s.removeGradient);
  const updateNode = useDocumentStore((s) => s.updateNodeAttributes);

  const setStops = (stops: GradientStop[]) => updateGradient(gradient.id, { stops });
  const setStop = (i: number, p: Partial<GradientStop>) =>
    setStops(gradient.stops.map((s, idx) => (idx === i ? { ...s, ...p } : s)));
  const addStop = () => setStops([...gradient.stops, { offset: 0.5, color: "#888888", opacity: 1 }]);
  const removeStop = (i: number) => {
    if (gradient.stops.length <= 2) return;
    setStops(gradient.stops.filter((_, idx) => idx !== i));
  };
  const toSolid = () => {
    updateNode(node.id, { fill: gradient.stops[0]?.color ?? "#000000" });
    removeGradient(gradient.id);
  };

  return (
    <div className="px-4 py-2 border-b border-border space-y-2">
      <div className="flex items-center justify-between">
        <label className="text-[10px] text-text-muted uppercase tracking-wide">Gradient</label>
        <button onClick={toSolid} className="text-[10px] text-text-muted hover:text-text-primary underline">
          to solid
        </button>
      </div>

      <ToggleRow
        label="Type" value={gradient.type}
        options={[{ v: "linear", label: "Linear" }, { v: "radial", label: "Radial" }]}
        onChange={(v) => {
          const type = v as "linear" | "radial";
          if (type === gradient.type) return;
          // Reset geometry to the new type's object-space defaults.
          const attributes: Record<string, string> = type === "radial"
            ? { cx: "0.5", cy: "0.5", r: "0.5" }
            : { x1: "0", y1: "0", x2: "1", y2: "0" };
          updateGradient(gradient.id, { type, attributes });
        }}
      />

      <div className="h-5 rounded border border-border" style={{ background: gradientCss(gradient) }} />

      <div className="space-y-1">
        {gradient.stops.map((s, i) => (
          <StopRow key={i} stop={s} onChange={(p) => setStop(i, p)} onDelete={() => removeStop(i)} canDelete={gradient.stops.length > 2} />
        ))}
      </div>
      <button
        onClick={addStop}
        className="w-full h-6 rounded border border-border text-[11px] text-text-secondary hover:text-text-primary hover:bg-surface transition-colors"
      >
        + Add stop
      </button>

      {gradient.type === "linear" && gradient.attributes.gradientUnits !== "userSpaceOnUse" && (
        <StyleSlider
          label="Angle" value={linearAngle(gradient.attributes)} min={-180} max={180} step={1}
          onCommit={(v) => updateGradient(gradient.id, { attributes: setLinearAngle(gradient.attributes, parseFloat(v)) })}
          format={(v) => `${Math.round(v)}°`}
        />
      )}
    </div>
  );
}

// ── Effects (drop shadow / blur) ──────────────────────────────────────────────

function EffectsSection({ node }: { node: VectoNode }) {
  const update = useDocumentStore((s) => s.updateNodeAttributes);
  const addFilter = useDocumentStore((s) => s.addFilter);
  const updateFilter = useDocumentStore((s) => s.updateFilter);
  const removeFilter = useDocumentStore((s) => s.removeFilter);
  const filters = useDocumentStore((s) => s.document?.filters);

  const [colorOpen, setColorOpen] = useState(false);
  const colorRef = useRef<HTMLButtonElement>(null);
  const batching = useRef(false);
  const begin = () => { if (!batching.current) { beginUndoBatch(); batching.current = true; } };
  const end = () => { if (batching.current) { endUndoBatch(); batching.current = false; } };

  const ref = (node.attributes.filter ?? "").match(/^url\(#(.+?)\)$/);
  const filter = ref ? filters?.find((f) => f.id === ref[1]) : undefined;

  const addEffect = (type: "drop-shadow" | "blur") => {
    const id = newFilterId();
    beginUndoBatch();
    addFilter(makeFilter(id, type));
    update(node.id, { filter: `url(#${id})` });
    endUndoBatch();
  };
  const removeEffect = () => {
    beginUndoBatch();
    if (filter) removeFilter(filter.id);
    update(node.id, { filter: "none" });
    endUndoBatch();
  };
  const setF = (p: Record<string, number | string>) => { if (filter) updateFilter(filter.id, p); };
  const offsetInput = (axis: "dx" | "dy", v: number) => (
    <input
      type="number" step="1" defaultValue={v} key={`${axis}${v}`} title={axis === "dx" ? "X" : "Y"}
      onBlur={(e) => setF({ [axis]: parseFloat(e.currentTarget.value) || 0 })}
      onKeyDown={(e) => { if (e.key === "Enter") e.currentTarget.blur(); }}
      className="flex-1 min-w-0 bg-surface border border-border rounded px-2 py-0.5 text-[11px] text-text-primary focus:outline-none focus:border-accent"
    />
  );

  return (
    <div className="px-4 py-2 border-b border-border space-y-2">
      <div className="flex items-center justify-between">
        <label className="text-[10px] text-text-muted uppercase tracking-wide">Effects</label>
        {filter && <button onClick={removeEffect} title="Remove effect" className="text-text-muted hover:text-danger text-xs">✕</button>}
      </div>

      {!filter ? (
        <div className="flex gap-1">
          <button onClick={() => addEffect("drop-shadow")} className="flex-1 h-7 rounded text-[11px] bg-surface border border-border text-text-secondary hover:text-text-primary transition-colors">+ Drop shadow</button>
          <button onClick={() => addEffect("blur")} className="flex-1 h-7 rounded text-[11px] bg-surface border border-border text-text-secondary hover:text-text-primary transition-colors">+ Blur</button>
        </div>
      ) : (
        <>
          <ToggleRow
            label="Type" value={filter.type}
            options={[{ v: "drop-shadow", label: "Shadow" }, { v: "blur", label: "Blur" }]}
            onChange={(v) => setF({ type: v })}
          />
          {filter.type === "drop-shadow" ? (
            <>
              <div className="flex items-center gap-2">
                <label className="text-text-muted text-[10px] w-20 flex-shrink-0 uppercase tracking-wide truncate">Offset</label>
                {offsetInput("dx", filter.dx)}
                {offsetInput("dy", filter.dy)}
              </div>
              <StyleSlider label="Blur" value={filter.blur} min={0} max={30} step={0.5} onCommit={(v) => setF({ blur: parseFloat(v) })} />
              <div className="flex items-center gap-2">
                <label className="text-text-muted text-[10px] w-20 flex-shrink-0 uppercase tracking-wide truncate">Color</label>
                <button ref={colorRef} onClick={() => setColorOpen((o) => !o)} className="w-5 h-5 rounded border border-border flex-shrink-0" style={{ background: filter.color }} />
                {colorOpen && (
                  <ColorPopover
                    value={toHexSeed(filter.color)} anchor={colorRef.current}
                    onChange={(hex) => { begin(); setF({ color: hex }); }}
                    onClose={() => { end(); setColorOpen(false); }}
                  />
                )}
                <div className="flex-1" />
              </div>
              <StyleSlider label="Opacity" value={filter.opacity} min={0} max={1} step={0.01} onCommit={(v) => setF({ opacity: parseFloat(v) })} format={(v) => `${Math.round(v * 100)}%`} />
            </>
          ) : (
            <StyleSlider label="Amount" value={filter.blur} min={0} max={30} step={0.5} onCommit={(v) => setF({ blur: parseFloat(v) })} />
          )}
        </>
      )}
    </div>
  );
}

// ── Node properties body ──────────────────────────────────────────────────────

interface NodePropertiesProps {
  node: VectoNode;
  textFocusRef?: React.RefObject<HTMLTextAreaElement>;
}

function NodeProperties({ node, textFocusRef }: NodePropertiesProps) {
  const isText = TEXT_TAGS.has(node.tagName);
  const showStyle = node.editable;
  const gradients = useDocumentStore((s) => s.document?.gradients);

  // Detect a gradient fill (fill="url(#id)") so we can show the gradient editor.
  const fillRef = (node.attributes.fill ?? "").match(/^url\(#(.+?)\)$/);
  const fillGradient = fillRef ? gradients?.find((g) => g.id === fillRef[1]) : undefined;

  const excluded = new Set(showStyle ? STYLE_BASE_KEYS : []);
  if (showStyle && node.tagName === "rect") { excluded.add("rx"); excluded.add("ry"); }
  if (fillGradient) excluded.add("fill"); // shown via the gradient editor instead
  // Text font attributes are shown via FontSection.
  if (isText) ["font-family", "font-size", "font-weight", "font-style", "text-anchor"].forEach((k) => excluded.add(k));
  const relevantAttrs = Object.entries(node.attributes).filter(
    ([key]) => VISUAL_ATTRS.includes(key) && !excluded.has(key)
  );

  return (
    <div className="w-full min-w-0">
      {/* Node info header */}
      <div className="px-4 py-2 border-b border-border w-full min-w-0">
        <div className="flex items-center gap-2">
          <span className="text-[10px] text-text-muted uppercase tracking-wide">
            {node.tagName}
          </span>
          {!node.editable && (
            <span className="text-[9px] bg-surface text-text-muted px-1 rounded flex-shrink-0">
              read-only
            </span>
          )}
        </div>
        <p className="text-text-primary text-xs mt-0.5 truncate">{node.name}</p>
      </div>

      {/* Text content editor — only for text elements */}
      {isText && <TextContentRow node={node} focusRef={textFocusRef} />}

      {/* Font controls — only for text elements */}
      {isText && <FontSection node={node} />}

      {/* Style controls (opacity / stroke / radius) */}
      {showStyle && <StyleSection node={node} />}

      {/* Effects (drop shadow / blur) */}
      {showStyle && <EffectsSection node={node} />}

      {/* Gradient editor (when fill is a gradient) */}
      {fillGradient && <GradientSection node={node} gradient={fillGradient} />}

      {/* Attribute rows */}
      <div className="py-1 w-full min-w-0">
        {relevantAttrs.length === 0 ? (
          <p className="text-text-muted text-[11px] px-3 py-2">
            No editable attributes
          </p>
        ) : (
          relevantAttrs.map(([key, val]) =>
            COLOR_ATTRS.has(key) ? (
              <ColorRow key={key} label={key} value={val} nodeId={node.id} attrKey={key} />
            ) : (
              <AttrRow key={key} label={key} value={val} nodeId={node.id} attrKey={key} />
            )
          )
        )}
      </div>
    </div>
  );
}

// ── AI edit (selection-scoped) ────────────────────────────────────────────────

/** Shared AI prompt box used for selection-edit and whole-document recolor. */
function AiPromptBox({ label, placeholder, button, getIds, frameInstruction }: {
  label: string;
  placeholder: string;
  button: string;
  getIds: () => string[];
  frameInstruction?: (raw: string) => string;
}) {
  const [instruction, setInstruction] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const run = async () => {
    const trimmed = instruction.trim();
    if (!trimmed || busy) return;
    const ids = getIds();
    if (!ids.length) return;
    setError(null);
    setBusy(true);
    const res = await runAiEdit(ids, frameInstruction ? frameInstruction(trimmed) : trimmed);
    if (!res.ok && res.error) setError(res.error);
    if (res.ok) setInstruction("");
    setBusy(false);
  };

  return (
    <div className="px-4 py-3 border-b border-border">
      <label className="block text-[10px] text-accent uppercase tracking-wide mb-1.5">{label}</label>
      <textarea
        value={instruction}
        rows={2}
        disabled={busy}
        placeholder={placeholder}
        onChange={(e) => setInstruction(e.target.value)}
        onKeyDown={(e) => { if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); run(); } }}
        className="w-full resize-none bg-surface border border-border rounded px-2 py-1.5
                   text-[11px] text-text-primary focus:outline-none focus:border-accent
                   leading-relaxed placeholder:text-text-muted disabled:opacity-50"
      />
      {error && <p className="text-[10px] text-danger mt-1">{error}</p>}
      <button
        onClick={run}
        disabled={busy || !instruction.trim()}
        className="mt-1.5 w-full flex items-center justify-center gap-1.5 px-2 py-1.5 rounded
                   text-[11px] font-medium bg-accent text-white hover:bg-accent-hover
                   disabled:opacity-40 disabled:cursor-not-allowed transition-colors"
      >
        {busy ? <><span className="animate-spin inline-block">⟳</span> Applying…</> : <>{button}</>}
      </button>
    </div>
  );
}

function AiEditBox() {
  return (
    <AiPromptBox
      label="✦ Edit with AI"
      placeholder="e.g. make this gold with a soft shadow"
      button="✦ Apply edit"
      getIds={() => useSelectionStore.getState().selectedIds}
    />
  );
}

/** Whole-document AI recolor (shown when nothing is selected). */
function RecolorBox() {
  return (
    <AiPromptBox
      label="✦ AI Recolor"
      placeholder="e.g. a warm sunset palette / brand colors #0ea5e9 + #f59e0b"
      button="✦ Recolor artwork"
      getIds={() => useDocumentStore.getState().document?.nodes.map((n) => n.id) ?? []}
      frameInstruction={(raw) =>
        `Recolor the artwork using this palette/style: ${raw}. Keep every shape, path, and position IDENTICAL — change ONLY colors (fill, stroke, stop-color, gradient stops).`}
    />
  );
}

// ── Arrange (align / distribute / flip) ───────────────────────────────────────

type AlignKind = "left" | "centerH" | "right" | "top" | "middleV" | "bottom";

function ArrangePanel() {
  const selectedIds = useSelectionStore((s) => s.selectedIds);
  const prependTransforms = useDocumentStore((s) => s.prependTransforms);
  const count = selectedIds.length;

  const boxesOf = (ids: string[]) =>
    ids
      .map((id) => ({ id, b: getDocBBox(id) }))
      .filter((x): x is { id: string; b: BoundingBox } => x.b !== null);

  const align = (kind: AlignKind) => {
    const boxes = boxesOf(selectedIds);
    const u = unionDocBBox(selectedIds);
    if (boxes.length < 2 || !u) return;
    const items = boxes.map(({ id, b }) => {
      let dx = 0, dy = 0;
      switch (kind) {
        case "left":    dx = u.x - b.x; break;
        case "centerH": dx = (u.x + u.width / 2) - (b.x + b.width / 2); break;
        case "right":   dx = (u.x + u.width) - (b.x + b.width); break;
        case "top":     dy = u.y - b.y; break;
        case "middleV": dy = (u.y + u.height / 2) - (b.y + b.height / 2); break;
        case "bottom":  dy = (u.y + u.height) - (b.y + b.height); break;
      }
      return { id, transform: `translate(${fmt(dx)} ${fmt(dy)})` };
    }).filter((i) => i.transform !== "translate(0 0)");
    if (items.length) prependTransforms(items);
  };

  const distribute = (axis: "h" | "v") => {
    const boxes = boxesOf(selectedIds);
    if (boxes.length < 3) return;
    const center = (b: BoundingBox) => (axis === "h" ? b.x + b.width / 2 : b.y + b.height / 2);
    boxes.sort((a, b) => center(a.b) - center(b.b));
    const first = center(boxes[0].b);
    const last = center(boxes[boxes.length - 1].b);
    const step = (last - first) / (boxes.length - 1);
    const items = boxes
      .map((bx, i) => {
        const d = (first + step * i) - center(bx.b);
        return { id: bx.id, transform: axis === "h" ? `translate(${fmt(d)} 0)` : `translate(0 ${fmt(d)})` };
      })
      .filter((_, i) => i !== 0 && i !== boxes.length - 1); // ends stay put
    if (items.length) prependTransforms(items);
  };

  const flip = (axis: "h" | "v") => {
    const u = unionDocBBox(selectedIds);
    if (!u) return;
    const cx = u.x + u.width / 2;
    const cy = u.y + u.height / 2;
    const t = axis === "h"
      ? `translate(${fmt(2 * cx)} 0) scale(-1 1)`
      : `translate(0 ${fmt(2 * cy)}) scale(1 -1)`;
    prependTransforms(selectedIds.map((id) => ({ id, transform: t })));
  };

  const Btn = ({ onClick, title, disabled, children }: {
    onClick: () => void; title: string; disabled?: boolean; children: ReactNode;
  }) => (
    <button
      onClick={onClick}
      title={title}
      disabled={disabled}
      className="flex-1 h-7 flex items-center justify-center rounded text-[13px]
                 bg-surface text-text-secondary hover:text-text-primary hover:bg-surface-hover
                 disabled:opacity-30 disabled:cursor-not-allowed transition-colors"
    >
      {children}
    </button>
  );

  const a2 = count >= 2;
  const a3 = count >= 3;

  return (
    <div className="px-4 py-3 border-b border-border space-y-1.5">
      <label className="block text-[10px] text-text-muted uppercase tracking-wide">
        Arrange
      </label>
      <div className="flex gap-1">
        <Btn onClick={() => align("left")}    title="Align left"      disabled={!a2}>⤛</Btn>
        <Btn onClick={() => align("centerH")} title="Align center"    disabled={!a2}>↔</Btn>
        <Btn onClick={() => align("right")}   title="Align right"     disabled={!a2}>⤜</Btn>
        <Btn onClick={() => align("top")}     title="Align top"       disabled={!a2}>⤒</Btn>
        <Btn onClick={() => align("middleV")} title="Align middle"    disabled={!a2}>↕</Btn>
        <Btn onClick={() => align("bottom")}  title="Align bottom"    disabled={!a2}>⤓</Btn>
      </div>
      <div className="flex gap-1">
        <Btn onClick={() => distribute("h")} title="Distribute horizontally" disabled={!a3}>↔↔</Btn>
        <Btn onClick={() => distribute("v")} title="Distribute vertically"   disabled={!a3}>↕↕</Btn>
        <Btn onClick={() => flip("h")}       title="Flip horizontal">⇆</Btn>
        <Btn onClick={() => flip("v")}       title="Flip vertical">⇅</Btn>
      </div>
    </div>
  );
}

// ── Panel ─────────────────────────────────────────────────────────────────────

// Exposed so Canvas can call it on text double-click
export const textEditFocusRef = { current: null as HTMLTextAreaElement | null };

export function PropertiesPanel() {
  const document = useDocumentStore((s) => s.document);
  const selectedIds = useSelectionStore((s) => s.selectedIds);
  const storedWidth = usePanelStore((s) => s.rightWidth);
  const commitWidth = usePanelStore((s) => s.setRightWidth);
  const [width, setWidth] = useState(storedWidth);
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const latestRef = useRef(width);

  // Keep the shared ref in sync so Canvas can call .focus() on it
  useEffect(() => {
    textEditFocusRef.current = textareaRef.current;
  });

  const selectedNode =
    document && selectedIds.length === 1
      ? findNode(document.nodes, selectedIds[0])
      : null;

  // ── Resize handle (left edge) ──────────────────────────────────────────────
  const startRef = useRef({ x: 0, width: 0 });

  const handleResizeDown = useCallback((e: React.MouseEvent) => {
    e.preventDefault();
    startRef.current = { x: e.clientX, width };

    const onMove = (ev: MouseEvent) => {
      // Dragging left = increasing width (panel is on the right)
      const next = Math.min(
        MAX_WIDTH,
        Math.max(MIN_WIDTH, startRef.current.width - (ev.clientX - startRef.current.x))
      );
      latestRef.current = next;
      setWidth(next);
    };
    const onUp = () => {
      commitWidth(latestRef.current); // persist only on release
      window.removeEventListener("mousemove", onMove);
      window.removeEventListener("mouseup", onUp);
    };
    window.addEventListener("mousemove", onMove);
    window.addEventListener("mouseup", onUp);
  }, [width, commitWidth]);

  return (
    <aside
      className="relative flex-shrink-0 flex flex-col bg-panel border-l border-border overflow-hidden"
      style={{ width }}
    >
      {/* Resize handle — left edge */}
      <div
        onMouseDown={handleResizeDown}
        className="absolute top-0 left-0 w-[3px] h-full cursor-col-resize group z-10"
      >
        <div className="w-full h-full group-hover:bg-accent/40 transition-colors" />
      </div>

      {/* Panel header */}
      <div className="flex items-center px-3 h-8 border-b border-border flex-shrink-0 pl-4">
        <span className="text-[11px] font-medium text-text-secondary uppercase tracking-wider">
          Properties
        </span>
      </div>

      {/* Content */}
      <div className="flex-1 overflow-y-auto overflow-x-hidden scrollbar-thin min-w-0">
        {selectedIds.length === 0 ? (
          document ? (
            <RecolorBox />
          ) : (
            <p className="text-text-muted text-[11px] px-3 py-4 text-center">
              Nothing selected
            </p>
          )
        ) : (
          <>
            <AiEditBox />
            <ArrangePanel />
            {selectedNode ? (
              <NodeProperties node={selectedNode} textFocusRef={textareaRef} />
            ) : (
              <p className="text-text-muted text-[11px] px-3 py-4 text-center">
                {selectedIds.length} elements selected
              </p>
            )}
          </>
        )}
      </div>
    </aside>
  );
}
