import { useCallback, useEffect, useRef } from "react";
import { beginUndoBatch, endUndoBatch } from "../store/documentStore";

/**
 * Scoped undo batching for a component that collapses a burst of edits into one
 * history entry (a slider drag, a color pick, a run of keystrokes).
 *
 * `begin` is idempotent, `end` is safe to call when nothing is open, and the
 * batch is closed automatically if the component unmounts while still editing.
 * That last part matters: every call site used to hand-roll a `batchingRef`
 * boolean whose `end` depended on an event that is not guaranteed to fire —
 * a pointerup released outside the window, a blur that never happens because
 * the element unmounted first. One miss paused undo recording permanently.
 */
export function useUndoBatch() {
  const open = useRef(false);

  const begin = useCallback(() => {
    if (open.current) return;
    open.current = true;
    beginUndoBatch();
  }, []);

  const end = useCallback(() => {
    if (!open.current) return;
    open.current = false;
    endUndoBatch();
  }, []);

  useEffect(
    () => () => {
      if (open.current) {
        open.current = false;
        endUndoBatch();
      }
    },
    []
  );

  return { begin, end };
}
