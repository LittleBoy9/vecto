import { canvasRegistry } from "./canvasRegistry";
import type { BoundingBox } from "../types/svg";

/**
 * Bounding box of a node in DOCUMENT (viewBox) coordinates.
 *
 * getBBox() is element-local and ignores the element's own transform, so we
 * project the box corners through the element→document matrix (getScreenCTM)
 * to get the real on-screen box. Used by SelectionOverlay and marquee select.
 */
export function getDocBBox(id: string): BoundingBox | null {
  const el = canvasRegistry.get(id);
  if (!el) return null;
  try {
    const b = el.getBBox();
    if (b.width <= 0 && b.height <= 0) return null;

    const svg = el.ownerSVGElement;
    const elCTM = el.getScreenCTM();
    const svgCTM = svg?.getScreenCTM();
    if (!elCTM || !svgCTM) {
      return { x: b.x, y: b.y, width: b.width, height: b.height };
    }
    const m = svgCTM.inverse().multiply(elCTM);
    const tp = (x: number, y: number) => new DOMPoint(x, y).matrixTransform(m);
    const pts = [
      tp(b.x, b.y),
      tp(b.x + b.width, b.y),
      tp(b.x, b.y + b.height),
      tp(b.x + b.width, b.y + b.height),
    ];
    const xs = pts.map((p) => p.x);
    const ys = pts.map((p) => p.y);
    const minX = Math.min(...xs);
    const minY = Math.min(...ys);
    const maxX = Math.max(...xs);
    const maxY = Math.max(...ys);
    return { x: minX, y: minY, width: maxX - minX, height: maxY - minY };
  } catch {
    return null;
  }
}

/** Matrix mapping a node's local coordinates → document (viewBox) space. */
export function getDocMatrix(id: string): DOMMatrix | null {
  const el = canvasRegistry.get(id);
  if (!el) return null;
  const svg = el.ownerSVGElement;
  const elCTM = el.getScreenCTM();
  const svgCTM = svg?.getScreenCTM();
  if (!elCTM || !svgCTM) return null;
  return svgCTM.inverse().multiply(elCTM);
}

/** Union of several nodes' document-space bounding boxes. */
export function unionDocBBox(ids: string[]): BoundingBox | null {
  let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
  let found = false;
  for (const id of ids) {
    const b = getDocBBox(id);
    if (!b) continue;
    found = true;
    minX = Math.min(minX, b.x);
    minY = Math.min(minY, b.y);
    maxX = Math.max(maxX, b.x + b.width);
    maxY = Math.max(maxY, b.y + b.height);
  }
  return found ? { x: minX, y: minY, width: maxX - minX, height: maxY - minY } : null;
}

/** Axis-aligned rectangle overlap test. */
export function rectsIntersect(a: BoundingBox, b: BoundingBox): boolean {
  return (
    a.x < b.x + b.width &&
    a.x + a.width > b.x &&
    a.y < b.y + b.height &&
    a.y + a.height > b.y
  );
}
