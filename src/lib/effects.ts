import { nanoid } from "nanoid";
import type { VectoFilter } from "../types/svg";

export function newFilterId() {
  return `filt-${nanoid(6)}`;
}

/** A filter seeded with sensible defaults for the given effect type. */
export function makeFilter(id: string, type: "drop-shadow" | "blur"): VectoFilter {
  return type === "drop-shadow"
    ? { id, type, dx: 4, dy: 4, blur: 4, color: "#000000", opacity: 0.4 }
    : { id, type, dx: 0, dy: 0, blur: 4, color: "#000000", opacity: 1 };
}
