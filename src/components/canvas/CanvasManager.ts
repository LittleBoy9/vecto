/**
 * CanvasManager — owns pan (CSS translate) and zoom (committed to React store).
 *
 * WHY zoom is NOT in the CSS transform:
 *   CSS `scale()` causes the browser to rasterize the viewport into a GPU
 *   texture at the original resolution and then scale that bitmap — identical
 *   to scaling a JPEG. SVG never re-renders at the new zoom level, so it
 *   pixelates.
 *
 *   Instead, zoom is expressed as explicit `width`/`height` attributes on the
 *   SVG element (vb.width * zoom, vb.height * zoom). The browser then
 *   re-renders the vector paths at the correct resolution every time.
 *
 * WHAT lives here:
 *   - CSS `translate(panX, panY)` on the viewport div — GPU-composited, 60 fps,
 *     no quality impact.
 *   - Zoom value is committed to the React store immediately on wheel so the
 *     SVG dimensions update and the content stays crisp.
 *   - Pan commits are debounced (pan only moves existing pixels — no quality
 *     issue — so we avoid hammering the store on every scroll tick).
 */

export interface CanvasManagerOptions {
  /**
   * Called immediately on zoom change so React can update SVG dimensions.
   * Also called on pan end (debounced 80 ms) for the zoom indicator.
   */
  onTransformCommit: (zoom: number, panX: number, panY: number) => void;
}

export class CanvasManager {
  zoom = 1;
  panX = 0;
  panY = 0;

  private container: HTMLElement;
  private viewport: HTMLElement;
  private options: CanvasManagerOptions;
  private commitTimer: ReturnType<typeof setTimeout> | null = null;

  constructor(
    container: HTMLElement,
    viewport: HTMLElement,
    options: CanvasManagerOptions
  ) {
    this.container = container;
    this.viewport = viewport;
    this.options = options;

    this.container.addEventListener("wheel", this.handleWheel, {
      passive: false,
    });
  }

  // ── Public API ──────────────────────────────────────────────────────────────

  /** Apply pan delta directly (called from React pointer handlers). */
  applyPanDelta(dx: number, dy: number) {
    this.panX += dx;
    this.panY += dy;
    this.applyTransform();
  }

  setPan(x: number, y: number) {
    this.panX = x;
    this.panY = y;
    this.applyTransform();
  }

  /** Commit current transform to the store (call on pointerup). */
  commitTransform() {
    this.options.onTransformCommit(this.zoom, this.panX, this.panY);
  }

  /**
   * Fit the document to the visible canvas area with a small margin.
   * Returns the new transform so callers can sync the store immediately.
   */
  fitToView(docWidth: number, docHeight: number) {
    const rect = this.container.getBoundingClientRect();
    const margin = 0.9;
    const scaleX = (rect.width * margin) / docWidth;
    const scaleY = (rect.height * margin) / docHeight;
    this.zoom = Math.min(scaleX, scaleY, 2);
    this.panX = (rect.width - docWidth * this.zoom) / 2;
    this.panY = (rect.height - docHeight * this.zoom) / 2;
    this.applyTransform();
    return { zoom: this.zoom, panX: this.panX, panY: this.panY };
  }

  /** Convert a screen-space point to document (SVG) coordinates. */
  screenToDoc(screenX: number, screenY: number) {
    const rect = this.container.getBoundingClientRect();
    return {
      x: (screenX - rect.left - this.panX) / this.zoom,
      y: (screenY - rect.top - this.panY) / this.zoom,
    };
  }

  destroy() {
    this.container.removeEventListener("wheel", this.handleWheel);
    if (this.commitTimer) clearTimeout(this.commitTimer);
  }

  // ── Private ─────────────────────────────────────────────────────────────────

  /** Pan only — no scale. Zoom is expressed via SVG width/height in React. */
  private applyTransform() {
    this.viewport.style.transform = `translate(${this.panX}px, ${this.panY}px)`;
  }

  private handleWheel = (e: WheelEvent) => {
    e.preventDefault();

    if (e.ctrlKey || e.metaKey) {
      // Pinch-to-zoom or Ctrl+scroll
      const delta = e.deltaY < 0 ? 1.08 : 1 / 1.08;
      const newZoom = Math.min(Math.max(this.zoom * delta, 0.05), 32);

      // Zoom toward the cursor position
      const rect = this.container.getBoundingClientRect();
      const cx = e.clientX - rect.left;
      const cy = e.clientY - rect.top;
      const ratio = newZoom / this.zoom;
      this.panX = cx - ratio * (cx - this.panX);
      this.panY = cy - ratio * (cy - this.panY);
      this.zoom = newZoom;

      // Commit zoom immediately — React must update SVG width/height so the
      // browser re-renders vectors at the correct resolution (no pixelation).
      if (this.commitTimer) { clearTimeout(this.commitTimer); this.commitTimer = null; }
      this.options.onTransformCommit(this.zoom, this.panX, this.panY);
    } else {
      // Scroll to pan — only translate changes, no quality impact, debounce ok.
      this.panX -= e.deltaX;
      this.panY -= e.deltaY;

      if (this.commitTimer) clearTimeout(this.commitTimer);
      this.commitTimer = setTimeout(() => {
        this.options.onTransformCommit(this.zoom, this.panX, this.panY);
      }, 80);
    }

    this.applyTransform();
  };
}
