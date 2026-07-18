import polygonClipping from "polygon-clipping";
import type { MultiPolygon, Polygon, Pair } from "polygon-clipping";
import { parsePath, evalCubicBezier } from "./pathParser";
import { getDocMatrix } from "./bbox";
import { shapeToPathD } from "./shapeToPath";
import type { VectoNode } from "../types/svg";

// Typed view over the default export (union/intersection/difference/xor).
const clip = polygonClipping as {
  union: (g: Polygon | MultiPolygon, ...r: (Polygon | MultiPolygon)[]) => MultiPolygon;
  intersection: (g: Polygon | MultiPolygon, ...r: (Polygon | MultiPolygon)[]) => MultiPolygon;
  difference: (g: Polygon | MultiPolygon, ...r: (Polygon | MultiPolygon)[]) => MultiPolygon;
  xor: (g: Polygon | MultiPolygon, ...r: (Polygon | MultiPolygon)[]) => MultiPolygon;
};

export type BoolOp = "union" | "subtract" | "intersect" | "exclude";

const SEGMENTS = 24; // bezier flattening resolution

/** Flatten a node's outline to polygon rings, in DOCUMENT coordinates. */
function nodeToRings(node: VectoNode): Pair[][] | null {
  const d = node.tagName === "path" ? node.attributes.d : shapeToPathD(node);
  if (!d) return null;

  const m = getDocMatrix(node.id);
  const apply = (x: number, y: number): Pair => {
    if (!m) return [x, y];
    const p = new DOMPoint(x, y).matrixTransform(m);
    return [p.x, p.y];
  };

  const rings: Pair[][] = [];
  for (const c of parsePath(d)) {
    const nodes = c.nodes;
    if (nodes.length < 2) continue;
    const ring: Pair[] = [apply(nodes[0].x, nodes[0].y)];
    const count = c.closed ? nodes.length : nodes.length - 1;
    for (let i = 0; i < count; i++) {
      const a = nodes[i], b = nodes[(i + 1) % nodes.length];
      const ho = a.handleOut, hi = b.handleIn;
      if (!ho && !hi) {
        ring.push(apply(b.x, b.y));
      } else {
        const p0 = { x: a.x, y: a.y };
        const p1 = ho ?? { x: a.x, y: a.y };
        const p2 = hi ?? { x: b.x, y: b.y };
        const p3 = { x: b.x, y: b.y };
        for (let s = 1; s <= SEGMENTS; s++) {
          const pt = evalCubicBezier(s / SEGMENTS, p0, p1, p2, p3);
          ring.push(apply(pt.x, pt.y));
        }
      }
    }
    if (ring.length >= 3) rings.push(ring);
  }
  return rings.length ? rings : null;
}

/** A node's filled region (union of its subpaths). */
function nodeRegion(node: VectoNode): MultiPolygon | null {
  const rings = nodeToRings(node);
  if (!rings) return null;
  const polys: Polygon[] = rings.map((r) => [r]);
  return clip.union(polys[0], ...polys.slice(1));
}

function fmt(n: number) { return parseFloat(n.toFixed(3)).toString(); }

function multiPolygonToD(mp: MultiPolygon): string | null {
  const parts: string[] = [];
  for (const poly of mp) {
    for (const ring of poly) {
      if (ring.length < 3) continue;
      const last = ring[ring.length - 1];
      // polygon-clipping closes rings (first === last) — drop the dup.
      const pts = last[0] === ring[0][0] && last[1] === ring[0][1] ? ring.slice(0, -1) : ring;
      parts.push("M " + pts.map(([x, y]) => `${fmt(x)} ${fmt(y)}`).join(" L ") + " Z");
    }
  }
  return parts.length ? parts.join(" ") : null;
}

/**
 * Combine several nodes into one path `d` via a boolean op. `nodes` must be in
 * document (paint) order — first = bottom-most, used as the base for subtract.
 * Returns null if fewer than two convertible regions.
 */
export function booleanPath(nodes: VectoNode[], op: BoolOp): string | null {
  const regions = nodes.map(nodeRegion).filter(Boolean) as MultiPolygon[];
  if (regions.length < 2) return null;

  const [first, ...rest] = regions;
  let result: MultiPolygon;
  switch (op) {
    case "union":     result = clip.union(first, ...rest); break;
    case "intersect": result = clip.intersection(first, ...rest); break;
    case "subtract":  result = clip.difference(first, ...rest); break;
    case "exclude":   result = clip.xor(first, ...rest); break;
  }
  return multiPolygonToD(result);
}
