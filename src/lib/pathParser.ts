/**
 * SVG path parser and serializer for the path node editor.
 *
 * Parses the `d` attribute of <path> elements into PathContour[] (one per
 * subpath), each containing AnchorNode[] with bezier handles.
 *
 * Supports: M L H V C S Q T A Z (upper = absolute, lower = relative).
 * Arc (A) endpoints are preserved as line-style anchors — editing them as
 * bezier handles would require arc→bezier conversion, which is out of scope.
 *
 * All coordinates are normalized to absolute on parse. The serializer always
 * emits absolute M / L / C / Z — canonical and unambiguous.
 */

export interface AnchorNode {
  /** Deterministic ID: "c{contourIdx}_n{nodeIdx}" */
  id: string;
  x: number;
  y: number;
  /**
   * Incoming bezier control point (second control point of the segment
   * arriving at this anchor, in absolute SVG doc coordinates).
   * Null for line-to segments or path start points.
   */
  handleIn: { x: number; y: number } | null;
  /**
   * Outgoing bezier control point (first control point of the segment
   * leaving this anchor, in absolute SVG doc coordinates).
   * Null for line-to segments or path end points.
   */
  handleOut: { x: number; y: number } | null;
  /**
   * smooth: opposite handles stay mirrored through the anchor (collinear +
   *         equidistant) — moving one mirrors the other.
   * corner: handles are fully independent.
   */
  type: "smooth" | "corner";
}

export interface PathContour {
  nodes: AnchorNode[];
  closed: boolean;
}

// ── Tokenizer ─────────────────────────────────────────────────────────────────

type Token = string | number;

function tokenize(d: string): Token[] {
  const tokens: Token[] = [];
  // Match command letters OR numbers (negative, decimal, scientific notation).
  // The [+-] inside the number group is handled carefully: it can start a new
  // number after a digit or decimal point (e.g. "3.14e+2-1.5").
  const re =
    /([MmZzLlHhVvCcSsQqTtAa])|([+-]?(?:\d+\.?\d*|\.\d+)(?:[eE][+-]?\d+)?)/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(d)) !== null) {
    if (m[1]) tokens.push(m[1]);
    else tokens.push(parseFloat(m[2]));
  }
  return tokens;
}

// ── Absolute commands ─────────────────────────────────────────────────────────

type AbsCmd =
  | { type: "M"; x: number; y: number }
  | { type: "L"; x: number; y: number }
  | { type: "C"; x1: number; y1: number; x2: number; y2: number; x: number; y: number }
  | { type: "A"; x: number; y: number } // we only need the endpoint for editing
  | { type: "Z" };

