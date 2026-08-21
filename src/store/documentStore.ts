import { create } from "zustand";
import { immer } from "zustand/middleware/immer";
import { temporal } from "zundo";
import { nanoid } from "nanoid";
import type { VectoDocument, VectoNode } from "../types/svg";
import { cloneNodesWithDefs, findParentList, containsId } from "../lib/nodeUtils";
import type { VectoGradient, VectoFilter } from "../types/svg";

/** Z-order operations within a node's parent list. */
export type ReorderOp = "front" | "back" | "forward" | "backward";

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

/** Prepend a transform to a node's existing transform (composition order). */
function prependTransform(node: VectoNode, t: string) {
  const prev = node.attributes.transform;
  node.attributes.transform = prev ? `${t} ${prev}` : t;
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
  /** Rename a layer (persisted via a data-name attribute). */
  renameNode: (nodeId: string, name: string) => void;
  /** Append a new node to the top level of the document. */
  addNode: (node: VectoNode) => void;
  /** Append several nodes to the top level (paste). */
  addNodes: (nodes: VectoNode[]) => void;
  /** Remove nodes by internal ID. */
  deleteNodes: (ids: string[]) => void;
  /** Deep-clone nodes in place (after each original). Returns the new ids. */
  duplicateNodes: (ids: string[]) => string[];
  /** Wrap sibling nodes in a new <g>. Returns the group id (or null). */
  groupNodes: (ids: string[]) => string | null;
  /** Replace each selected <g> with its children. Returns promoted child ids. */
  ungroupNodes: (ids: string[]) => string[];
  /** Change z-order of nodes within their parent list. */
  reorderNodes: (ids: string[], op: ReorderOp) => void;
  /** Move selected nodes by (dx, dy) in document units (arrow-key nudge). */
  nudgeNodes: (ids: string[], dx: number, dy: number) => void;
  /** Prepend a transform string to each given node (align / distribute / flip). */
  prependTransforms: (items: { id: string; transform: string }[]) => void;
  /** Replace nodes (by id) with new nodes at the first one's position (AI edit). */
  replaceNodes: (ids: string[], newNodes: VectoNode[]) => string[];
  /** Overwrite a node's tag/attrs/children/content in place, keeping its id (1:1 AI edit). */
  replaceNodeInPlace: (targetId: string, source: VectoNode) => void;
  /** Reparent/reorder a single node relative to a target node (layer DnD). */
  moveNode: (dragId: string, targetId: string, position: "before" | "after") => void;
  /** Append a gradient to document.gradients. */
  addGradient: (gradient: VectoGradient) => void;
  /** Append several gradients at once (paste). */
  addGradients: (gradients: VectoGradient[]) => void;
  /** Merge gradients by id — update existing, add new (AI edit results). */
  upsertGradients: (gradients: VectoGradient[]) => void;
  /** Merge a partial update into a gradient (stops/attributes/type). */
  updateGradient: (id: string, partial: Partial<VectoGradient>) => void;
  /** Remove a gradient by id. */
  removeGradient: (id: string) => void;
  /** Effect filter (drop-shadow / blur) actions. */
  addFilter: (filter: VectoFilter) => void;
  addFilters: (filters: VectoFilter[]) => void;
  updateFilter: (id: string, partial: Partial<VectoFilter>) => void;
  removeFilter: (id: string) => void;
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

      renameNode: (nodeId, name) =>
        set((state) => {
          if (!state.document) return;
          walkNodes(state.document.nodes, nodeId, (node) => {
            node.name = name;
            // Persist so the name survives save/reload (buildName reads data-name).
            node.attributes["data-name"] = name;
          });
          state.isDirty = true;
        }),

      addNode: (node) =>
        set((state) => {
          if (!state.document) return;
          state.document.nodes.push(node as VectoNode);
          state.isDirty = true;
        }),

      addNodes: (nodes) =>
        set((state) => {
          if (!state.document || nodes.length === 0) return;
          state.document.nodes.push(...(nodes as VectoNode[]));
          state.isDirty = true;
        }),

      duplicateNodes: (ids) => {
        const newIds: string[] = [];
        set((state) => {
          if (!state.document) return;
          const srcGradients = state.document.gradients ?? [];
          const srcFilters = state.document.filters ?? [];
          for (const id of ids) {
            const found = findParentList(state.document.nodes, id);
            if (!found) continue;
            // Clone the node AND any gradients/filters it references (fresh ids).
            const { nodes: [clone], gradients, filters } = cloneNodesWithDefs(
              [found.list[found.index]], srcGradients, srcFilters
            );
            if (gradients.length) (state.document.gradients ??= []).push(...gradients);
            if (filters.length) (state.document.filters ??= []).push(...filters);
            found.list.splice(found.index + 1, 0, clone);
            newIds.push(clone.id);
          }
          if (newIds.length > 0) state.isDirty = true;
        });
        return newIds;
      },

      groupNodes: (ids) => {
        let groupId: string | null = null;
        set((state) => {
          if (!state.document || ids.length === 0) return;
          const idSet = new Set(ids);
          // Group only the selected nodes that are siblings of the first one.
          const first = findParentList(state.document.nodes, ids[0]);
          if (!first) return;
          const list = first.list;
          const indices: number[] = [];
          list.forEach((n, i) => { if (idSet.has(n.id)) indices.push(i); });
          if (indices.length === 0) return;

          const insertAt = indices[0];
          const grouped = indices.map((i) => list[i]);
          // Remove back-to-front so earlier indices stay valid.
          for (let k = indices.length - 1; k >= 0; k--) list.splice(indices[k], 1);

          const group: VectoNode = {
            id: nanoid(),
            type: "g",
            tagName: "g",
            attributes: {},
            children: grouped as VectoNode[],
            locked: false,
            visible: true,
            name: "Group",
            editable: true,
          };
          list.splice(insertAt, 0, group);
          groupId = group.id;
          state.isDirty = true;
        });
        return groupId;
      },

      ungroupNodes: (ids) => {
        const promoted: string[] = [];
        set((state) => {
          if (!state.document) return;
          for (const id of ids) {
            const found = findParentList(state.document.nodes, id);
            if (!found) continue;
            const node = found.list[found.index];
            if (node.tagName !== "g" || node.children.length === 0) continue;

            const groupTransform = node.attributes.transform;
            for (const child of node.children) {
              // Push the group's transform down so children render unchanged.
              if (groupTransform) prependTransform(child, groupTransform);
              promoted.push(child.id);
            }
            found.list.splice(found.index, 1, ...node.children);
          }
          if (promoted.length > 0) state.isDirty = true;
        });
        return promoted;
      },

      reorderNodes: (ids, op) =>
        set((state) => {
          if (!state.document || ids.length === 0) return;
          const first = findParentList(state.document.nodes, ids[0]);
          if (!first) return;
          const list = first.list;
          const idSet = new Set(ids);

          // Later in the array = rendered on top.
          if (op === "front" || op === "back") {
            const selected = list.filter((n) => idSet.has(n.id));
            const rest = list.filter((n) => !idSet.has(n.id));
            const ordered = op === "front" ? [...rest, ...selected] : [...selected, ...rest];
            list.splice(0, list.length, ...ordered);
          } else if (op === "forward") {
            for (let i = list.length - 2; i >= 0; i--) {
              if (idSet.has(list[i].id) && !idSet.has(list[i + 1].id)) {
                [list[i], list[i + 1]] = [list[i + 1], list[i]];
              }
            }
          } else if (op === "backward") {
            for (let i = 1; i < list.length; i++) {
              if (idSet.has(list[i].id) && !idSet.has(list[i - 1].id)) {
                [list[i], list[i - 1]] = [list[i - 1], list[i]];
              }
            }
          }
          state.isDirty = true;
        }),

      nudgeNodes: (ids, dx, dy) =>
        set((state) => {
          if (!state.document || (dx === 0 && dy === 0)) return;
          for (const id of ids) {
            const found = findParentList(state.document.nodes, id);
            if (found) prependTransform(found.list[found.index], `translate(${dx} ${dy})`);
          }
          state.isDirty = true;
        }),

      prependTransforms: (items) =>
        set((state) => {
          if (!state.document || items.length === 0) return;
          for (const { id, transform } of items) {
            const found = findParentList(state.document.nodes, id);
            if (found && transform) prependTransform(found.list[found.index], transform);
          }
          state.isDirty = true;
        }),

      replaceNodes: (ids, newNodes) => {
        const newIds: string[] = [];
        set((state) => {
          if (!state.document || ids.length === 0 || newNodes.length === 0) return;
          const idSet = new Set(ids);
          // Operate in the parent list of the first selected node.
          const first = findParentList(state.document.nodes, ids[0]);
          if (!first) return;
          const list = first.list;
          const insertAt = list.findIndex((n) => idSet.has(n.id));
          // Remove selected nodes that live in this list (back-to-front).
          for (let i = list.length - 1; i >= 0; i--) {
            if (idSet.has(list[i].id)) list.splice(i, 1);
          }
          list.splice(insertAt < 0 ? list.length : insertAt, 0, ...(newNodes as VectoNode[]));
          for (const n of newNodes) newIds.push(n.id);
          state.isDirty = true;
        });
        return newIds;
      },

      replaceNodeInPlace: (targetId, source) =>
        set((state) => {
          if (!state.document) return;
          walkNodes(state.document.nodes, targetId, (node) => {
            // Keep node.id / svgId / locked / visible / name; swap the content.
            node.tagName = source.tagName;
            node.type = source.type;
            node.attributes = { ...source.attributes };
            node.children = source.children as VectoNode[];
            node.rawContent = source.rawContent;
          });
          state.isDirty = true;
        }),

      moveNode: (dragId, targetId, position) =>
        set((state) => {
          if (!state.document || dragId === targetId) return;
          const from = findParentList(state.document.nodes, dragId);
          if (!from) return;
          const node = from.list[from.index];
          // Never drop a node into its own subtree.
          if (containsId(node, targetId)) return;

          from.list.splice(from.index, 1);
          const to = findParentList(state.document.nodes, targetId);
          if (!to) {
            // Target vanished (was inside the dragged subtree) — put it back.
            from.list.splice(from.index, 0, node);
            return;
          }
          const insertIdx = position === "after" ? to.index + 1 : to.index;
          to.list.splice(insertIdx, 0, node);
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

      addGradient: (gradient) =>
        set((state) => {
          if (!state.document) return;
          (state.document.gradients ??= []).push(gradient as VectoGradient);
          state.isDirty = true;
        }),

      addGradients: (gradients) =>
        set((state) => {
          if (!state.document || gradients.length === 0) return;
          (state.document.gradients ??= []).push(...(gradients as VectoGradient[]));
          state.isDirty = true;
        }),

      upsertGradients: (gradients) =>
        set((state) => {
          if (!state.document || gradients.length === 0) return;
          const list = (state.document.gradients ??= []);
          for (const g of gradients as VectoGradient[]) {
            const idx = list.findIndex((x) => x.id === g.id);
            if (idx >= 0) list[idx] = g;
            else list.push(g);
          }
          state.isDirty = true;
        }),

      updateGradient: (id, partial) =>
        set((state) => {
          const g = state.document?.gradients?.find((x) => x.id === id);
          if (!g) return;
          Object.assign(g, partial);
          state.isDirty = true;
        }),

      removeGradient: (id) =>
        set((state) => {
          if (!state.document?.gradients) return;
          state.document.gradients = state.document.gradients.filter((g) => g.id !== id);
          state.isDirty = true;
        }),

      addFilter: (filter) =>
        set((state) => {
          if (!state.document) return;
          (state.document.filters ??= []).push(filter as VectoFilter);
          state.isDirty = true;
        }),

      addFilters: (filters) =>
        set((state) => {
          if (!state.document || filters.length === 0) return;
          (state.document.filters ??= []).push(...(filters as VectoFilter[]));
          state.isDirty = true;
        }),

      updateFilter: (id, partial) =>
        set((state) => {
          const f = state.document?.filters?.find((x) => x.id === id);
          if (!f) return;
          Object.assign(f, partial);
          state.isDirty = true;
        }),

      removeFilter: (id) =>
        set((state) => {
          if (!state.document?.filters) return;
          state.document.filters = state.document.filters.filter((f) => f.id !== id);
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

// ── Undo batching ───────────────────────────────────────────────────────────────
// Group a burst of mutations (a drag, a streamed generation, a text edit) into a
// single undo entry. Snapshot the current document into history BEFORE pausing —
// resume() alone does not create an entry — then pause until endUndoBatch().

// Batches are depth-counted. A bare pause()/resume() pair is not safe here:
// an unmatched begin (an interrupted drag, a component unmounting mid-edit)
// left the temporal store paused FOREVER, so every later edit was silently
// dropped from history and undo quietly stopped working for the whole session.
let batchDepth = 0;

export function beginUndoBatch() {
  if (batchDepth === 0) {
    const { pastStates } = useDocumentStore.temporal.getState();
    useDocumentStore.temporal.setState({
      pastStates: [...pastStates, { document: useDocumentStore.getState().document }],
      futureStates: [],
    });
    useDocumentStore.temporal.getState().pause();
  }
  batchDepth++;
}

export function endUndoBatch() {
  if (batchDepth === 0) return; // unmatched end — nothing to close
  batchDepth--;
  if (batchDepth === 0) useDocumentStore.temporal.getState().resume();
}

/**
 * Close every open batch and resume recording, whatever the depth. The safety
 * net for interrupted interactions: pointercancel, lost pointer capture, or a
 * component unmounting while an edit is still open.
 */
export function resetUndoBatch() {
  if (batchDepth === 0) return;
  batchDepth = 0;
  useDocumentStore.temporal.getState().resume();
}

/** True while a batch is open — recording is paused. */
export function isUndoBatchOpen() {
  return batchDepth > 0;
}
