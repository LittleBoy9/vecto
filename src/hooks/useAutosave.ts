import { useEffect } from "react";
import { useDocumentStore } from "../store/documentStore";
import { serializeDocument } from "../lib/svgSerializer";
import { saveRecovery, clearRecovery } from "../lib/recovery";

/**
 * Periodically snapshot the working document to localStorage while it has
 * unsaved changes, so a crash/quit can be recovered on next launch. Clears the
 * snapshot once the document is clean (saved). Mount once in App.
 */
export function useAutosave() {
  useEffect(() => {
    const id = setInterval(() => {
      const { document, isDirty, filePath } = useDocumentStore.getState();
      if (document && isDirty) {
        saveRecovery(serializeDocument(document), filePath);
      } else if (document && !isDirty) {
        clearRecovery();
      }
      // No document → leave any existing snapshot intact for recovery.
    }, 4000);
    return () => clearInterval(id);
  }, []);
}
