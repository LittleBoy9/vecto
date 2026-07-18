import type { VectoNode, VectoGradient, VectoFilter } from "../types/svg";
import { cloneNodesWithDefs } from "./nodeUtils";

/**
 * In-memory clipboard for copy/cut/paste of canvas elements. Stores detached
 * deep clones plus the gradients/filters those nodes reference, so paste stays
 * independent and survives switching to a document without the original defs.
 */
let buffer: { nodes: VectoNode[]; gradients: VectoGradient[]; filters: VectoFilter[] } = {
  nodes: [], gradients: [], filters: [],
};

export function setClipboard(nodes: VectoNode[], gradients: VectoGradient[], filters: VectoFilter[]) {
  buffer = cloneNodesWithDefs(nodes, gradients, filters);
}

/** Fresh-id clones of the clipboard contents (nodes + their defs), safe to insert. */
export function readClipboard() {
  return cloneNodesWithDefs(buffer.nodes, buffer.gradients, buffer.filters);
}

export function hasClipboard(): boolean {
  return buffer.nodes.length > 0;
}
