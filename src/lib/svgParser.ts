import { nanoid } from "nanoid";
import type {
  GradientStop, VectoDocument, VectoGradient, VectoFilter, VectoNode, VectoNodeType, VectoViewBox,
} from "../types/svg";

const clamp01 = (n: number) => Math.min(1, Math.max(0, n));

function parseStops(gradEl: Element): GradientStop[] {
  return Array.from(gradEl.querySelectorAll("stop")).map((s) => {
    const offRaw = (s.getAttribute("offset") ?? "0").trim();
    const offset = offRaw.endsWith("%") ? parseFloat(offRaw) / 100 : parseFloat(offRaw);
    let color = s.getAttribute("stop-color") ?? "";
    let opacity = parseFloat(s.getAttribute("stop-opacity") ?? "1");
    const style = s.getAttribute("style");
    if (style) {
      const cm = style.match(/stop-color:\s*([^;]+)/);
      if (cm) color = cm[1].trim();
      const om = style.match(/stop-opacity:\s*([^;]+)/);
      if (om) opacity = parseFloat(om[1]);
    }
    return {
      offset: clamp01(Number.isFinite(offset) ? offset : 0),
      color: color || "#000000",
      opacity: Number.isFinite(opacity) ? opacity : 1,
    };
  });
}

/** Parse a <filter> into a structured effect, or null if we don't recognize it. */
function parseFilter(el: Element): VectoFilter | null {
  const id = el.getAttribute("id");
  if (!id) return null;
  const num = (s: string | null, d: number) => {
    const n = parseFloat(s ?? "");
    return Number.isFinite(n) ? n : d;
  };
  const prims = Array.from(el.children);
  if (prims.length !== 1) return null;
  const p = prims[0];
  const tag = p.tagName.toLowerCase();

  if (tag === "fedropshadow") {
    let color = p.getAttribute("flood-color") ?? "#000000";
    let opacity = num(p.getAttribute("flood-opacity"), 1);
    const style = p.getAttribute("style");
    if (style) {
      const cm = style.match(/flood-color:\s*([^;]+)/);
      if (cm) color = cm[1].trim();
      const om = style.match(/flood-opacity:\s*([^;]+)/);
      if (om) opacity = parseFloat(om[1]);
    }
    return {
      id, type: "drop-shadow",
      dx: num(p.getAttribute("dx"), 4), dy: num(p.getAttribute("dy"), 4),
      blur: num(p.getAttribute("stdDeviation"), 4), color, opacity,
    };
  }
  if (tag === "fegaussianblur") {
    return { id, type: "blur", dx: 0, dy: 0, blur: num(p.getAttribute("stdDeviation"), 4), color: "#000000", opacity: 1 };
  }
  return null;
}

/** Pull gradients + effect filters out of <defs>; return them + the leftover defs HTML. */
function parseDefs(defsEl: Element): { gradients: VectoGradient[]; filters: VectoFilter[]; rawDefs?: string } {
  const clone = defsEl.cloneNode(true) as Element;
  const gradients: VectoGradient[] = [];
  const filters: VectoFilter[] = [];

  const gradEls = Array.from(clone.querySelectorAll("*")).filter((el) => {
    const t = el.tagName.toLowerCase();
    return t === "lineargradient" || t === "radialgradient";
  });
  for (const g of gradEls) {
    const id = g.getAttribute("id");
    if (!id) continue;
    const attributes: Record<string, string> = {};
    for (const attr of Array.from(g.attributes)) {
      if (attr.name !== "id") attributes[attr.name] = attr.value;
    }
    gradients.push({
      id,
      type: g.tagName.toLowerCase() === "radialgradient" ? "radial" : "linear",
      stops: parseStops(g),
      attributes,
    });
    g.remove();
  }

  const filterEls = Array.from(clone.querySelectorAll("*")).filter((el) => el.tagName.toLowerCase() === "filter");
  for (const el of filterEls) {
    const f = parseFilter(el);
    if (f) { filters.push(f); el.remove(); } // unrecognized filters stay in rawDefs
  }

  const leftover = clone.innerHTML.trim();
  return { gradients, filters, rawDefs: leftover.length ? leftover : undefined };
}

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
  // data-name (a Vecto rename) wins over the raw id, then editor labels.
  const label =
    el.getAttribute("data-name") ||
    el.getAttribute("inkscape:label") ||
    el.getAttribute("id");
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

  // display:none round-trips into the layer visibility toggle (see svgSerializer).
  // Strip the attribute so toggling visibility back on actually shows the element.
  const attributes = readAttributes(el);
  let visible = true;
  if (attributes.display === "none") {
    visible = false;
    delete attributes.display;
  }

  return {
    id: nanoid(),
    svgId: el.getAttribute("id") ?? undefined,
    type: nodeType(tagName),
    tagName,
    attributes,
    children,
    locked: false,
    visible,
    name: buildName(el, index),
    rawContent,
    editable: EDITABLE_TAGS.has(tagName),
  };
}

/**
 * Strip XSS vectors from a parsed SVG DOM in place, BEFORE we read attributes
 * or innerHTML (rawDefs / rawContent) out of it. Removes <script>/<foreignObject>
 * subtrees, all on* event-handler attributes, and javascript: URLs. Runs on
 * every parse (file open, AI output, trace, drag-drop, recovery).
 */
function sanitizeSvgDom(root: Element) {
  const all = [root, ...Array.from(root.querySelectorAll("*"))];
  for (const el of all) {
    const tag = el.tagName.toLowerCase();
    if (tag === "script" || tag === "foreignobject") {
      el.remove();
      continue;
    }
    for (const attr of Array.from(el.attributes)) {
      const name = attr.name.toLowerCase();
      if (name.startsWith("on")) {
        el.removeAttribute(attr.name);
      } else if (name.endsWith("href") && /^\s*javascript:/i.test(attr.value)) {
        el.removeAttribute(attr.name);
      }
    }
  }
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

  // Strip scripts / event handlers / javascript: URLs before reading anything out.
  sanitizeSvgDom(svgEl);

  // Defs: gradients parsed into a structured editable model, rest kept raw.
  const defsEl = svgEl.querySelector(":scope > defs");
  const { gradients, filters, rawDefs } = defsEl
    ? parseDefs(defsEl)
    : { gradients: [] as VectoGradient[], filters: [] as VectoFilter[], rawDefs: undefined };

  const nodes: VectoNode[] = [];
  Array.from(svgEl.children).forEach((child, i) => {
    const tag = child.tagName.toLowerCase();
    if (!SKIP_TAGS.has(tag)) {
      nodes.push(parseNode(child, i));
    }
  });

  const vbAttr = svgEl.getAttribute("viewBox");
  let vb = parseViewBox(vbAttr);
  // No viewBox (common in traced / exported SVGs) → derive one from width/height.
  if (!vbAttr) {
    const w = parseFloat(svgEl.getAttribute("width") ?? "");
    const h = parseFloat(svgEl.getAttribute("height") ?? "");
    if (Number.isFinite(w) && w > 0 && Number.isFinite(h) && h > 0) {
      vb = { x: 0, y: 0, width: w, height: h };
    }
  }

  return {
    id: nanoid(),
    viewBox: vb,
    width: svgEl.getAttribute("width") ?? String(vb.width),
    height: svgEl.getAttribute("height") ?? String(vb.height),
    nodes,
    rawDefs,
    gradients: gradients.length ? gradients : undefined,
    filters: filters.length ? filters : undefined,
  };
}
