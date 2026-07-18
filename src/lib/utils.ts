import { clsx, type ClassValue } from "clsx";
import { twMerge } from "tailwind-merge";

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs));
}

/** Filename from a path — handles both / (mac/linux) and \ (windows) separators. */
export function basename(path: string): string {
  return path.split(/[\\/]/).pop() || path;
}

/**
 * Resolve any CSS color value (named, rgb(), hsl(), hex) to a lowercase hex
 * string. Uses a 1×1 canvas so the browser does the normalization.
 * Returns the original string unchanged for non-color values ("none", url(…), etc).
 */
export function colorToHex(color: string): string {
  if (!color) return color;
  const lower = color.trim().toLowerCase();
  if (
    lower === "none" ||
    lower === "transparent" ||
    lower.startsWith("url(") ||
    lower.startsWith("var(") ||
    lower.startsWith("currentcolor")
  ) {
    return color;
  }
  try {
    const canvas = document.createElement("canvas");
    canvas.width = canvas.height = 1;
    const ctx = canvas.getContext("2d");
    if (!ctx) return color;
    ctx.fillStyle = lower;
    // If the browser couldn't parse the color, fillStyle stays black — return original
    if (ctx.fillStyle === "#000000" && lower !== "black" && lower !== "#000000" && lower !== "#000") {
      return color;
    }
    return ctx.fillStyle; // always returns lowercase hex like "#ffffff"
  } catch {
    return color;
  }
}

/** Return a node icon character for the layer panel based on SVG tag. */
export function nodeIcon(tagName: string): string {
  const icons: Record<string, string> = {
    g: "□",
    path: "⌇",
    rect: "▭",
    circle: "○",
    ellipse: "⬭",
    line: "╱",
    polyline: "⌒",
    polygon: "⬡",
    text: "T",
    image: "▨",
    use: "⎘",
  };
  return icons[tagName] ?? "?";
}
