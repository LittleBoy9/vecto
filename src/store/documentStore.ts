import { create } from "zustand";
import { immer } from "zustand/middleware/immer";
import { temporal } from "zundo";
import type { VectoDocument, VectoNode } from "../types/svg";

// ── Helpers ───────────────────────────────────────────────────────────────────

function walkNodes(
  nodes: VectoNode[],
  id: string,
  updater: (node: VectoNode) => void
): boolean {
  for (const node of nodes) {
    if (node.id === id) {
      updater(node);
      return true;
    }
    if (node.children.length > 0 && walkNodes(node.children, id, updater)) {
      return true;
    }
  }
  return false;
}

function removeNodes(nodes: VectoNode[], ids: Set<string>): VectoNode[] {
  return nodes
    .filter((n) => !ids.has(n.id))
    .map((n) => ({ ...n, children: removeNodes(n.children, ids) }));
}

// ── Store ─────────────────────────────────────────────────────────────────────

interface DocumentState {
  document: VectoDocument | null;
  isDirty: boolean;
  filePath: string | null;
}

interface DocumentActions {
  /** Replace the entire document (triggered by file open or AI generation). */
  setDocument: (doc: VectoDocument, filePath?: string) => void;
  /** Merge attribute updates into a single node. */
  updateNodeAttributes: (
    nodeId: string,
    attributes: Partial<Record<string, string>>
  ) => void;
  /** Toggle node visibility. */
  toggleNodeVisibility: (nodeId: string) => void;
  /** Toggle node lock state. */
  toggleNodeLock: (nodeId: string) => void;
  /** Update the raw text content of a text/tspan node. */
  updateNodeRawContent: (nodeId: string, rawContent: string) => void;
  /** Append a new node to the top level of the document. */
  addNode: (node: VectoNode) => void;
  /** Remove nodes by internal ID. */
  deleteNodes: (ids: string[]) => void;
  setFilePath: (path: string) => void;
  markClean: () => void;
}

type DocumentStore = DocumentState & DocumentActions;

export const useDocumentStore = create<DocumentStore>()(
  temporal(
    immer<DocumentStore>((set) => ({
      document: null,
      isDirty: false,
      filePath: null,

      setDocument: (doc, filePath) =>
        set((state) => {
          state.document = doc as VectoDocument;
          state.isDirty = false;
          if (filePath !== undefined) state.filePath = filePath;
        }),

      updateNodeAttributes: (nodeId, attributes) =>
        set((state) => {
          if (!state.document) return;
          walkNodes(state.document.nodes, nodeId, (node) => {
            Object.assign(node.attributes, attributes);
          });
          state.isDirty = true;
        }),

      toggleNodeVisibility: (nodeId) =>
        set((state) => {
          if (!state.document) return;
          walkNodes(state.document.nodes, nodeId, (node) => {
            node.visible = !node.visible;
          });
          state.isDirty = true;
        }),

      toggleNodeLock: (nodeId) =>
        set((state) => {
          if (!state.document) return;
          walkNodes(state.document.nodes, nodeId, (node) => {
            node.locked = !node.locked;
          });
        }),

      updateNodeRawContent: (nodeId, rawContent) =>
        set((state) => {
          if (!state.document) return;
          walkNodes(state.document.nodes, nodeId, (node) => {
            node.rawContent = rawContent;
          });
          state.isDirty = true;
        }),

      addNode: (node) =>
        set((state) => {
          if (!state.document) return;
          state.document.nodes.push(node as VectoNode);
          state.isDirty = true;
        }),

      deleteNodes: (ids) =>
        set((state) => {
          if (!state.document) return;
          const idSet = new Set(ids);
          state.document.nodes = removeNodes(
            state.document.nodes,
            idSet
          ) as typeof state.document.nodes;
          state.isDirty = true;
        }),

      setFilePath: (path) =>
        set((state) => {
          state.filePath = path;
        }),

      markClean: () =>
        set((state) => {
          state.isDirty = false;
        }),
    })),
    {
      // Only track document mutations in undo history — not filePath or isDirty
      partialize: (state) => ({ document: state.document }),
      limit: 100,
    }
  )
);
