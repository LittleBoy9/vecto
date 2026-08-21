import { useEffect } from "react";
import { invoke } from "@tauri-apps/api/core";
import { getCurrentWebview } from "@tauri-apps/api/webview";
import { parseSVG } from "../lib/svgParser";
import { useDocumentStore } from "../store/documentStore";
import { useSelectionStore } from "../store/selectionStore";
import { useUIStore } from "../store/uiStore";

/**
 * Drop an .svg (opened) or a raster image (traced to vectors) onto the window.
 * Mount once in App.
 */
export function useFileDrop() {
  useEffect(() => {
    let unlisten: (() => void) | undefined;
    // If cleanup runs before onDragDropEvent resolves, `unlisten` is still
    // undefined and the listener would leak — React StrictMode's double-mount
    // hits this on every dev boot. Detach as soon as the handle arrives.
    let cancelled = false;

    getCurrentWebview()
      .onDragDropEvent(async (event) => {
        if (event.payload.type !== "drop") return;
        const path = event.payload.paths?.[0];
        if (!path) return;
        const lower = path.toLowerCase();

        const ui = useUIStore.getState();
        ui.setFileLoading(true);
        useSelectionStore.getState().clearSelection();
        try {
          if (lower.endsWith(".svg")) {
            const content = await invoke<string>("open_svg_file", { path });
            useDocumentStore.getState().setDocument(parseSVG(content), path);
          } else if (/\.(png|jpe?g|webp|gif|bmp)$/.test(lower)) {
            const svg = await invoke<string>("trace_image", { inputPath: path });
            useDocumentStore.getState().setDocument(parseSVG(svg));
          }
        } catch (e) {
          console.error("Drop open failed:", e);
        } finally {
          ui.setFileLoading(false);
        }
      })
      .then((u) => {
        if (cancelled) u();
        else unlisten = u;
      });

    return () => {
      cancelled = true;
      if (unlisten) unlisten();
    };
  }, []);
}
