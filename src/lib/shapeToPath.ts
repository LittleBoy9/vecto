import type { VectoNode } from "../types/svg";

/** Geometry attributes that become part of the `d` and should be dropped. */
export const GEOMETRY_KEYS = new Set([
  "x", "y", "width", "height", "rx", "ry", "cx", "cy", "r",
  "x1", "y1", "x2", "y2", "points",
]);

/**
 * Build an equivalent path `d` string for a basic shape, or null if the node
 * isn't a convertible primitive (e.g. text, group, already a path).
 */
export function shapeToPathD(node: VectoNode): string | null {
  const a = node.attributes;
  const n = (k: string) => {
    const v = parseFloat(a[k] ?? "");
    return Number.isFinite(v) ? v : 0;
  };

  switch (node.tagName) {
    case "rect": {
      const x = n("x"), y = n("y"), w = n("width"), h = n("height");
      if (w <= 0 || h <= 0) return null;
      let rx = a.rx !== undefined ? n("rx") : (a.ry !== undefined ? n("ry") : 0);
      let ry = a.ry !== undefined ? n("ry") : (a.rx !== undefined ? n("rx") : 0);
      rx = Math.min(Math.max(rx, 0), w / 2);
      ry = Math.min(Math.max(ry, 0), h / 2);
      if (rx > 0 || ry > 0) {
        return (
          `M ${x + rx} ${y} H ${x + w - rx} ` +
          `A ${rx} ${ry} 0 0 1 ${x + w} ${y + ry} V ${y + h - ry} ` +
          `A ${rx} ${ry} 0 0 1 ${x + w - rx} ${y + h} H ${x + rx} ` +
          `A ${rx} ${ry} 0 0 1 ${x} ${y + h - ry} V ${y + ry} ` +
          `A ${rx} ${ry} 0 0 1 ${x + rx} ${y} Z`
        );
      }
      return `M ${x} ${y} H ${x + w} V ${y + h} H ${x} Z`;
    }
    case "circle": {
      const cx = n("cx"), cy = n("cy"), r = n("r");
      if (r <= 0) return null;
      return `M ${cx - r} ${cy} A ${r} ${r} 0 1 0 ${cx + r} ${cy} A ${r} ${r} 0 1 0 ${cx - r} ${cy} Z`;
    }
    case "ellipse": {
      const cx = n("cx"), cy = n("cy"), rx = n("rx"), ry = n("ry");
      if (rx <= 0 || ry <= 0) return null;
      return `M ${cx - rx} ${cy} A ${rx} ${ry} 0 1 0 ${cx + rx} ${cy} A ${rx} ${ry} 0 1 0 ${cx - rx} ${cy} Z`;
    }
    case "line":
      return `M ${n("x1")} ${n("y1")} L ${n("x2")} ${n("y2")}`;
    case "polyline":
    case "polygon": {
      const pts = (a.points ?? "").trim().split(/[\s,]+/).map(Number).filter((v) => Number.isFinite(v));
      if (pts.length < 4) return null;
      let d = `M ${pts[0]} ${pts[1]}`;
      for (let i = 2; i < pts.length - 1; i += 2) d += ` L ${pts[i]} ${pts[i + 1]}`;
      if (node.tagName === "polygon") d += " Z";
      return d;
    }
    default:
      return null;
  }
}
