import { useEffect, useState } from "react";
import { createPortal } from "react-dom";
import { invoke } from "@tauri-apps/api/core";
import { save } from "@tauri-apps/plugin-dialog";
import { useDocumentStore } from "../../store/documentStore";
import { useSelectionStore } from "../../store/selectionStore";
import { serializeDocument, serializeFragment } from "../../lib/svgSerializer";
import { findNode } from "../../lib/nodeUtils";
import { unionDocBBox } from "../../lib/bbox";
import { cn } from "../../lib/utils";
import type { VectoNode } from "../../types/svg";

const SCALES = [1, 2, 3];

export function ExportMenu({ anchor, onClose }: { anchor: HTMLElement | null; onClose: () => void }) {
  const doc = useDocumentStore((s) => s.document);
  const selectedIds = useSelectionStore((s) => s.selectedIds);
  const [format, setFormat] = useState<"png" | "jpg" | "pdf">("png");
  const [scale, setScale] = useState(2);
  const [selOnly, setSelOnly] = useState(false);
  const [busy, setBusy] = useState(false);
  const hasSel = selectedIds.length > 0;

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => { if (e.key === "Escape") onClose(); };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  const rect = anchor?.getBoundingClientRect();
  const top = rect ? rect.bottom + 6 : 80;
  const left = rect ? Math.max(8, rect.right - 220) : 80;

  const doExport = async () => {
    if (!doc || busy) return;
    let svg: string;
    if (selOnly && hasSel) {
      const nodes = selectedIds.map((id) => findNode(doc.nodes, id)).filter(Boolean) as VectoNode[];
      svg = serializeFragment(nodes, unionDocBBox(selectedIds) ?? doc.viewBox, {
        gradients: doc.gradients, filters: doc.filters,
      });
    } else {
      svg = serializeDocument(doc);
    }
    const ext = format === "jpg" ? "jpg" : format; // png | jpg | pdf
    const path = await save({
      filters: [{ name: format.toUpperCase(), extensions: [ext] }],
      defaultPath: `untitled.${ext}`,
    });
    if (!path) return;
    setBusy(true);
    try {
      if (format === "pdf") {
        await invoke("export_pdf", { svgContent: svg, path });
      } else {
        await invoke("export_image", {
          svgContent: svg, path, scale, format: format === "jpg" ? "jpeg" : "png",
        });
      }
      onClose();
    } catch (err) {
      console.error("Export failed:", err);
    } finally {
      setBusy(false);
    }
  };

  const Seg = ({ active, onClick, children }: { active: boolean; onClick: () => void; children: React.ReactNode }) => (
    <button
      onClick={onClick}
      className={cn(
        "flex-1 h-7 rounded text-[11px] border transition-colors",
        active ? "bg-accent/15 border-accent text-accent" : "bg-surface border-border text-text-secondary hover:text-text-primary"
      )}
    >
      {children}
    </button>
  );

  return createPortal(
    <>
      <div className="fixed inset-0 z-[80]" onPointerDown={onClose} />
      <div
        className="fixed z-[81] w-[216px] bg-panel border border-border rounded-lg shadow-2xl p-3 space-y-2.5"
        style={{ top, left }}
        onPointerDown={(e) => e.stopPropagation()}
      >
        <div>
          <p className="text-[10px] text-text-muted uppercase tracking-wide mb-1">Format</p>
          <div className="flex gap-1">
            <Seg active={format === "png"} onClick={() => setFormat("png")}>PNG</Seg>
            <Seg active={format === "jpg"} onClick={() => setFormat("jpg")}>JPG</Seg>
            <Seg active={format === "pdf"} onClick={() => setFormat("pdf")}>PDF</Seg>
          </div>
        </div>
        {format !== "pdf" && (
          <div>
            <p className="text-[10px] text-text-muted uppercase tracking-wide mb-1">Scale</p>
            <div className="flex gap-1">
              {SCALES.map((s) => (
                <Seg key={s} active={scale === s} onClick={() => setScale(s)}>{s}×</Seg>
              ))}
            </div>
          </div>
        )}
        {hasSel && (
          <label className="flex items-center gap-2 text-[11px] text-text-secondary cursor-pointer">
            <input type="checkbox" checked={selOnly} onChange={(e) => setSelOnly(e.target.checked)} />
            Selection only ({selectedIds.length})
          </label>
        )}
        <button
          onClick={doExport}
          disabled={busy}
          className="w-full h-8 rounded text-[12px] font-medium bg-accent text-white hover:bg-accent-hover disabled:opacity-50 transition-colors"
        >
          {busy ? "Exporting…" : "Export"}
        </button>
      </div>
    </>,
    document.body
  );
}
