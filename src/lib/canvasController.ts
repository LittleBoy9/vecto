/**
 * Imperative bridge so global handlers (keyboard shortcuts) can drive the
 * CanvasManager, which lives inside the Canvas component. Canvas registers its
 * handlers on mount and clears them on unmount.
 */
export interface CanvasController {
  fitToView: () => void;
  zoomToSelection: () => void;
}

let controller: CanvasController | null = null;

export function setCanvasController(c: CanvasController | null) {
  controller = c;
}

export function getCanvasController(): CanvasController | null {
  return controller;
}
