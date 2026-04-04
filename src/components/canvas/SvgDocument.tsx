import React, { memo, useCallback } from "react";
import type { VectoDocument, VectoNode } from "../../types/svg";
import { useSelectionStore } from "../../store/selectionStore";
import { registerElement } from "../../lib/canvasRegistry";

// ── Single SVG node ───────────────────────────────────────────────────────────

interface SvgNodeProps {
  node: VectoNode;
}

const SvgNode = memo(function SvgNode({ node }: SvgNodeProps) {
  const select = useSelectionStore((s) => s.select);
  const addToSelection = useSelectionStore((s) => s.addToSelection);
  const setHovered = useSelectionStore((s) => s.setHovered);

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
    if (e.shiftKey) {
      addToSelection(node.id);
    } else {
      select([node.id]);
    }
  };

  const handlePointerEnter = () => setHovered(node.id);
  const handlePointerLeave = () => setHovered(null);

  // Build props for the SVG element.
  // svgId goes as the actual `id` attribute; our internal `id` stays in JS only.
  const svgProps: Record<string, unknown> = {
    ...node.attributes,
    ...(node.svgId ? { id: node.svgId } : {}),
    ref,
    onPointerDown: handlePointerDown,
    onPointerEnter: handlePointerEnter,
    onPointerLeave: handlePointerLeave,
    style: { cursor: node.locked ? "default" : "pointer" },
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
  const { viewBox: vb, nodes, rawDefs } = document;
  const vbStr = `${vb.x} ${vb.y} ${vb.width} ${vb.height}`;

  return (
    <svg
      xmlns="http://www.w3.org/2000/svg"
      viewBox={vbStr}
      width={vb.width * zoom}
      height={vb.height * zoom}
      style={{ display: "block", overflow: "visible" }}
    >
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
