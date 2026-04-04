import { nanoid } from "nanoid";
import type { VectoDocument, VectoNode, VectoNodeType, VectoViewBox } from "../types/svg";

const EDITABLE_TAGS = new Set([
  "path", "rect", "circle", "ellipse",
  "line", "polyline", "polygon", "text", "g",
]);

// Elements whose visible content is text (not child elements).
// We store their innerHTML verbatim and render with dangerouslySetInnerHTML.
const TEXT_CONTENT_TAGS = new Set(["text", "tspan", "textpath", "textPath"]);

const SKIP_TAGS = new Set(["defs", "style", "script", "title", "desc"]);

function nodeType(tagName: string): VectoNodeType {
  if (EDITABLE_TAGS.has(tagName)) return tagName as VectoNodeType;
  if (tagName === "use") return "use";
  if (tagName === "image") return "image";
  return "unknown";
}

function buildName(el: Element, index: number): string {
  const label =
    el.getAttribute("id") ||
    el.getAttribute("inkscape:label") ||
    el.getAttribute("data-name");
  if (label) return label;
  return `${el.tagName} ${index + 1}`;
}

function readAttributes(el: Element): Record<string, string> {
  const out: Record<string, string> = {};
  for (const attr of Array.from(el.attributes)) {
    // Skip the SVG id — stored separately as svgId
    if (attr.name === "id") continue;
    out[attr.name] = attr.value;
  }
  return out;
}

function parseNode(el: Element, index: number): VectoNode {
  const tagName = el.tagName.toLowerCase();
  const children: VectoNode[] = [];
  let rawContent: string | undefined;

  if (tagName === "g" || tagName === "svg") {
    // Recurse into group containers
    Array.from(el.children).forEach((child, i) => {
      const childTag = child.tagName.toLowerCase();
      if (!SKIP_TAGS.has(childTag)) {
        children.push(parseNode(child, i));
      }
    });
  } else if (TEXT_CONTENT_TAGS.has(tagName)) {
    // Text elements: store innerHTML so tspan children and raw text are preserved.
    // These are rendered via dangerouslySetInnerHTML in SvgNode.
    rawContent = el.innerHTML;
  }

  return {
    id: nanoid(),
    svgId: el.getAttribute("id") ?? undefined,
    type: nodeType(tagName),
    tagName,
    attributes: readAttributes(el),
    children,
    locked: false,
    visible: true,
    name: buildName(el, index),
    rawContent,
    editable: EDITABLE_TAGS.has(tagName),
  };
}

function parseViewBox(raw: string | null): VectoViewBox {
  if (!raw) return { x: 0, y: 0, width: 100, height: 100 };
  const parts = raw.trim().split(/[\s,]+/).map(Number);
  return {
    x: parts[0] ?? 0,
    y: parts[1] ?? 0,
    width: parts[2] ?? 100,
    height: parts[3] ?? 100,
  };
}

/**
 * Parse an SVG string into a VectoDocument tree.
 * Throws if the input is not valid SVG.
 */
export function parseSVG(svgString: string): VectoDocument {
  const parser = new DOMParser();
  const xmlDoc = parser.parseFromString(svgString.trim(), "image/svg+xml");

  const parseError = xmlDoc.querySelector("parsererror");
  if (parseError) {
    throw new Error(`SVG parse error: ${parseError.textContent}`);
  }

  const svgEl = xmlDoc.querySelector("svg");
  if (!svgEl) throw new Error("No <svg> root element found");

  // Raw defs innerHTML (passed through as-is, not parsed)
  const defsEl = svgEl.querySelector(":scope > defs");
  const rawDefs = defsEl ? defsEl.innerHTML : undefined;

  const nodes: VectoNode[] = [];
  Array.from(svgEl.children).forEach((child, i) => {
    const tag = child.tagName.toLowerCase();
    if (!SKIP_TAGS.has(tag)) {
      nodes.push(parseNode(child, i));
    }
  });

  const vb = parseViewBox(svgEl.getAttribute("viewBox"));

  return {
    id: nanoid(),
    viewBox: vb,
    width: svgEl.getAttribute("width") ?? String(vb.width),
    height: svgEl.getAttribute("height") ?? String(vb.height),
    nodes,
    rawDefs,
  };
}
