import React, { memo, useCallback } from "react";
import type { VectoDocument, VectoNode } from "../../types/svg";
import { useSelectionStore } from "../../store/selectionStore";
import { useUIStore } from "../../store/uiStore";
import { usePathEditStore } from "../../store/pathEditStore";
import { registerElement } from "../../lib/canvasRegistry";
import { textEditFocusRef } from "../sidebar/PropertiesPanel";

const TEXT_TAGS = new Set(["text", "tspan", "textpath"]);
const PATH_TAGS = new Set(["path", "polyline", "polygon"]);

// ── Single SVG node ───────────────────────────────────────────────────────────

interface SvgNodeProps {
  node: VectoNode;
}

const SvgNode = memo(function SvgNode({ node }: SvgNodeProps) {
  const select = useSelectionStore((s) => s.select);
  const addToSelection = useSelectionStore((s) => s.addToSelection);
  const setHovered = useSelectionStore((s) => s.setHovered);
  const setTool = useUIStore((s) => s.setTool);
  const startEditing = usePathEditStore((s) => s.startEditing);

  // Register this DOM element in the global registry so SelectionOverlay can
  // call getBBox() on it without going through React state.
  const ref = useCallback(
    (el: SVGGraphicsElement | null) => {
      registerElement(node.id, el);
    },
    [node.id]
  );

  if (!node.visible) return null;

  const handlePointerDown = (e: React.PointerEvent) => {
    e.stopPropagation();
    if (node.locked) return;

    // In node-edit mode, a single click on a path edits it (so you can hop
    // between paths without double-clicking). Non-path clicks just select.
    if (useUIStore.getState().activeTool === "nodeEdit") {
      if (PATH_TAGS.has(node.tagName) && node.attributes?.d) {
        select([node.id]);
        startEditing(node.id);
      }
      return;
    }

    if (e.shiftKey) {
      addToSelection(node.id);
    } else {
      select([node.id]);
    }
  };

  const handlePointerEnter = () => setHovered(node.id);
  const handlePointerLeave = () => setHovered(null);

  // Double-click → enter the appropriate edit mode for this element type.
  const handleDoubleClick = (e: React.MouseEvent) => {
    if (node.locked) return;
    e.stopPropagation();

    if (PATH_TAGS.has(node.tagName) && node.attributes?.d) {
      // Path element → enter node edit mode
      select([node.id]);
      setTool("nodeEdit");
      startEditing(node.id);
      return;
    }

    if (TEXT_TAGS.has(node.tagName)) {
      // Text element → focus the text editor in the Properties panel
      select([node.id]);
      setTimeout(() => textEditFocusRef.current?.focus(), 50);
    }
  };

  // Build props for the SVG element.
  // svgId goes as the actual `id` attribute; our internal `id` stays in JS only.
  const svgProps: Record<string, unknown> = {
    ...node.attributes,
    ...(node.svgId ? { id: node.svgId } : {}),
    ref,
    onPointerDown: handlePointerDown,
    onPointerEnter: handlePointerEnter,
    onPointerLeave: handlePointerLeave,
    onDoubleClick: handleDoubleClick,
    style: {
      cursor: node.locked
        ? "default"
        : TEXT_TAGS.has(node.tagName)
        ? "text"
        : "pointer",
    },
  };

  // Text elements store their content as raw innerHTML (includes tspan children
  // and text nodes) — React can't express raw text nodes any other way.
  if (node.rawContent !== undefined) {
    return React.createElement(node.tagName, {
      ...svgProps,
      dangerouslySetInnerHTML: { __html: node.rawContent },
    });
  }

  if (node.children.length > 0) {
    return React.createElement(
      node.tagName,
      svgProps,
      node.children.map((child) => (
        <SvgNode key={child.id} node={child} />
      ))
    );
  }

  return React.createElement(node.tagName, svgProps);
});

// ── Document root ─────────────────────────────────────────────────────────────

interface SvgDocumentProps {
  document: VectoDocument;
  /**
   * Current zoom level. Applied as explicit width/height on the <svg> element
   * so the browser re-renders vector paths at the correct resolution.
   * Never use CSS scale() for this — it pixelates by scaling a rasterized texture.
   */
  zoom: number;
}

export const SvgDocument = memo(function SvgDocument({
  document,
  zoom,
}: SvgDocumentProps) {
  const { viewBox: vb, nodes, rawDefs, gradients, filters } = document;
  const vbStr = `${vb.x} ${vb.y} ${vb.width} ${vb.height}`;

  return (
    <svg
      xmlns="http://www.w3.org/2000/svg"
      viewBox={vbStr}
      width={vb.width * zoom}
      height={vb.height * zoom}
      style={{ display: "block", overflow: "visible" }}
    >
      {/* Structured gradients + effect filters (live-editable) */}
      {((gradients && gradients.length > 0) || (filters && filters.length > 0)) && (
        <defs>
          {gradients?.map((g) =>
            React.createElement(
              g.type === "radial" ? "radialGradient" : "linearGradient",
              { id: g.id, key: g.id, ...g.attributes },
              g.stops.map((s, i) =>
                React.createElement("stop", {
                  key: i,
                  offset: s.offset,
                  stopColor: s.color,
                  stopOpacity: s.opacity,
                })
              )
            )
          )}
          {filters?.map((f) => (
            <filter key={f.id} id={f.id} x="-40%" y="-40%" width="180%" height="180%">
              {f.type === "drop-shadow" ? (
                <feDropShadow dx={f.dx} dy={f.dy} stdDeviation={f.blur} floodColor={f.color} floodOpacity={f.opacity} />
              ) : (
                <feGaussianBlur stdDeviation={f.blur} />
              )}
            </filter>
          ))}
        </defs>
      )}
      {/* Everything else in defs (filters, patterns, …) */}
      {rawDefs && (
        // eslint-disable-next-line react/no-danger
        <defs dangerouslySetInnerHTML={{ __html: rawDefs }} />
      )}
      {nodes.map((node) => (
        <SvgNode key={node.id} node={node} />
      ))}
    </svg>
  );
});
