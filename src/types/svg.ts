// ── Core document model ───────────────────────────────────────────────────────
// VectoDocument is the single source of truth for everything on the canvas.
// It is derived from an SVG string (via parseSVG) and serialized back (via
// serializeDocument). All edits go through Zustand actions — never mutate this
// directly.

export type VectoNodeType =
  | "path"
  | "rect"
  | "circle"
  | "ellipse"
  | "line"
  | "polyline"
  | "polygon"
  | "text"
  | "g"
  | "use"
  | "image"
  | "unknown";

export interface VectoNode {
  /** Internal stable ID used by stores and the canvas registry. */
  id: string;
  /** The original SVG `id` attribute value, if present. */
  svgId?: string;
  type: VectoNodeType;
  /** Lowercase tag name as it appears in SVG (e.g. "path", "rect"). */
  tagName: string;
  /** All SVG attributes as key-value strings (excluding `id` — use svgId). */
  attributes: Record<string, string>;
  children: VectoNode[];
  /** Whether the layer panel row shows this node as locked. */
  locked: boolean;
  /** Whether this node is visible (rendered and selectable). */
  visible: boolean;
  /** Human-readable display name in the layer panel. */
  name: string;
  /**
   * Raw innerHTML for elements whose content is text rather than child elements
   * (e.g. <text>, <tspan>, <textPath>). Rendered via dangerouslySetInnerHTML
   * so the actual text string and nested tspans are preserved.
   */
  rawContent?: string;
  /**
   * False for nodes Vecto cannot fully interpret (e.g. <use>, complex filters).
   * They still render but are marked read-only in the UI.
   */
  editable: boolean;
}

export interface VectoViewBox {
  x: number;
  y: number;
  width: number;
  height: number;
}

export interface GradientStop {
  /** Position along the gradient, 0–1. */
  offset: number;
  color: string;
  /** Stop opacity, 0–1. */
  opacity: number;
}

export interface VectoGradient {
  /** The SVG id referenced via fill="url(#id)". */
  id: string;
  type: "linear" | "radial";
  stops: GradientStop[];
  /** Geometry / units / transform attributes (everything except id). */
  attributes: Record<string, string>;
}

export interface VectoFilter {
  /** The SVG id referenced via filter="url(#id)". */
  id: string;
  type: "drop-shadow" | "blur";
  /** Shadow offset (drop-shadow only). */
  dx: number;
  dy: number;
  /** Blur radius (stdDeviation) — used by both types. */
  blur: number;
  /** Shadow color + opacity (drop-shadow only). */
  color: string;
  opacity: number;
}

export interface VectoDocument {
  /** Stable document ID (regenerated each time a file is opened). */
  id: string;
  viewBox: VectoViewBox;
  /** Original width attribute string, e.g. "200" or "100%". */
  width: string;
  /** Original height attribute string. */
  height: string;
  /** Top-level nodes (all children of <svg> except <defs>). */
  nodes: VectoNode[];
  /**
   * Raw innerHTML of the <defs> block EXCEPT gradients (filters, patterns, etc.).
   * Rendered as-is inside a <defs> element — Vecto does not parse this.
   */
  rawDefs?: string;
  /** Structured, editable gradients parsed out of <defs>. */
  gradients?: VectoGradient[];
  /** Structured, editable effect filters (drop-shadow / blur) parsed out of <defs>. */
  filters?: VectoFilter[];
}

export interface BoundingBox {
  x: number;
  y: number;
  width: number;
  height: number;
}
