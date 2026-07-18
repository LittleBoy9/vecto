import { forwardRef, useEffect, useImperativeHandle, useRef } from "react";
import { useUIStore } from "../../store/uiStore";

export const RULER = 20;

export interface RulersHandle {
  draw: (zoom: number, panX: number, panY: number) => void;
}

interface RulersProps {
  screenToDoc: (sx: number, sy: number) => { x: number; y: number };
}

function niceStep(raw: number): number {
  const pow = Math.pow(10, Math.floor(Math.log10(raw)));
  const f = raw / pow;
  return (f >= 5 ? 5 : f >= 2 ? 2 : 1) * pow;
}

function cssVar(name: string): string {
  const v = getComputedStyle(document.documentElement).getPropertyValue(name).trim();
  return v.includes(" ") ? `rgb(${v.split(/\s+/).join(", ")})` : v || "#888";
}

export const Rulers = forwardRef<RulersHandle, RulersProps>(function Rulers({ screenToDoc }, ref) {
  const topRef = useRef<HTMLCanvasElement>(null);
  const leftRef = useRef<HTMLCanvasElement>(null);
  const last = useRef({ zoom: 1, panX: 0, panY: 0 });
  const addGuide = useUIStore((s) => s.addGuide);
  const updateGuide = useUIStore((s) => s.updateGuide);
  const removeGuide = useUIStore((s) => s.removeGuide);

  const drawOne = (canvas: HTMLCanvasElement | null, horizontal: boolean, zoom: number, pan: number) => {
    if (!canvas) return;
    const dpr = window.devicePixelRatio || 1;
    const cssW = canvas.clientWidth || 1;
    const cssH = canvas.clientHeight || 1;
    canvas.width = cssW * dpr;
    canvas.height = cssH * dpr;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;
    ctx.scale(dpr, dpr);

    const length = horizontal ? cssW : cssH;
    ctx.fillStyle = cssVar("--color-panel");
    ctx.fillRect(0, 0, cssW, cssH);

    const tickColor = cssVar("--color-text-muted");
    const textColor = cssVar("--color-text-secondary");
    ctx.strokeStyle = tickColor;
    ctx.fillStyle = textColor;
    ctx.lineWidth = 1;
    ctx.font = "9px -apple-system, sans-serif";

    const stepDoc = niceStep(70 / zoom);
    const firstDoc = Math.floor((-pan / zoom) / stepDoc) * stepDoc;

    ctx.beginPath();
    for (let d = firstDoc; d * zoom + pan < length; d += stepDoc) {
      const s = Math.round(d * zoom + pan) + 0.5;
      if (s < 0) continue;
      if (horizontal) {
        ctx.moveTo(s, RULER); ctx.lineTo(s, RULER - 6);
        ctx.fillText(String(Math.round(d)), s + 2, 9);
      } else {
        ctx.moveTo(RULER, s); ctx.lineTo(RULER - 6, s);
        ctx.save();
        ctx.translate(8, s - 2);
        ctx.rotate(-Math.PI / 2);
        ctx.fillText(String(Math.round(d)), 0, 0);
        ctx.restore();
      }
    }
    ctx.stroke();
  };

  const draw = (zoom: number, panX: number, panY: number) => {
    last.current = { zoom, panX, panY };
    drawOne(topRef.current, true, zoom, panX);
    drawOne(leftRef.current, false, zoom, panY);
  };
  useImperativeHandle(ref, () => ({ draw }));

  // Redraw on container resize.
  useEffect(() => {
    const ro = new ResizeObserver(() => {
      const { zoom, panX, panY } = last.current;
      draw(zoom, panX, panY);
    });
    if (topRef.current) ro.observe(topRef.current);
    if (leftRef.current) ro.observe(leftRef.current);
    return () => ro.disconnect();
  }, []);

  // Drag a guide out of a ruler. The guide is only created once the pointer
  // moves past a small threshold (so a stray click doesn't litter a guide), and
  // is cancelled if dropped back onto the originating ruler strip.
  const startGuide = (axis: "x" | "y") => (e: React.PointerEvent<HTMLCanvasElement>) => {
    e.preventDefault();
    const el = e.currentTarget as HTMLElement;
    el.setPointerCapture(e.pointerId);
    const strip = el.getBoundingClientRect();
    const start = { x: e.clientX, y: e.clientY };
    let id: string | null = null;

    const onMove = (ev: PointerEvent) => {
      if (id === null) {
        if (Math.hypot(ev.clientX - start.x, ev.clientY - start.y) < 3) return;
        const p = screenToDoc(ev.clientX, ev.clientY);
        id = addGuide(axis, axis === "x" ? p.x : p.y);
      }
      const q = screenToDoc(ev.clientX, ev.clientY);
      updateGuide(id, axis === "x" ? q.x : q.y);
    };
    const onUp = (ev: PointerEvent) => {
      window.removeEventListener("pointermove", onMove);
      window.removeEventListener("pointerup", onUp);
      if (id === null) return; // never dragged — was just a click
      const backOnRuler = axis === "y" ? ev.clientY <= strip.bottom : ev.clientX <= strip.right;
      if (backOnRuler) removeGuide(id);
    };
    window.addEventListener("pointermove", onMove);
    window.addEventListener("pointerup", onUp);
  };

  return (
    <>
      <canvas
        ref={topRef}
        className="absolute top-0 left-0 right-0 z-20 border-b border-border"
        style={{ height: RULER, width: "100%", cursor: "ns-resize" }}
        onPointerDown={startGuide("y")}
      />
      <canvas
        ref={leftRef}
        className="absolute top-0 left-0 bottom-0 z-20 border-r border-border"
        style={{ width: RULER, height: "100%", cursor: "ew-resize" }}
        onPointerDown={startGuide("x")}
      />
      <div
        className="absolute top-0 left-0 z-30 bg-panel border-r border-b border-border"
        style={{ width: RULER, height: RULER }}
      />
    </>
  );
});