function toAbsoluteCmds(d: string): AbsCmd[] {
  const tokens = tokenize(d);
  const cmds: AbsCmd[] = [];

  let i = 0;
  let cx = 0, cy = 0;
  let subpathX = 0, subpathY = 0;
  let cmdLetter = "";

  // For S reflection (second control point of previous C/S)
  let prevCPForS: { x: number; y: number } | null = null;
  // For T reflection (control point of previous Q/T)
  let prevCPForT: { x: number; y: number } | null = null;

  function num(): number {
    return typeof tokens[i] === "number" ? (tokens[i++] as number) : 0;
  }

  while (i < tokens.length) {
    // Advance command letter if the current token is a letter
    if (typeof tokens[i] === "string") {
      cmdLetter = tokens[i++] as string;
    }

    if (!cmdLetter) break;

    const rel = cmdLetter === cmdLetter.toLowerCase() && cmdLetter !== "z" && cmdLetter !== "Z";
    const upper = cmdLetter.toUpperCase();

    switch (upper) {
      case "M": {
        const x = rel ? cx + num() : num();
        const y = rel ? cy + num() : num();
        cx = x; cy = y;
        subpathX = x; subpathY = y;
        cmds.push({ type: "M", x, y });
        // Subsequent coordinate pairs after M are implicit L
        cmdLetter = rel ? "l" : "L";
        prevCPForS = null; prevCPForT = null;
        break;
      }
      case "L": {
        const x = rel ? cx + num() : num();
        const y = rel ? cy + num() : num();
        cmds.push({ type: "L", x, y });
        cx = x; cy = y;
        prevCPForS = null; prevCPForT = null;
        break;
      }
      case "H": {
        const x = rel ? cx + num() : num();
        cmds.push({ type: "L", x, y: cy });
        cx = x;
        prevCPForS = null; prevCPForT = null;
        break;
      }
      case "V": {
        const y = rel ? cy + num() : num();
        cmds.push({ type: "L", x: cx, y });
        cy = y;
        prevCPForS = null; prevCPForT = null;
        break;
      }
      case "C": {
        const x1 = rel ? cx + num() : num();
        const y1 = rel ? cy + num() : num();
        const x2 = rel ? cx + num() : num();
        const y2 = rel ? cy + num() : num();
        const x  = rel ? cx + num() : num();
        const y  = rel ? cy + num() : num();
        cmds.push({ type: "C", x1, y1, x2, y2, x, y });
        prevCPForS = { x: x2, y: y2 };
        prevCPForT = null;
        cx = x; cy = y;
        break;
      }
      case "S": {
        // Reflect previous C/S second control point through current point
        const rx = prevCPForS ? 2 * cx - prevCPForS.x : cx;
        const ry = prevCPForS ? 2 * cy - prevCPForS.y : cy;
        const x2 = rel ? cx + num() : num();
        const y2 = rel ? cy + num() : num();
        const x  = rel ? cx + num() : num();
        const y  = rel ? cy + num() : num();
        cmds.push({ type: "C", x1: rx, y1: ry, x2, y2, x, y });
        prevCPForS = { x: x2, y: y2 };
        prevCPForT = null;
        cx = x; cy = y;
        break;
      }
      case "Q": {
        const qx1 = rel ? cx + num() : num();
        const qy1 = rel ? cy + num() : num();
        const qx  = rel ? cx + num() : num();
        const qy  = rel ? cy + num() : num();
        // Upgrade quadratic to cubic bezier:
        // cp1 = start + 2/3 * (q - start)
        // cp2 = end   + 2/3 * (q - end)
        cmds.push({
          type: "C",
          x1: cx + (2 / 3) * (qx1 - cx),
          y1: cy + (2 / 3) * (qy1 - cy),
          x2: qx + (2 / 3) * (qx1 - qx),
          y2: qy + (2 / 3) * (qy1 - qy),
          x: qx,
          y: qy,
        });
        prevCPForS = null;
        prevCPForT = { x: qx1, y: qy1 };
        cx = qx; cy = qy;
        break;
      }
      case "T": {
        // Reflect previous Q/T control point through current point
        const qx1: number = prevCPForT ? 2 * cx - prevCPForT.x : cx;
        const qy1: number = prevCPForT ? 2 * cy - prevCPForT.y : cy;
        const qx  = rel ? cx + num() : num();
        const qy  = rel ? cy + num() : num();
        cmds.push({
          type: "C",
          x1: cx + (2 / 3) * (qx1 - cx),
          y1: cy + (2 / 3) * (qy1 - cy),
          x2: qx + (2 / 3) * (qx1 - qx),
          y2: qy + (2 / 3) * (qy1 - qy),
          x: qx,
          y: qy,
        });
        prevCPForS = null;
        prevCPForT = { x: qx1, y: qy1 };
        cx = qx; cy = qy;
        break;
      }
      case "A": {
        // Skip rx ry rotation large-arc-flag sweep-flag (5 values), keep endpoint
        num(); num(); num(); num(); num();
        const x = rel ? cx + num() : num();
        const y = rel ? cy + num() : num();
        // Treat arc endpoint as a line-style anchor (no bezier handles)
        cmds.push({ type: "A", x, y });
        prevCPForS = null; prevCPForT = null;
        cx = x; cy = y;
        break;
      }
      case "Z": {
        cmds.push({ type: "Z" });
        cx = subpathX; cy = subpathY;
        prevCPForS = null; prevCPForT = null;
        break;
      }
    }
  }

  return cmds;
}

// ── Commands → PathContour[] ──────────────────────────────────────────────────

function isSmoothNode(node: AnchorNode): boolean {
  if (!node.handleIn || !node.handleOut) return false;
  // Smooth: handleIn and handleOut are reflections of each other through anchor
  const mirrorX = 2 * node.x - node.handleIn.x;
  const mirrorY = 2 * node.y - node.handleIn.y;
  const dx = Math.abs(mirrorX - node.handleOut.x);
  const dy = Math.abs(mirrorY - node.handleOut.y);
  return dx < 0.01 && dy < 0.01;
}

