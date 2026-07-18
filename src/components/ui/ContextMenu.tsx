import { useEffect } from "react";
import { createPortal } from "react-dom";
import { useContextMenuStore } from "../../store/contextMenuStore";
import { cn } from "../../lib/utils";

const MENU_W = 200;
const ROW_H = 30;

/** Single global context menu, mounted once in App. */
export function ContextMenu() {
  const { open, x, y, items, closeMenu } = useContextMenuStore();

  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => { if (e.key === "Escape") closeMenu(); };
    window.addEventListener("keydown", onKey);
    window.addEventListener("resize", closeMenu);
    return () => {
      window.removeEventListener("keydown", onKey);
      window.removeEventListener("resize", closeMenu);
    };
  }, [open, closeMenu]);

  if (!open) return null;

  const left = Math.min(x, window.innerWidth - MENU_W - 8);
  const top = Math.min(y, window.innerHeight - (items.length * ROW_H + 16));

  return createPortal(
    <>
      <div
        className="fixed inset-0 z-[80]"
        onPointerDown={closeMenu}
        onContextMenu={(e) => { e.preventDefault(); closeMenu(); }}
      />
      <div
        className="fixed z-[81] min-w-[180px] bg-panel border border-border rounded-lg shadow-2xl py-1"
        style={{ left, top }}
        onContextMenu={(e) => e.preventDefault()}
      >
        {items.map((it, i) =>
          it.separator ? (
            <div key={i} className="my-1 h-px bg-border" />
          ) : (
            <button
              key={i}
              disabled={it.disabled}
              onClick={() => { it.onClick?.(); closeMenu(); }}
              className={cn(
                "w-full flex items-center justify-between gap-6 px-3 py-1.5 text-[12px] text-left transition-colors",
                it.disabled
                  ? "text-text-muted cursor-not-allowed"
                  : it.danger
                  ? "text-danger hover:bg-danger/10"
                  : "text-text-secondary hover:text-text-primary hover:bg-surface"
              )}
            >
              <span>{it.label}</span>
              {it.shortcut && <span className="text-[10px] text-text-muted">{it.shortcut}</span>}
            </button>
          )
        )}
      </div>
    </>,
    document.body
  );
}
