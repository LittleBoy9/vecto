import { useCallback, useEffect, useRef, useState } from "react";
import { useDocumentStore } from "../../store/documentStore";
import { useSelectionStore } from "../../store/selectionStore";
import { colorToHex } from "../../lib/utils";
import type { VectoNode } from "../../types/svg";

const MIN_WIDTH = 160;
const MAX_WIDTH = 420;
const DEFAULT_WIDTH = 208;

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
        {/* Swatch / color picker */}
        <label className="flex-shrink-0 cursor-pointer relative">
          <div
            className="w-5 h-5 rounded border border-border"
            style={{ background: isNone ? "transparent" : (hexValue || value) }}
          >
            {isNone && (
              <svg className="absolute inset-0" viewBox="0 0 20 20">
                <line x1="2" y1="2" x2="18" y2="18" stroke="#ef4444" strokeWidth="1.5" />
              </svg>
            )}
          </div>
          <input
            type="color"
            className="sr-only"
            value={pickerValue}
            onChange={(e) => update(nodeId, { [attrKey]: e.target.value })}
          />
        </label>

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

  // Sync draft when node changes (e.g. different element selected)
  useEffect(() => {
    setDraft(extractPlainText(node.rawContent ?? ""));
  }, [node.id, node.rawContent]);

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
          setDraft(e.target.value);
          updateRawContent(node.id, e.target.value);
        }}
        onKeyDown={(e) => {
          // Don't let Escape propagate (would clear canvas selection)
          if (e.key === "Escape") {
            e.stopPropagation();
            setDraft(plain);
            updateRawContent(node.id, plain);
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

// ── Node properties body ──────────────────────────────────────────────────────

interface NodePropertiesProps {
  node: VectoNode;
  textFocusRef?: React.RefObject<HTMLTextAreaElement>;
}

function NodeProperties({ node, textFocusRef }: NodePropertiesProps) {
  const isText = TEXT_TAGS.has(node.tagName);
  const relevantAttrs = Object.entries(node.attributes).filter(([key]) =>
    VISUAL_ATTRS.includes(key)
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

// ── Panel ─────────────────────────────────────────────────────────────────────

function findNode(nodes: VectoNode[], id: string): VectoNode | null {
  for (const n of nodes) {
    if (n.id === id) return n;
    const found = findNode(n.children, id);
    if (found) return found;
  }
  return null;
}

// Exposed so Canvas can call it on text double-click
export const textEditFocusRef = { current: null as HTMLTextAreaElement | null };

export function PropertiesPanel() {
  const document = useDocumentStore((s) => s.document);
  const selectedIds = useSelectionStore((s) => s.selectedIds);
  const [width, setWidth] = useState(DEFAULT_WIDTH);
  const textareaRef = useRef<HTMLTextAreaElement>(null);

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
      setWidth(next);
    };
    const onUp = () => {
      window.removeEventListener("mousemove", onMove);
      window.removeEventListener("mouseup", onUp);
    };
    window.addEventListener("mousemove", onMove);
    window.addEventListener("mouseup", onUp);
  }, [width]);

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
        {!selectedNode ? (
          <p className="text-text-muted text-[11px] px-3 py-4 text-center">
            {selectedIds.length > 1
              ? `${selectedIds.length} elements selected`
              : "Nothing selected"}
          </p>
        ) : (
          <NodeProperties node={selectedNode} textFocusRef={textareaRef} />
        )}
      </div>
    </aside>
  );
}
