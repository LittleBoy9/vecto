import { useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { hexToHsv, hsvToHex, addRecentColor, getRecentColors } from "../../lib/color";
import { colorToHex } from "../../lib/utils";

/** Read the fill (or stroke) of the top-most SVG element under a screen point. */
function sampleColorAt(clientX: number, clientY: number): string | null {
  for (const el of document.elementsFromPoint(clientX, clientY)) {
    if (!(el instanceof SVGElement)) continue;
    const style = getComputedStyle(el);
    for (const raw of [style.fill, style.stroke]) {
      const hex = colorToHex(raw);
      if (hex && hex.startsWith("#")) return hex.toLowerCase();
    }
  }
  return null;
}

interface ColorPopoverProps {
  /** Current color as #rrggbb. */
  value: string;
  /** The swatch element to anchor against. */
  anchor: HTMLElement | null;
  onChange: (hex: string) => void;
  onClose: () => void;
}

const SV_W = 200;
const SV_H = 130;

export function ColorPopover({ value, anchor, onChange, onClose }: ColorPopoverProps) {
  const [hsv, setHsv] = useState(() => hexToHsv(value) ?? { h: 210, s: 0.7, v: 0.9 });
  const [hexText, setHexText] = useState(value);
  const [sampling, setSampling] = useState(false);
  const [preview, setPreview] = useState<{ x: number; y: number; color: string } | null>(null);
  const svRef = useRef<HTMLDivElement>(null);
  const hueRef = useRef<HTMLDivElement>(null);

  // Position fixed near the swatch, clamped to the viewport.
  const rect = anchor?.getBoundingClientRect();
  const top = rect ? Math.min(rect.bottom + 6, window.innerHeight - 230) : 80;
  const left = rect ? Math.max(8, Math.min(rect.right - SV_W - 16, window.innerWidth - SV_W - 24)) : 80;

  // Commit the latest hex to "recent" when the popover closes.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => { if (e.key === "Escape") onClose(); };
    window.addEventListener("keydown", onKey);
    return () => {
      window.removeEventListener("keydown", onKey);
      addRecentColor(hsvToHex(hsv.h, hsv.s, hsv.v));
    };
  }, [hsv, onClose]);

  const emit = (next: { h: number; s: number; v: number }) => {
    setHsv(next);
    const hex = hsvToHex(next.h, next.s, next.v);
    setHexText(hex);
    onChange(hex);
  };

  const fromSvPointer = (e: React.PointerEvent) => {
    const el = svRef.current;
    if (!el) return;
    const r = el.getBoundingClientRect();
    const s = Math.min(1, Math.max(0, (e.clientX - r.left) / r.width));
    const v = Math.min(1, Math.max(0, 1 - (e.clientY - r.top) / r.height));
    emit({ ...hsv, s, v });
  };

  const fromHuePointer = (e: React.PointerEvent) => {
    const el = hueRef.current;
    if (!el) return;
    const r = el.getBoundingClientRect();
    const h = Math.min(360, Math.max(0, ((e.clientX - r.left) / r.width) * 360));
    emit({ ...hsv, h });
  };

  const applyHexText = (raw: string) => {
    const parsed = hexToHsv(raw);
    if (parsed) {
      setHsv(parsed);
      const hex = hsvToHex(parsed.h, parsed.s, parsed.v);
      onChange(hex);
    }
  };

  const setHex = (hex: string) => { setHexText(hex); applyHexText(hex); };

  // Eyedropper: native API where supported (WebView2/Chromium), else in-app sampler.
  const startEyedropper = async () => {
    const anyWin = window as unknown as { EyeDropper?: new () => { open: () => Promise<{ sRGBHex: string }> } };
    if (anyWin.EyeDropper) {
      try {
        const res = await new anyWin.EyeDropper().open();
        if (res?.sRGBHex) setHex(res.sRGBHex);
      } catch { /* user cancelled */ }
      return;
    }
    setSampling(true);
  };

  // While sampling, Escape cancels (capture phase pre-empts the popover's Escape).
  useEffect(() => {
    if (!sampling) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") { e.stopPropagation(); setSampling(false); setPreview(null); }
    };
    window.addEventListener("keydown", onKey, true);
    return () => window.removeEventListener("keydown", onKey, true);
  }, [sampling]);

  const swatchHex = hsvToHex(hsv.h, hsv.s, hsv.v);
  const recents = getRecentColors();

  return createPortal(
    <>
      {/* click-away backdrop */}
      <div className="fixed inset-0 z-[60]" onPointerDown={onClose} />

      <div
        className="fixed z-[61] w-[216px] bg-panel border border-border rounded-lg shadow-2xl p-2 select-none"
        style={{ top, left }}
        onPointerDown={(e) => e.stopPropagation()}
      >
        {/* Saturation / value field */}
        <div
          ref={svRef}
          className="relative rounded-md overflow-hidden cursor-crosshair"
          style={{
            width: SV_W,
            height: SV_H,
            background: `
              linear-gradient(to top, #000, rgba(0,0,0,0)),
              linear-gradient(to right, #fff, rgba(255,255,255,0)),
              hsl(${hsv.h}, 100%, 50%)`,
          }}
          onPointerDown={(e) => { (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId); fromSvPointer(e); }}
          onPointerMove={(e) => { if (e.buttons === 1) fromSvPointer(e); }}
        >
          <div
            className="absolute w-3 h-3 rounded-full border-2 border-white shadow -translate-x-1/2 -translate-y-1/2 pointer-events-none"
            style={{ left: `${hsv.s * 100}%`, top: `${(1 - hsv.v) * 100}%` }}
          />
        </div>

        {/* Hue slider */}
        <div
          ref={hueRef}
          className="relative h-3 rounded-full mt-2 cursor-pointer"
          style={{
            background:
              "linear-gradient(to right, #f00 0%, #ff0 17%, #0f0 33%, #0ff 50%, #00f 67%, #f0f 83%, #f00 100%)",
          }}
          onPointerDown={(e) => { (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId); fromHuePointer(e); }}
          onPointerMove={(e) => { if (e.buttons === 1) fromHuePointer(e); }}
        >
          <div
            className="absolute top-1/2 w-3.5 h-3.5 rounded-full border-2 border-white shadow -translate-x-1/2 -translate-y-1/2 pointer-events-none"
            style={{ left: `${(hsv.h / 360) * 100}%` }}
          />
        </div>

        {/* Hex input + preview + eyedropper */}
        <div className="flex items-center gap-2 mt-2">
          <div className="w-6 h-6 rounded border border-border flex-shrink-0" style={{ background: swatchHex }} />
          <input
            value={hexText}
            onChange={(e) => { setHexText(e.target.value); applyHexText(e.target.value); }}
            spellCheck={false}
            className="flex-1 min-w-0 bg-surface border border-border rounded px-2 py-1 text-[11px] text-text-primary focus:outline-none focus:border-accent font-mono"
          />
          <button
            type="button"
            onClick={startEyedropper}
            title="Sample a color from the canvas"
            className="flex-shrink-0 w-6 h-6 flex items-center justify-center rounded border border-border text-text-secondary hover:text-text-primary hover:bg-surface-hover transition-colors"
          >
            <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <path d="m2 22 1-1h3l9-9" />
              <path d="M3 21v-3l9-9" />
              <path d="m15 6 3.4-3.4a2.1 2.1 0 1 1 3 3L18 9l.4.4a2.1 2.1 0 1 1-3 3l-3.8-3.8a2.1 2.1 0 1 1 3-3l.4.4Z" />
            </svg>
          </button>
        </div>

        {/* Recent colors */}
        {recents.length > 0 && (
          <div className="flex flex-wrap gap-1 mt-2">
            {recents.map((c) => (
              <button
                key={c}
                title={c}
                onClick={() => setHex(c)}
                className="w-5 h-5 rounded border border-border hover:scale-110 transition-transform"
                style={{ background: c }}
              />
            ))}
          </div>
        )}
      </div>

      {/* Eyedropper sampling overlay (in-app fallback) */}
      {sampling && (
        <div
          className="fixed inset-0 z-[70]"
          style={{ cursor: "crosshair" }}
          onPointerMove={(e) => {
            const c = sampleColorAt(e.clientX, e.clientY);
            setPreview({ x: e.clientX, y: e.clientY, color: c ?? "" });
          }}
          onPointerDown={(e) => {
            e.stopPropagation();
            const c = sampleColorAt(e.clientX, e.clientY);
            if (c) setHex(c);
            setSampling(false);
            setPreview(null);
          }}
        >
          {preview?.color && (
            <div
              className="fixed w-7 h-7 rounded-full border-2 border-white shadow-lg pointer-events-none"
              style={{ left: preview.x + 16, top: preview.y + 16, background: preview.color }}
            />
          )}
        </div>
      )}
    </>,
    document.body
  );
}
