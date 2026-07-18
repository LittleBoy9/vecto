/**
 * A global map from internal VectoNode id → the actual SVG DOM element that
 * renders it. SvgNode components register themselves on mount and unregister
 * on unmount. SelectionOverlay reads from this map to call getBBox() for
 * accurate bounding box drawing — without touching React state.
 */
export const canvasRegistry = new Map<string, SVGGraphicsElement>();

export function registerElement(id: string, el: SVGGraphicsElement | null) {
  if (el) {
    canvasRegistry.set(id, el);
  } else {
    canvasRegistry.delete(id);
  }
}

/** Top-most registered node id under a screen point (walks the hit stack). */
export function nodeIdAtPoint(clientX: number, clientY: number): string | null {
  for (const el of document.elementsFromPoint(clientX, clientY)) {
    let cur: Element | null = el;
    while (cur) {
      for (const [id, reg] of canvasRegistry) {
        if (reg === cur) return id;
      }
      cur = cur.parentElement;
    }
  }
  return null;
}