export function parsePath(d: string): PathContour[] {
  const cmds = toAbsoluteCmds(d);
  const contours: PathContour[] = [];
  let currentNodes: AnchorNode[] = [];
  let contourIdx = 0;

  function pushContour(closed: boolean) {
    if (currentNodes.length > 0) {
      // Detect smooth nodes after all handles are set
      for (const n of currentNodes) {
        n.type = isSmoothNode(n) ? "smooth" : "corner";
      }
      contours.push({ nodes: currentNodes, closed });
      currentNodes = [];
      contourIdx++;
    }
  }

  for (const cmd of cmds) {
    switch (cmd.type) {
      case "M": {
        // Start a new subpath (push any in-progress contour first)
        if (currentNodes.length > 0) pushContour(false);
        const nodeIdx = currentNodes.length;
        currentNodes.push({
          id: `c${contourIdx}_n${nodeIdx}`,
          x: cmd.x, y: cmd.y,
          handleIn: null,
          handleOut: null,
          type: "corner",
        });
        break;
      }
      case "L":
      case "A": {
        // Line-to or arc-to: new anchor with no handles
        const prev = currentNodes[currentNodes.length - 1];
        if (!prev) break;
        const nodeIdx = currentNodes.length;
        currentNodes.push({
          id: `c${contourIdx}_n${nodeIdx}`,
          x: cmd.x, y: cmd.y,
          handleIn: null,
          handleOut: null,
          type: "corner",
        });
        break;
      }
      case "C": {
        // Cubic bezier:
        //   cmd.x1,y1 = outgoing handle of the PREVIOUS anchor
        //   cmd.x2,y2 = incoming handle of this NEW anchor
        const prev = currentNodes[currentNodes.length - 1];
        if (!prev) break;
        prev.handleOut = { x: cmd.x1, y: cmd.y1 };
        const nodeIdx = currentNodes.length;
        currentNodes.push({
          id: `c${contourIdx}_n${nodeIdx}`,
          x: cmd.x, y: cmd.y,
          handleIn: { x: cmd.x2, y: cmd.y2 },
          handleOut: null,
          type: "corner",
        });
        break;
      }
      case "Z": {
        pushContour(true);
        break;
      }
    }
  }

  // Push any remaining open contour
  pushContour(false);

  return contours;
}

// ── PathContour[] → d string ──────────────────────────────────────────────────

function fmt(n: number): string {
  // Round to 4 decimal places, strip trailing zeros
  return parseFloat(n.toFixed(4)).toString();
}

export function serializePath(contours: PathContour[]): string {
  const parts: string[] = [];

  for (const contour of contours) {
    const { nodes, closed } = contour;
    if (nodes.length === 0) continue;

    const first = nodes[0];
    parts.push(`M ${fmt(first.x)} ${fmt(first.y)}`);

    for (let ni = 1; ni < nodes.length; ni++) {
      const prev = nodes[ni - 1];
      const curr = nodes[ni];
      const ho = prev.handleOut;
      const hi = curr.handleIn;

      if (!ho && !hi) {
        // No handles on either side → straight line
        parts.push(`L ${fmt(curr.x)} ${fmt(curr.y)}`);
      } else {
        // Bezier curve — fall back to anchor point if handle is null (degenerate)
        const cp1x = ho ? ho.x : prev.x;
        const cp1y = ho ? ho.y : prev.y;
        const cp2x = hi ? hi.x : curr.x;
        const cp2y = hi ? hi.y : curr.y;
        parts.push(
          `C ${fmt(cp1x)} ${fmt(cp1y)} ${fmt(cp2x)} ${fmt(cp2y)} ${fmt(curr.x)} ${fmt(curr.y)}`
        );
      }
    }

    // Handle the closing segment (last node → first node)
    if (closed && nodes.length > 1) {
      const last  = nodes[nodes.length - 1];
      const first = nodes[0];
      const ho = last.handleOut;
      const hi = first.handleIn;

      if (ho || hi) {
        const cp1x = ho ? ho.x : last.x;
        const cp1y = ho ? ho.y : last.y;
        const cp2x = hi ? hi.x : first.x;
        const cp2y = hi ? hi.y : first.y;
        parts.push(
          `C ${fmt(cp1x)} ${fmt(cp1y)} ${fmt(cp2x)} ${fmt(cp2y)} ${fmt(first.x)} ${fmt(first.y)}`
        );
      }

      parts.push("Z");
    } else if (closed) {
      parts.push("Z");
    }
  }

  return parts.join(" ");
}

// ── Bezier math helpers (for node insert / delete) ────────────────────────────

type Pt = { x: number; y: number };

function lerp2(a: Pt, b: Pt, t: number): Pt {
  return { x: a.x + (b.x - a.x) * t, y: a.y + (b.y - a.y) * t };
}

/** Evaluate a cubic bezier at parameter t (De Casteljau). */
export function evalCubicBezier(t: number, p0: Pt, p1: Pt, p2: Pt, p3: Pt): Pt {
  const a = lerp2(p0, p1, t);
  const b = lerp2(p1, p2, t);
  const c = lerp2(p2, p3, t);
  return lerp2(lerp2(a, b, t), lerp2(b, c, t), t);
}

