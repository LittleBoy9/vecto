import { nanoid } from "nanoid";
import type { VectoNode, VectoGradient, VectoFilter } from "../types/svg";

/** Deep-clone a node subtree, assigning fresh internal ids throughout. */
export function cloneWithFreshIds(node: VectoNode): VectoNode {
  return {
    ...node,
    id: nanoid(),
    attributes: { ...node.attributes },
    children: node.children.map(cloneWithFreshIds),
  };
}

const URL_REF = /url\(#([^)]+)\)/;
const GRAD_ATTRS = ["fill", "stroke"] as const;

function collectRefs(node: VectoNode, grads: Set<string>, filts: Set<string>) {
  for (const key of GRAD_ATTRS) {
    const m = (node.attributes[key] ?? "").match(URL_REF);
    if (m) grads.add(m[1]);
  }
  const fm = (node.attributes.filter ?? "").match(URL_REF);
  if (fm) filts.add(fm[1]);
  node.children.forEach((c) => collectRefs(c, grads, filts));
}

/** Set of gradient ids referenced (via fill/stroke url(#id)) by these nodes. */
export function referencedGradientIds(nodes: VectoNode[]): Set<string> {
  const g = new Set<string>(), f = new Set<string>();
  nodes.forEach((n) => collectRefs(n, g, f));
  return g;
}

/** Set of filter ids referenced (via filter="url(#id)") by these nodes. */
export function referencedFilterIds(nodes: VectoNode[]): Set<string> {
  const g = new Set<string>(), f = new Set<string>();
  nodes.forEach((n) => collectRefs(n, g, f));
  return f;
}

function remapRefs(node: VectoNode, gradMap: Map<string, string>, filtMap: Map<string, string>) {
  for (const key of GRAD_ATTRS) {
    const m = node.attributes[key]?.match(URL_REF);
    if (m && gradMap.has(m[1])) node.attributes[key] = `url(#${gradMap.get(m[1])})`;
  }
  const fm = node.attributes.filter?.match(URL_REF);
  if (fm && filtMap.has(fm[1])) node.attributes.filter = `url(#${filtMap.get(fm[1])})`;
  node.children.forEach((c) => remapRefs(c, gradMap, filtMap));
}

/**
 * Deep-clone nodes with fresh ids AND clone any gradients/filters they reference
 * (also with fresh ids), rewriting the url(#id) references to match. Used by
 * duplicate / copy-paste so effect/gradient shapes don't share or lose their defs.
 */
export function cloneNodesWithDefs(
  nodes: VectoNode[],
  sourceGradients: VectoGradient[],
  sourceFilters: VectoFilter[]
): { nodes: VectoNode[]; gradients: VectoGradient[]; filters: VectoFilter[] } {
  const gRefs = new Set<string>(), fRefs = new Set<string>();
  nodes.forEach((n) => collectRefs(n, gRefs, fRefs));

  const gradMap = new Map<string, string>();
  const gradients: VectoGradient[] = [];
  const gById = new Map(sourceGradients.map((g) => [g.id, g]));
  for (const oldId of gRefs) {
    const g = gById.get(oldId);
    if (!g) continue;
    const newId = `grad-${nanoid(6)}`;
    gradMap.set(oldId, newId);
    gradients.push({ id: newId, type: g.type, attributes: { ...g.attributes }, stops: g.stops.map((s) => ({ ...s })) });
  }

  const filtMap = new Map<string, string>();
  const filters: VectoFilter[] = [];
  const fById = new Map(sourceFilters.map((f) => [f.id, f]));
  for (const oldId of fRefs) {
    const f = fById.get(oldId);
    if (!f) continue;
    const newId = `filt-${nanoid(6)}`;
    filtMap.set(oldId, newId);
    filters.push({ ...f, id: newId });
  }

  const cloned = nodes.map(cloneWithFreshIds);
  if (gradMap.size > 0 || filtMap.size > 0) cloned.forEach((n) => remapRefs(n, gradMap, filtMap));
  return { nodes: cloned, gradients, filters };
}

/** Find a node anywhere in the tree by internal id. */
export function findNode(nodes: VectoNode[], id: string): VectoNode | null {
  for (const n of nodes) {
    if (n.id === id) return n;
    const found = findNode(n.children, id);
    if (found) return found;
  }
  return null;
}

/**
 * Locate the array (and index) that directly contains a node id.
 * Returns the live array reference — inside an Immer producer this is the draft,
 * so splicing it mutates state. Returns null if not found.
 */
export function findParentList(
  nodes: VectoNode[],
  id: string
): { list: VectoNode[]; index: number } | null {
  for (let i = 0; i < nodes.length; i++) {
    if (nodes[i].id === id) return { list: nodes, index: i };
    const inChild = findParentList(nodes[i].children, id);
    if (inChild) return inChild;
  }
  return null;
}

/** True if `maybeDescendantId` is `node` itself or anywhere under it. */
export function containsId(node: VectoNode, maybeDescendantId: string): boolean {
  if (node.id === maybeDescendantId) return true;
  return node.children.some((c) => containsId(c, maybeDescendantId));
}
