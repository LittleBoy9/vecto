/**
 * A global map from internal VectoNode id → the actual SVG DOM element that
 * renders it. SvgNode components register themselves on mount and unregister
 * on unmount. SelectionOverlay reads from this map to call getBBox() for
 * accurate bounding box drawing — without going through React state.
 */
export const canvasRegistry = new Map<string, SVGGraphicsElement>();

/**
 * Reverse index, so element → id is O(1).
 *
 * Hit-testing used to linear-scan the whole registry for every element in the
 * hit stack, which is O(nodes × depth) per click — painful on traced artwork,
 * where vtracer routinely emits thousands of paths. A WeakMap also lets removed
 * elements be collected without extra bookkeeping.
 */
const elementToId = new WeakMap<SVGGraphicsElement, string>();

export function registerElement(id: string, el: SVGGraphicsElement | null) {
  if (el) {
    canvasRegistry.set(id, el);
    elementToId.set(el, id);
  } else {
    const prev = canvasRegistry.get(id);
    if (prev) elementToId.delete(prev);
    canvasRegistry.delete(id);
  }
}

/** Map a DOM element (or its nearest registered ancestor) back to a node id. */
export function nodeIdForElement(el: Element | null): string | null {
  let cur: Element | null = el;
  while (cur) {
    const id = elementToId.get(cur as SVGGraphicsElement);
    // Guard against a stale element whose id was re-registered elsewhere.
    if (id !== undefined && canvasRegistry.get(id) === cur) return id;
    cur = cur.parentElement;
  }
  return null;
}

/**
 * Top-most registered node id under a screen point (walks the hit stack).
 * Overlay chrome is skipped in favour of the real element beneath it, which is
 * what lets a click land on an element inside the current selection's bbox.
 */
export function nodeIdAtPoint(clientX: number, clientY: number): string | null {
  for (const el of document.elementsFromPoint(clientX, clientY)) {
    const id = nodeIdForElement(el);
    if (id) return id;
  }
  return null;
}
