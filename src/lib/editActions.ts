/**
 * Selection edit operations shared by the keyboard shortcuts and the right-click
 * context menu. Each reads fresh state via getState(), so they're safe to call
 * from anywhere (event handlers, menu items).
 */
import { nanoid } from "nanoid";
import { useDocumentStore, beginUndoBatch, endUndoBatch, type ReorderOp } from "../store/documentStore";
import { useSelectionStore } from "../store/selectionStore";
import { findNode } from "./nodeUtils";
import { setClipboard, readClipboard, hasClipboard } from "./clipboard";
import { shapeToPathD, GEOMETRY_KEYS } from "./shapeToPath";
import { booleanPath, type BoolOp } from "./boolean";
import type { VectoDocument, VectoNode } from "../types/svg";
import type { ContextMenuItem } from "../store/contextMenuStore";

/** Selected nodes in document (paint) order — bottom-most first. */
function orderedSelected(doc: VectoDocument, ids: string[]): VectoNode[] {
  const set = new Set(ids);
  const out: VectoNode[] = [];
  const walk = (nodes: VectoNode[]) => {
    for (const n of nodes) {
      if (set.has(n.id)) out.push(n);
      walk(n.children);
    }
  };
  walk(doc.nodes);
  return out;
}

export function duplicateSelection() {
  const sel = useSelectionStore.getState().selectedIds;
  if (!sel.length) return;
  const ids = useDocumentStore.getState().duplicateNodes(sel);
  if (ids.length) useSelectionStore.getState().select(ids);
}

export function copySelection() {
  const doc = useDocumentStore.getState().document;
  const sel = useSelectionStore.getState().selectedIds;
  if (!doc || !sel.length) return;
  const nodes = sel.map((id) => findNode(doc.nodes, id)).filter(Boolean) as VectoNode[];
  setClipboard(nodes, doc.gradients ?? [], doc.filters ?? []);
}

export function cutSelection() {
  const sel = useSelectionStore.getState().selectedIds;
  if (!sel.length) return;
  copySelection();
  useDocumentStore.getState().deleteNodes(sel);
  useSelectionStore.getState().clearSelection();
}

export function pasteClipboard() {
  if (!hasClipboard()) return;
  const { nodes: fresh, gradients, filters } = readClipboard();
  for (const n of fresh) {
    n.attributes.transform = n.attributes.transform
      ? `translate(10 10) ${n.attributes.transform}`
      : "translate(10 10)";
  }
  const store = useDocumentStore.getState();
  // Defs + nodes = one undo step.
  beginUndoBatch();
  if (gradients.length) store.addGradients(gradients);
  if (filters.length) store.addFilters(filters);
  store.addNodes(fresh);
  endUndoBatch();
  useSelectionStore.getState().select(fresh.map((n) => n.id));
}

export function deleteSelection() {
  const sel = useSelectionStore.getState().selectedIds;
  if (!sel.length) return;
  useDocumentStore.getState().deleteNodes(sel);
  useSelectionStore.getState().clearSelection();
}

export function groupSelection() {
  const sel = useSelectionStore.getState().selectedIds;
  if (!sel.length) return;
  const gid = useDocumentStore.getState().groupNodes(sel);
  if (gid) useSelectionStore.getState().select([gid]);
}

export function ungroupSelection() {
  const sel = useSelectionStore.getState().selectedIds;
  if (!sel.length) return;
  const promoted = useDocumentStore.getState().ungroupNodes(sel);
  if (promoted.length) useSelectionStore.getState().select(promoted);
}

export function reorderSelection(op: ReorderOp) {
  const sel = useSelectionStore.getState().selectedIds;
  if (sel.length) useDocumentStore.getState().reorderNodes(sel, op);
}

