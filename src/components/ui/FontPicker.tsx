import { useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { cn } from "../../lib/utils";

export const FONT_FAMILIES: { label: string; value: string }[] = [
  { label: "Sans Serif", value: "sans-serif" },
  { label: "Serif", value: "serif" },
  { label: "Monospace", value: "monospace" },
  { label: "Arial", value: "Arial, sans-serif" },
  { label: "Helvetica", value: "Helvetica, Arial, sans-serif" },
  { label: "Verdana", value: "Verdana, sans-serif" },
  { label: "Tahoma", value: "Tahoma, sans-serif" },
  { label: "Trebuchet MS", value: "'Trebuchet MS', sans-serif" },
  { label: "Gill Sans", value: "'Gill Sans', sans-serif" },
  { label: "Georgia", value: "Georgia, serif" },
  { label: "Times New Roman", value: "'Times New Roman', Times, serif" },
  { label: "Palatino", value: "'Palatino Linotype', Palatino, serif" },
  { label: "Courier New", value: "'Courier New', Courier, monospace" },
  { label: "Impact", value: "Impact, Charcoal, sans-serif" },
  { label: "Comic Sans MS", value: "'Comic Sans MS', cursive" },
  { label: "Brush Script", value: "'Brush Script MT', cursive" },
];

/** Font-family dropdown where every option is previewed in its own font. */
export function FontPicker({ value, onChange }: { value: string; onChange: (v: string) => void }) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLButtonElement>(null);
  const current = FONT_FAMILIES.find((f) => f.value === value);

  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => { if (e.key === "Escape") setOpen(false); };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open]);

  const rect = ref.current?.getBoundingClientRect();

  return (
    <>
      <button
        ref={ref}
        onClick={() => setOpen((o) => !o)}
        className="flex-1 min-w-0 flex items-center justify-between gap-1 bg-surface border border-border rounded px-2 py-0.5 text-[11px] text-text-primary focus:outline-none focus:border-accent"
      >
        <span className="truncate" style={{ fontFamily: value || "inherit" }}>
          {current?.label ?? value ?? "Default"}
        </span>
        <span className="text-text-muted text-[9px] flex-shrink-0">▾</span>
      </button>
      {open && rect && createPortal(
        <>
          <div className="fixed inset-0 z-[60]" onPointerDown={() => setOpen(false)} />
          <div
            className="fixed z-[61] bg-panel border border-border rounded-lg shadow-2xl py-1 max-h-72 overflow-y-auto scrollbar-thin"
            style={{
              top: Math.min(rect.bottom + 4, window.innerHeight - 300),
              left: Math.max(8, rect.left),
              width: Math.max(rect.width, 160),
            }}
          >
            {FONT_FAMILIES.map((f) => (
              <button
                key={f.value}
                onClick={() => { onChange(f.value); setOpen(false); }}
                style={{ fontFamily: f.value }}
                className={cn(
                  "w-full text-left px-3 py-1.5 text-[13px] truncate transition-colors",
                  value === f.value
                    ? "bg-accent/15 text-accent"
                    : "text-text-primary hover:bg-surface"
                )}
              >
                {f.label}
              </button>
            ))}
          </div>
        </>,
        document.body
      )}
    </>
  );
}
