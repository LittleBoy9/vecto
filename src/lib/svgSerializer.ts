import type { VectoDocument, VectoNode } from "../types/svg";

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
  if (!node.visible) return "";

  const pad = " ".repeat(indent);
  const idAttr = node.svgId ? ` id="${escapeAttr(node.svgId)}"` : "";
  const attrStr = attrsToString(node.attributes);
  const attrs = [idAttr, attrStr ? ` ${attrStr}` : ""].join("");

  if (node.children.length === 0) {
    return `${pad}<${node.tagName}${attrs} />`;
  }

  const inner = node.children
    .map((c) => serializeNode(c, indent + 2))
    .filter(Boolean)
    .join("\n");

  return `${pad}<${node.tagName}${attrs}>\n${inner}\n${pad}</${node.tagName}>`;
}

/**
 * Serialize a VectoDocument back to an SVG string.
 * Suitable for writing to disk or exporting.
 */
export function serializeDocument(doc: VectoDocument): string {
  const { viewBox: vb, width, height, nodes, rawDefs } = doc;
  const vbAttr = `${vb.x} ${vb.y} ${vb.width} ${vb.height}`;

  const defsSection = rawDefs
    ? `\n  <defs>\n    ${rawDefs}\n  </defs>`
    : "";

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
