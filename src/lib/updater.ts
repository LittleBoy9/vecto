import { check, type Update } from "@tauri-apps/plugin-updater";
import { relaunch } from "@tauri-apps/plugin-process";
import { useUpdateStore, isDismissed } from "../store/updateStore";
import { useDocumentStore } from "../store/documentStore";
import { serializeDocument } from "./svgSerializer";
import { saveRecovery } from "./recovery";

/**
 * Auto-update, consent-first.
 *
 * The deliberate difference from the usual Tauri wiring: nothing downloads and
 * nothing restarts until the user asks for it. Vecto is a document editor —
 * silently swapping the binary and relaunching can destroy unsaved artwork, so
 * the flow is check → tell → wait → download → confirm → restart.
 */

/** The pending update handle, held between "available" and "install". */
let pending: Update | null = null;

/**
 * Look for a newer signed build.
 *
 * Silent by design when `silent` is true (the boot probe): offline, dev mode
 * with no endpoint, and a missing manifest all throw, and none of them are
 * worth interrupting someone's work over. A manual check from Settings passes
 * `silent: false` so the user gets an answer either way.
 */
export async function checkForUpdate(silent = true): Promise<void> {
  const store = useUpdateStore.getState();
  if (store.phase === "downloading" || store.phase === "ready") return;

  if (!silent) store.setChecking(true);
  try {
    const update = await check();
    if (!update) {
      pending = null;
      if (!silent) store.reset();
      return;
    }
    // Respect an earlier "Later" for this exact version.
    if (silent && isDismissed(update.version)) return;

    pending = update;
    store.setAvailable(update.version, update.body ?? null);
  } catch (err) {
    pending = null;
    if (!silent) store.setError(readableError(err));
    // Silent probe: stay quiet. A background update check must never present
    // itself as an application error.
  } finally {
    if (!silent) useUpdateStore.getState().setChecking(false);
  }
}

/**
 * Download and stage the pending update. Reports byte progress so the banner
 * can show something truthful rather than an indeterminate spinner.
 */
export async function downloadUpdate(): Promise<void> {
  const store = useUpdateStore.getState();
  if (!pending) {
    store.setError("The update is no longer available. Try checking again.");
    return;
  }

  store.setDownloading();
  let total = 0;
  let received = 0;

  try {
    await pending.download((event) => {
      switch (event.event) {
        case "Started":
          total = event.data.contentLength ?? 0;
          store.setProgress(total > 0 ? 0 : null);
          break;
        case "Progress":
          received += event.data.chunkLength;
          // No content-length means no honest percentage — show indeterminate.
          store.setProgress(total > 0 ? Math.min(1, received / total) : null);
          break;
        case "Finished":
          store.setProgress(1);
          break;
      }
    });
    useUpdateStore.getState().setReady();
  } catch (err) {
    useUpdateStore.getState().setError(readableError(err));
  }
}

/**
 * Install the staged update and restart.
 *
 * Before relaunching, an unsaved document is written to the crash-recovery
 * snapshot, so the work is still there after the new binary starts even if the
 * user never saved it to disk. Callers are expected to have confirmed with the
 * user first when the document is dirty — see UpdateBanner.
 */
export async function installAndRestart(): Promise<void> {
  const store = useUpdateStore.getState();
  if (!pending) {
    store.setError("The update is no longer available. Try checking again.");
    return;
  }

  // Never let a restart be the reason someone loses work.
  const { document, isDirty, filePath } = useDocumentStore.getState();
  if (document && isDirty) {
    try {
      saveRecovery(serializeDocument(document), filePath);
    } catch {
      /* recovery is best-effort — a quota failure must not block the update */
    }
  }

  try {
    await pending.install();
    await relaunch();
  } catch (err) {
    useUpdateStore.getState().setError(readableError(err));
  }
}

/** True when the current document has unsaved changes. */
export function hasUnsavedWork(): boolean {
  const { document, isDirty } = useDocumentStore.getState();
  return !!document && isDirty;
}

function readableError(err: unknown): string {
  const raw = String((err as Error)?.message ?? err);
  if (/network|dns|connect|timed? ?out/i.test(raw)) {
    return "Couldn't reach the update server. Check your connection and try again.";
  }
  if (/signature|verify/i.test(raw)) {
    return "The update failed its signature check and was not installed.";
  }
  return raw;
}
