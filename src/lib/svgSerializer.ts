import { referencedGradientIds, referencedFilterIds } from "./nodeUtils";
import type { VectoDocument, VectoGradient, VectoFilter, VectoNode, VectoViewBox } from "../types/svg";

function escapeAttr(v: string): string {
  return v
    .replace(/&/g, "&amp;")
    .replace(/"/g, "&quot;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;");
}

function attrsToString(attrs: Record<string, string>): string {
  return Object.entries(attrs)
    .map(([k, v]) => `${k}="${escapeAttr(v)}"`)
    .join(" ");
}

function serializeNode(node: VectoNode, indent = 2): string {
  const pad = " ".repeat(indent);
  // SVG element names are case-sensitive: <clipPath> must not become <clippath>.
  const tag = node.srcTag ?? node.tagName;
  const idAttr = node.svgId ? ` id="${escapeAttr(node.svgId)}"` : "";
  // Hidden layers are persisted with display:none so Save never drops them.
  // parseSVG reads display:none back into node.visible = false on reload.
  // Lock has no SVG equivalent, so it round-trips via a data attribute.
  const attributes = {
    ...node.attributes,
    ...(node.visible ? {} : { display: "none" }),
    ...(node.locked ? { "data-vecto-locked": "true" } : {}),
  };
  const attrStr = attrsToString(attributes);
  const attrs = [idAttr, attrStr ? ` ${attrStr}` : ""].join("");

  // Text-bearing elements (<text>, <tspan>, <textPath>) hold their content as
  // markup in rawContent. It is already sanitized on parse, and user-typed text
  // is escaped at entry (PropertiesPanel), so it is emitted verbatim.
  // Without this branch every text element serialized as an empty tag and all
  // copy was silently lost on save, export, and autosave.
  if (node.rawContent !== undefined) {
    return `${pad}<${tag}${attrs}>${node.rawContent}</${tag}>`;
  }

  if (node.children.length === 0) {
    return `${pad}<${tag}${attrs} />`;
  }

  const inner = node.children
    .map((c) => serializeNode(c, indent + 2))
    .filter(Boolean)
    .join("\n");

  return `${pad}<${tag}${attrs}>\n${inner}\n${pad}</${tag}>`;
}

function serializeGradient(g: VectoGradient): string {
  const tag = g.type === "radial" ? "radialGradient" : "linearGradient";
  const attrs = attrsToString(g.attributes);
  const stops = g.stops
    .map((s) => `      <stop offset="${s.offset}" stop-color="${escapeAttr(s.color)}" stop-opacity="${s.opacity}" />`)
    .join("\n");
  return `    <${tag} id="${escapeAttr(g.id)}"${attrs ? ` ${attrs}` : ""}>\n${stops}\n    </${tag}>`;
}

function serializeFilter(f: VectoFilter): string {
  // Roomy region so offset shadows / big blurs aren't clipped.
  const region = `x="-40%" y="-40%" width="180%" height="180%"`;
  const prim = f.type === "drop-shadow"
    ? `<feDropShadow dx="${f.dx}" dy="${f.dy}" stdDeviation="${f.blur}" flood-color="${escapeAttr(f.color)}" flood-opacity="${f.opacity}" />`
    : `<feGaussianBlur stdDeviation="${f.blur}" />`;
  return `    <filter id="${escapeAttr(f.id)}" ${region}>\n      ${prim}\n    </filter>`;
}

/**
 * Serialize a VectoDocument back to an SVG string.
 * Suitable for writing to disk or exporting.
 */
export function serializeDocument(doc: VectoDocument): string {
  const { viewBox: vb, width, height, nodes, rawDefs, gradients, filters } = doc;
  const vbAttr = `${vb.x} ${vb.y} ${vb.width} ${vb.height}`;

  const defsInner = [
    ...(gradients?.map(serializeGradient) ?? []),
    ...(filters?.map(serializeFilter) ?? []),
    ...(rawDefs ? [`    ${rawDefs}`] : []),
  ].join("\n");
  const defsSection = defsInner ? `\n  <defs>\n${defsInner}\n  </defs>` : "";

  const nodesSection = nodes
    .map((n) => serializeNode(n, 2))
    .filter(Boolean)
    .join("\n");

  return [
    `<?xml version="1.0" encoding="UTF-8"?>`,
    `<svg xmlns="http://www.w3.org/2000/svg"`,
    `     xmlns:xlink="http://www.w3.org/1999/xlink"`,
    `     viewBox="${vbAttr}"`,
    `     width="${width}"`,
    `     height="${height}">${defsSection}`,
    nodesSection,
    `</svg>`,
  ].join("\n");
}

/**
 * Serialize a subset of nodes into a standalone `<svg>` with the document's
 * viewBox — used to hand selected elements to the AI editor with spatial context.
 * Pass the gradients they reference so the model can see (and edit) them.
 */
export function serializeFragment(
  nodes: VectoNode[],
  viewBox: VectoViewBox,
  defs?: { gradients?: VectoGradient[]; filters?: VectoFilter[] }
): string {
  const vbAttr = `${viewBox.x} ${viewBox.y} ${viewBox.width} ${viewBox.height}`;
  // Include only the gradients/filters these nodes actually reference.
  const gradIds = referencedGradientIds(nodes);
  const filtIds = referencedFilterIds(nodes);
  const defsInner = [
    ...(defs?.gradients ?? []).filter((g) => gradIds.has(g.id)).map(serializeGradient),
    ...(defs?.filters ?? []).filter((f) => filtIds.has(f.id)).map(serializeFilter),
  ].join("\n");
  const body = nodes.map((n) => serializeNode(n, 2)).filter(Boolean).join("\n");
  return [
    `<svg xmlns="http://www.w3.org/2000/svg" viewBox="${vbAttr}">`,
    ...(defsInner ? [`  <defs>\n${defsInner}\n  </defs>`] : []),
    body,
    `</svg>`,
  ].join("\n");
}
