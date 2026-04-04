import { useCallback, useRef, useState } from "react";
import { useDocumentStore } from "../../store/documentStore";
import { LayerNode } from "./LayerNode";

const MIN_WIDTH = 140;
const MAX_WIDTH = 400;
const DEFAULT_WIDTH = 208; // 52 * 4

export function LayerPanel() {
  const document = useDocumentStore((s) => s.document);
  const [width, setWidth] = useState(DEFAULT_WIDTH);

  // ── Resize handle (right edge) ───────────────────────────────────────────────
  const startRef = useRef({ x: 0, width: 0 });

  const handleResizeDown = useCallback((e: React.MouseEvent) => {
    e.preventDefault();
    startRef.current = { x: e.clientX, width };

    const onMove = (ev: MouseEvent) => {
      const next = Math.min(
        MAX_WIDTH,
        Math.max(MIN_WIDTH, startRef.current.width + (ev.clientX - startRef.current.x))
      );
      setWidth(next);
    };
    const onUp = () => {
      window.removeEventListener("mousemove", onMove);
      window.removeEventListener("mouseup", onUp);
    };
    window.addEventListener("mousemove", onMove);
    window.addEventListener("mouseup", onUp);
  }, [width]);

  return (
    <aside
      className="relative flex-shrink-0 flex flex-col bg-panel border-r border-border overflow-hidden"
      style={{ width }}
    >
      {/* Panel header */}
      <div className="flex items-center px-3 h-8 border-b border-border flex-shrink-0">
        <span className="text-[11px] font-medium text-text-secondary uppercase tracking-wider">
          Layers
        </span>
      </div>

      {/* Layer tree */}
      <div className="flex-1 overflow-y-auto overflow-x-hidden py-1 scrollbar-thin">
        {!document ? (
          <p className="text-text-muted text-[11px] px-3 py-4 text-center">
            No document open
          </p>
        ) : document.nodes.length === 0 ? (
          <p className="text-text-muted text-[11px] px-3 py-4 text-center">
            Document is empty
          </p>
        ) : (
          document.nodes.map((node) => (
            <LayerNode key={node.id} node={node} depth={0} />
          ))
        )}
      </div>

      {/* Resize handle — right edge */}
      <div
        onMouseDown={handleResizeDown}
        className="absolute top-0 right-0 w-[3px] h-full cursor-col-resize group z-10"
      >
        <div className="w-full h-full group-hover:bg-accent/40 transition-colors" />
      </div>
    </aside>
  );
}
