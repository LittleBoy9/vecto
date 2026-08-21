/**
 * Imperative bridge so global handlers (keyboard shortcuts) can drive the file
 * actions, which live inside the Toolbar component. Toolbar registers its
 * handlers on mount and clears them on unmount.
 *
 * Mirrors canvasController. Without it ⌘S / ⌘O had nowhere to dispatch to, so
 * both were documented and advertised in the empty state but silently did
 * nothing — the modifier branch of useKeyboardShortcuts swallowed them.
 */
export interface FileController {
  open: () => void;
  save: () => void;
  saveAs: () => void;
}

let controller: FileController | null = null;

export function setFileController(c: FileController | null) {
  controller = c;
}

export function getFileController(): FileController | null {
  return controller;
}