/** Combine 2+ selected shapes/paths into one path via a boolean operation. */
export function booleanSelection(op: BoolOp) {
  const sel = useSelectionStore.getState().selectedIds;
  const doc = useDocumentStore.getState().document;
  if (sel.length < 2 || !doc) return;

  const ordered = orderedSelected(doc, sel);
  const d = booleanPath(ordered, op);
  if (!d) return;

  // Inherit appearance from the top-most node; geometry/transform reset (d is absolute).
  const styleSrc = ordered[ordered.length - 1];
  const attrs: Record<string, string> = { d };
  for (const [k, v] of Object.entries(styleSrc.attributes)) {
    if (!GEOMETRY_KEYS.has(k) && k !== "d" && k !== "transform") attrs[k] = v;
  }
  const newNode: VectoNode = {
    id: nanoid(), type: "path", tagName: "path", attributes: attrs,
    children: [], locked: false, visible: true, name: "path", editable: true,
  };
  const newIds = useDocumentStore.getState().replaceNodes(sel, [newNode]);
  if (newIds.length) useSelectionStore.getState().select(newIds);
}

/** Convert selected basic shapes (rect/circle/ellipse/line/poly) to <path>. */
export function convertSelectionToPath() {
  const sel = useSelectionStore.getState().selectedIds;
  const doc = useDocumentStore.getState().document;
  if (!sel.length || !doc) return;
  const store = useDocumentStore.getState();

  const targets: { id: string; node: VectoNode; d: string }[] = [];
  for (const id of sel) {
    const node = findNode(doc.nodes, id);
    if (!node) continue;
    const d = shapeToPathD(node);
    if (d) targets.push({ id, node, d });
  }
  if (!targets.length) return;

  beginUndoBatch();
  for (const { id, node, d } of targets) {
    const attrs: Record<string, string> = { d };
    for (const [k, v] of Object.entries(node.attributes)) {
      if (!GEOMETRY_KEYS.has(k)) attrs[k] = v;
    }
    store.replaceNodeInPlace(id, {
      ...node, type: "path", tagName: "path", attributes: attrs, children: [], rawContent: undefined,
    });
  }
  endUndoBatch();
}

/** Build the standard right-click menu for the canvas / layer panel. */
export function selectionContextItems(hasSelection: boolean): ContextMenuItem[] {
  const canPaste = hasClipboard();
  const multi = useSelectionStore.getState().selectedIds.length >= 2;
  return [
    { label: "Duplicate", shortcut: "⌘D", onClick: duplicateSelection, disabled: !hasSelection },
    { label: "Copy", shortcut: "⌘C", onClick: copySelection, disabled: !hasSelection },
    { label: "Paste", shortcut: "⌘V", onClick: pasteClipboard, disabled: !canPaste },
    { label: "Delete", shortcut: "⌫", onClick: deleteSelection, disabled: !hasSelection, danger: true },
    { separator: true },
    { label: "Group", shortcut: "⌘G", onClick: groupSelection, disabled: !hasSelection },
    { label: "Ungroup", shortcut: "⌘⇧G", onClick: ungroupSelection, disabled: !hasSelection },
    { separator: true },
    { label: "Bring to Front", shortcut: "⌘]", onClick: () => reorderSelection("front"), disabled: !hasSelection },
    { label: "Bring Forward", shortcut: "]", onClick: () => reorderSelection("forward"), disabled: !hasSelection },
    { label: "Send Backward", shortcut: "[", onClick: () => reorderSelection("backward"), disabled: !hasSelection },
    { label: "Send to Back", shortcut: "⌘[", onClick: () => reorderSelection("back"), disabled: !hasSelection },
    { separator: true },
    { label: "Unite", onClick: () => booleanSelection("union"), disabled: !multi },
    { label: "Subtract", onClick: () => booleanSelection("subtract"), disabled: !multi },
    { label: "Intersect", onClick: () => booleanSelection("intersect"), disabled: !multi },
    { label: "Exclude", onClick: () => booleanSelection("exclude"), disabled: !multi },
    { separator: true },
    { label: "Convert to Path", onClick: convertSelectionToPath, disabled: !hasSelection },
  ];
}
