import { useState } from "react";
import { parseSVG } from "../../lib/svgParser";
import { loadRecovery, clearRecovery } from "../../lib/recovery";
import { useDocumentStore } from "../../store/documentStore";

/** One-time prompt to restore an autosaved document after a crash/quit. */
export function RecoveryBanner() {
  const [recovery] = useState(() => loadRecovery());
  const [dismissed, setDismissed] = useState(false);
  const setDocument = useDocumentStore((s) => s.setDocument);

  if (!recovery || dismissed) return null;

  const when = new Date(recovery.ts).toLocaleString();

  const restore = () => {
    try {
      setDocument(parseSVG(recovery.svg), recovery.filePath ?? undefined);
    } catch {
      /* corrupt snapshot — just drop it */
    }
    clearRecovery();
    setDismissed(true);
  };
  const discard = () => {
    clearRecovery();
    setDismissed(true);
  };

  return (
    <div className="flex items-center gap-3 px-4 py-1.5 text-[11px] bg-accent/10 border-b border-accent/20 text-text-secondary">
      <span className="flex-1">
        Unsaved work from <span className="text-text-primary">{when}</span> was recovered.
      </span>
      <button onClick={restore} className="text-accent hover:text-accent-hover underline">
        Restore
      </button>
      <button onClick={discard} className="opacity-60 hover:opacity-100 underline">
        Discard
      </button>
    </div>
  );
}
