/**
 * Pull the `<svg>…</svg>` block out of accumulated model output, used by both
 * full-document generation and selection-scoped AI edit streaming.
 */

/** The complete `<svg>…</svg>` block, or null if not present yet. */
export function extractSvg(text: string): string | null {
  const start = text.indexOf("<svg");
  if (start === -1) return null;
  const end = text.lastIndexOf("</svg>");
  if (end === -1 || end < start) return null;
  return text.slice(start, end + "</svg>".length);
}

/**
 * Whatever SVG we have so far — if the closing tag hasn't streamed in yet,
 * close it artificially so the browser can attempt a partial render.
 */
export function extractPartialSvg(text: string): string | null {
  const start = text.indexOf("<svg");
  if (start === -1) return null;
  const end = text.lastIndexOf("</svg>");
  if (end !== -1) return text.slice(start, end + "</svg>".length);
  return text.slice(start) + "</svg>";
}
