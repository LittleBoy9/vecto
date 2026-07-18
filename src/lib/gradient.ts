import { nanoid } from "nanoid";
import { colorToHex } from "./utils";
import type { VectoGradient } from "../types/svg";

const fmt = (n: number) => parseFloat(n.toFixed(4)).toString();

export function newGradientId() {
  return `grad-${nanoid(6)}`;
}

/** A 2-stop horizontal linear gradient seeded from a solid color. */
export function makeLinearGradient(id: string, color: string): VectoGradient {
  return {
    id,
    type: "linear",
    attributes: { x1: "0", y1: "0", x2: "1", y2: "0" },
    stops: [
      { offset: 0, color, opacity: 1 },
      { offset: 1, color: "#ffffff", opacity: 1 },
    ],
  };
}

/** Read the angle (deg) of a linear gradient from its x1/y1/x2/y2. */
export function linearAngle(attrs: Record<string, string>): number {
  const x1 = parseFloat(attrs.x1 ?? "0"), y1 = parseFloat(attrs.y1 ?? "0");
  const x2 = parseFloat(attrs.x2 ?? "1"), y2 = parseFloat(attrs.y2 ?? "0");
  return Math.round((Math.atan2(y2 - y1, x2 - x1) * 180) / Math.PI);
}

/** Set a linear gradient's direction from an angle (deg), through the box center. */
export function setLinearAngle(attrs: Record<string, string>, deg: number): Record<string, string> {
  const rad = (deg * Math.PI) / 180;
  return {
    ...attrs,
    x1: fmt(0.5 - Math.cos(rad) / 2),
    y1: fmt(0.5 - Math.sin(rad) / 2),
    x2: fmt(0.5 + Math.cos(rad) / 2),
    y2: fmt(0.5 + Math.sin(rad) / 2),
  };
}

/** CSS gradient string for the editor preview bar (stops only, left→right). */
export function gradientCss(g: VectoGradient): string {
  const stops = [...g.stops]
    .sort((a, b) => a.offset - b.offset)
    .map((s) => `${s.color} ${Math.round(s.offset * 100)}%`)
    .join(", ");
  return `linear-gradient(to right, ${stops})`;
}

/** Normalize any color to a #rrggbb the ColorPopover can seed from. */
export function toHexSeed(color: string): string {
  const hex = colorToHex(color);
  return hex.startsWith("#") ? hex : "#888888";
}