/**
 * Split a cubic bezier at t using De Casteljau.
 * Returns { left: [P0,P1,P2,P3], right: [P0,P1,P2,P3] }
 */
export function splitCubicBezier(t: number, p0: Pt, p1: Pt, p2: Pt, p3: Pt) {
  const m01  = lerp2(p0, p1, t);
  const m12  = lerp2(p1, p2, t);
  const m23  = lerp2(p2, p3, t);
  const m012 = lerp2(m01, m12, t);
  const m123 = lerp2(m12, m23, t);
  const mid  = lerp2(m012, m123, t);
  return {
    left:  [p0, m01, m012, mid]  as [Pt, Pt, Pt, Pt],
    right: [mid, m123, m23, p3] as [Pt, Pt, Pt, Pt],
  };
}

/**
 * Find the parameter t (0–1) on a cubic bezier closest to `click`.
 * Uses 64 uniform samples — accurate enough for interactive use.
 */
export function projectOnCubicBezier(click: Pt, p0: Pt, p1: Pt, p2: Pt, p3: Pt): number {
  let minD2 = Infinity;
  let bestT = 0.5;
  const N = 64;
  for (let i = 0; i <= N; i++) {
    const t = i / N;
    const pt = evalCubicBezier(t, p0, p1, p2, p3);
    const d2 = (pt.x - click.x) ** 2 + (pt.y - click.y) ** 2;
    if (d2 < minD2) { minD2 = d2; bestT = t; }
  }
  return bestT;
}

/** Deep-clone a PathContour array. */
export function cloneContours(contours: PathContour[]): PathContour[] {
  return contours.map((c) => ({
    closed: c.closed,
    nodes: c.nodes.map((n) => ({
      ...n,
      handleIn:  n.handleIn  ? { ...n.handleIn  } : null,
      handleOut: n.handleOut ? { ...n.handleOut } : null,
    })),
  }));
}

/**
 * Insert a new anchor node by splitting segment [segStart → segStart+1]
 * (or [last → 0] for the closing segment) at parameter t.
 */
export function insertNodeInContours(
  contours: PathContour[],
  ci: number,
  segStart: number,
  t: number
): PathContour[] {
  const result = cloneContours(contours);
  const contour = result[ci];
  const nodes   = contour.nodes;
  const n       = nodes.length;
  const segEnd  = (segStart + 1) % n;

  const p0 = { x: nodes[segStart].x, y: nodes[segStart].y };
  const p1 = nodes[segStart].handleOut ?? p0;
  const p2 = nodes[segEnd].handleIn    ?? { x: nodes[segEnd].x, y: nodes[segEnd].y };
  const p3 = { x: nodes[segEnd].x, y: nodes[segEnd].y };

  const { left, right } = splitCubicBezier(t, p0, p1, p2, p3);

  // Update handles on the bracketing nodes
  nodes[segStart].handleOut = left[1];
  nodes[segEnd].handleIn    = right[2];

  const newNode: AnchorNode = {
    id: "new",          // re-indexed below
    x: left[3].x,
    y: left[3].y,
    handleIn:  left[2],
    handleOut: right[1],
    type: "smooth",
  };

  if (segEnd === 0) {
    nodes.push(newNode); // closing segment — append before the wrap
  } else {
    nodes.splice(segEnd, 0, newNode);
  }

  // Re-index IDs
  for (let ni = 0; ni < nodes.length; ni++) {
    nodes[ni] = { ...nodes[ni], id: `c${ci}_n${ni}` };
  }

  return result;
}

/**
 * Remove anchor nodes by ID and reconnect the contour.
 * Adjacent handles are kept as-is to preserve the curve shape.
 * Contours reduced below 1 node are dropped.
 */
export function deleteNodesFromContours(
  contours: PathContour[],
  nodeIds: Set<string>
): PathContour[] {
  return contours
    .map((contour, ci) => {
      const newNodes = contour.nodes
        .filter((n) => !nodeIds.has(n.id))
        .map((n, ni) => ({ ...n, id: `c${ci}_n${ni}` }));

      // For open contours, terminal nodes have no connecting handles
      if (!contour.closed && newNodes.length > 0) {
        newNodes[0] = { ...newNodes[0], handleIn: null };
        newNodes[newNodes.length - 1] = {
          ...newNodes[newNodes.length - 1],
          handleOut: null,
        };
      }

      return { ...contour, nodes: newNodes };
    })
    .filter((c) => c.nodes.length >= 1);
}
