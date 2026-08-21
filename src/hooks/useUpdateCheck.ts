import { useEffect } from "react";
import { checkForUpdate } from "../lib/updater";

/** Delay so the probe never competes with first paint or document restore. */
const BOOT_DELAY_MS = 4000;

/**
 * Probe for a newer build once, shortly after launch. Mount once in App.
 *
 * Failure is silent by design — offline, dev mode, and a not-yet-published
 * manifest all throw, and none of them should present as an app error.
 */
export function useUpdateCheck() {
  useEffect(() => {
    const id = setTimeout(() => void checkForUpdate(true), BOOT_DELAY_MS);
    return () => clearTimeout(id);
  }, []);
}
