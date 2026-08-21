import { describe, expect, it } from "vitest";
import { parseSVG } from "./svgParser";
import { serializeDocument } from "./svgSerializer";

const wrap = (body: string, attrs = 'viewBox="0 0 100 100"') =>
  `<svg xmlns="http://www.w3.org/2000/svg" xmlns:xlink="http://www.w3.org/1999/xlink" ${attrs}>${body}</svg>`;

const roundTrip = (body: string) => serializeDocument(parseSVG(wrap(body)));

describe("text content", () => {
  // Regression: serializeNode had no rawContent branch, so every text element
  // was written out as an empty tag. Save, export, and autosave all silently
  // dropped the copy while the canvas kept rendering it.
  it("survives a save", () => {
    expect(roundTrip(`<text x="10" y="90">Hello Vecto</text>`)).toContain("Hello Vecto");
  });

  it("keeps nested tspans", () => {
    const out = roundTrip(`<text x="1" y="2">Hi <tspan fill="blue">there</tspan></text>`);
    expect(out).toContain("tspan");
    expect(out).toContain("there");
  });

  it("round-trips through a second parse unchanged", () => {
    const once = roundTrip(`<text x="1" y="2">Round trip</text>`);
    expect(serializeDocument(parseSVG(once))).toBe(once);
  });

  it("preserves escaped entities in text", () => {
    const out = roundTrip(`<text x="1" y="2">A &amp; B</text>`);
    expect(out).toContain("&amp;");
    expect(() => parseSVG(out)).not.toThrow();
  });
});

describe("container elements", () => {
  // Regression: parseNode only recursed into <g>/<svg>, so every other
  // container was parsed as a childless leaf and its contents vanished.
  it.each([
    ["a", `<a href="https://example.test"><rect width="9" height="9"/></a>`],
    ["switch", `<switch><g><rect width="9" height="9"/></g></switch>`],
    ["symbol", `<symbol id="s"><rect width="9" height="9"/></symbol>`],
    ["marker", `<marker id="m"><path d="M0 0 L9 9"/></marker>`],
    ["mask", `<mask id="k"><rect width="9" height="9"/></mask>`],
    ["clipPath", `<clipPath id="c"><rect width="9" height="9"/></clipPath>`],
  ])("keeps children of <%s>", (_tag, body) => {
    expect(roundTrip(body)).toMatch(/<(rect|path)\b/);
  });

  it("preserves case-sensitive element names", () => {
    // <clipPath> is not <clippath> — SVG element names are case-sensitive.
    expect(roundTrip(`<clipPath id="c"><rect width="1" height="1"/></clipPath>`))
      .toContain("<clipPath");
  });
});

describe("layer state", () => {
  it("round-trips hidden layers as display:none", () => {
    const doc = parseSVG(wrap(`<rect display="none" width="5" height="5"/>`));
    expect(doc.nodes[0].visible).toBe(false);
    // The attribute is stripped so toggling visibility back on actually works.
    expect(doc.nodes[0].attributes.display).toBeUndefined();
    expect(serializeDocument(doc)).toContain('display="none"');
  });

  it("round-trips the lock flag", () => {
    // Regression: lock had no serialized form and silently reset on reload.
    const doc = parseSVG(wrap(`<rect width="5" height="5"/>`));
    doc.nodes[0].locked = true;
    const reparsed = parseSVG(serializeDocument(doc));
    expect(reparsed.nodes[0].locked).toBe(true);
    // The marker attribute must not leak into the editable attribute list.
    expect(reparsed.nodes[0].attributes["data-vecto-locked"]).toBeUndefined();
  });
});

describe("defs", () => {
  it("preserves gradients, filters, and unrecognized defs", () => {
    const out = roundTrip(`
      <defs>
        <linearGradient id="g1"><stop offset="0" stop-color="#ff0000"/></linearGradient>
        <filter id="f1"><feDropShadow dx="2" dy="3" stdDeviation="4"/></filter>
        <pattern id="p1" width="10" height="10"><rect width="5" height="5"/></pattern>
      </defs>
      <rect width="1" height="1" fill="url(#g1)" filter="url(#f1)"/>`);
    expect(out).toContain("#ff0000");
    expect(out).toContain("feDropShadow");
    expect(out).toContain("pattern");
    expect(out).toContain('fill="url(#g1)"');
  });

  it("derives a viewBox from width/height when absent", () => {
    const doc = parseSVG(
      `<svg xmlns="http://www.w3.org/2000/svg" width="24" height="24"><rect width="1" height="1"/></svg>`
    );
    expect(doc.viewBox).toMatchObject({ width: 24, height: 24 });
  });
});
