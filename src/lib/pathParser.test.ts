import { describe, expect, it } from "vitest";
import { evalCubicBezier, parsePath, serializePath } from "./pathParser";
import { shapeToPathD } from "./shapeToPath";
import type { VectoNode } from "../types/svg";

/** Sample points along every segment of a parsed path. */
function samplePath(d: string, per = 16): { x: number; y: number }[] {
  const pts: { x: number; y: number }[] = [];
  for (const c of parsePath(d)) {
    const n = c.nodes;
    const count = c.closed ? n.length : n.length - 1;
    for (let i = 0; i < count; i++) {
      const a = n[i];
      const b = n[(i + 1) % n.length];
      const p0 = { x: a.x, y: a.y };
      const p3 = { x: b.x, y: b.y };
      for (let s = 0; s <= per; s++) {
        pts.push(evalCubicBezier(s / per, p0, a.handleOut ?? p0, b.handleIn ?? p3, p3));
      }
    }
  }
  return pts;
}

const endpointOf = (d: string) => {
  const c = parsePath(d);
  const n = c[c.length - 1].nodes;
  return n[n.length - 1];
};

const shape = (tagName: string, attributes: Record<string, string>): VectoNode => ({
  id: "n", type: tagName as VectoNode["type"], tagName, attributes,
  children: [], locked: false, visible: true, name: tagName, editable: true,
});

describe("arc handling", () => {
  // Regression: arcs were kept as bare endpoints with no handles, so
  // re-serializing (which any node edit does) rewrote them as straight lines.
  it("keeps an arc curved through a parse/serialize cycle", () => {
    const out = serializePath(parsePath("M 10 10 A 5 5 0 1 0 20 10 A 5 5 0 1 0 10 10 Z"));
    expect(out).toContain("C ");
    expect(out).not.toMatch(/^M 10 10 L 20 10 L 10 10 Z$/);
  });

  it("approximates a circle to within 0.1% of its radius", () => {
    const d = shapeToPathD(shape("circle", { cx: "50", cy: "50", r: "25" }))!;
    const err = Math.max(...samplePath(d).map((p) => Math.abs(Math.hypot(p.x - 50, p.y - 50) - 25)));
    expect(err).toBeLessThan(0.025);
  });

  it("stays a circle after convert-to-path then node-edit", () => {
    // The exact workflow that used to collapse a circle to a zero-area sliver.
    const edited = serializePath(parsePath(shapeToPathD(shape("circle", { cx: "50", cy: "50", r: "25" }))!));
    const err = Math.max(...samplePath(edited).map((p) => Math.abs(Math.hypot(p.x - 50, p.y - 50) - 25)));
    expect(err).toBeLessThan(0.025);
  });

  it.each([[0, 0], [0, 1], [1, 0], [1, 1]])(
    "lands exactly on the endpoint for large-arc=%i sweep=%i",
    (large, sweep) => {
      const e = endpointOf(`M 0 0 A 20 10 0 ${large} ${sweep} 30 10`);
      expect(e.x).toBeCloseTo(30, 9);
      expect(e.y).toBeCloseTo(10, 9);
    }
  );

  it("honours the rotation parameter", () => {
    const e = endpointOf("M 10 20 A 30 15 40 1 1 60 45");
    expect(e.x).toBeCloseTo(60, 9);
    expect(e.y).toBeCloseTo(45, 9);
  });

  it("bows opposite ways for sweep=0 and sweep=1", () => {
    const mid = (d: string) => { const s = samplePath(d); return s[Math.floor(s.length / 2)].y; };
    expect(Math.sign(mid("M 0 0 A 10 10 0 0 1 20 0"))).not.toBe(
      Math.sign(mid("M 0 0 A 10 10 0 0 0 20 0"))
    );
  });

  it("scales up radii too small to span the endpoints", () => {
    const e = endpointOf("M 0 0 A 1 1 0 0 1 50 0");
    expect(Number.isFinite(e.x)).toBe(true);
    expect(e.x).toBeCloseTo(50, 9);
  });

  it("treats a zero radius as a straight line", () => {
    const e = endpointOf("M 0 0 A 0 0 0 0 1 10 10");
    expect(e.x).toBeCloseTo(10, 9);
    expect(e.y).toBeCloseTo(10, 9);
  });
});

describe("command normalization", () => {
  it.each([
    ["absolute line", "M 0 0 L 10 0 L 10 10 Z", "M 0 0 L 10 0 L 10 10 Z"],
    ["relative line", "m 0 0 l 10 0 l 0 10 z", "M 0 0 L 10 0 L 10 10 Z"],
    ["H and V", "M 0 0 H 10 V 10 Z", "M 0 0 L 10 0 L 10 10 Z"],
  ])("normalizes %s", (_n, input, expected) => {
    expect(serializePath(parsePath(input))).toBe(expected);
  });

  it("preserves cubic control points exactly", () => {
    expect(serializePath(parsePath("M 0 0 C 5 0 10 5 10 10"))).toBe("M 0 0 C 5 0 10 5 10 10");
  });

  it("upgrades a quadratic to an equivalent cubic", () => {
    const q = samplePath("M 0 0 Q 5 -5 10 0");
    // Apex of the quadratic sits at y = -2.5 at t = 0.5.
    expect(Math.min(...q.map((p) => p.y))).toBeCloseTo(-2.5, 6);
  });

  it("reflects the control point of a smooth S command", () => {
    expect(serializePath(parsePath("M 0 0 C 2 -2 4 -2 6 0 S 10 2 12 0")))
      .toBe("M 0 0 C 2 -2 4 -2 6 0 C 8 2 10 2 12 0");
  });
});
