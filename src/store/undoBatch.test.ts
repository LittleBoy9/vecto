import { beforeEach, describe, expect, it } from "vitest";
import {
  beginUndoBatch,
  endUndoBatch,
  isUndoBatchOpen,
  resetUndoBatch,
  useDocumentStore,
} from "./documentStore";
import type { VectoDocument, VectoNode } from "../types/svg";

const rect = (id: string): VectoNode => ({
  id, type: "rect", tagName: "rect", attributes: { x: "0" },
  children: [], locked: false, visible: true, name: "rect", editable: true,
});

const doc = (): VectoDocument => ({
  id: "d", viewBox: { x: 0, y: 0, width: 10, height: 10 },
  width: "10", height: "10", nodes: [rect("a")],
});

const depth = () => useDocumentStore.temporal.getState().pastStates.length;

beforeEach(() => {
  resetUndoBatch();
  useDocumentStore.temporal.getState().clear();
  useDocumentStore.getState().setDocument(doc());
  useDocumentStore.temporal.getState().clear();
});

describe("undo batching", () => {
  it("records one history entry per edit when no batch is open", () => {
    const before = depth();
    useDocumentStore.getState().updateNodeAttributes("a", { x: "1" });
    useDocumentStore.getState().updateNodeAttributes("a", { x: "2" });
    expect(depth()).toBe(before + 2);
  });

  it("collapses a burst of edits into a single entry", () => {
    const before = depth();
    beginUndoBatch();
    for (let i = 0; i < 10; i++) useDocumentStore.getState().updateNodeAttributes("a", { x: String(i) });
    endUndoBatch();
    expect(depth()).toBe(before + 1);
  });

  it("resumes recording after the batch closes", () => {
    beginUndoBatch();
    useDocumentStore.getState().updateNodeAttributes("a", { x: "1" });
    endUndoBatch();
    const after = depth();
    useDocumentStore.getState().updateNodeAttributes("a", { x: "2" });
    expect(depth()).toBe(after + 1);
  });

  // Regression: batching was a bare pause()/resume() pair, so a nested begin
  // followed by a single end resumed recording while the outer batch was still
  // meant to be collapsing — and an unmatched end could resume it early.
  it("only resumes when the outermost batch closes", () => {
    const before = depth();
    beginUndoBatch();
    beginUndoBatch();
    useDocumentStore.getState().updateNodeAttributes("a", { x: "1" });
    endUndoBatch();
    expect(isUndoBatchOpen()).toBe(true);
    useDocumentStore.getState().updateNodeAttributes("a", { x: "2" });
    endUndoBatch();
    expect(isUndoBatchOpen()).toBe(false);
    expect(depth()).toBe(before + 1);
  });

  it("ignores an unmatched end", () => {
    expect(isUndoBatchOpen()).toBe(false);
    endUndoBatch();
    const before = depth();
    useDocumentStore.getState().updateNodeAttributes("a", { x: "1" });
    expect(depth()).toBe(before + 1);
  });

  // Regression: an interrupted drag left the temporal store paused forever, so
  // every later edit was silently dropped and undo died for the whole session.
  it("recovers from an abandoned batch via resetUndoBatch", () => {
    beginUndoBatch();
    beginUndoBatch();
    useDocumentStore.getState().updateNodeAttributes("a", { x: "1" });
    resetUndoBatch();
    expect(isUndoBatchOpen()).toBe(false);
    const after = depth();
    useDocumentStore.getState().updateNodeAttributes("a", { x: "9" });
    expect(depth()).toBe(after + 1);
  });
});
