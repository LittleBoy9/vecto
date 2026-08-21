import { describe, expect, it } from "vitest";
import { parseSVG } from "./svgParser";
import { serializeDocument } from "./svgSerializer";

/**
 * Untrusted SVG reaches parseSVG from file open, drag-drop, image trace, model
 * output, and crash recovery — and rawDefs / rawContent are injected with
 * dangerouslySetInnerHTML, so sanitization is the boundary that matters.
 */
const sanitized = (body: string) =>
  serializeDocument(
    parseSVG(
      `<svg xmlns="http://www.w3.org/2000/svg" xmlns:xlink="http://www.w3.org/1999/xlink" viewBox="0 0 10 10">${body}</svg>`
    )
  ).toLowerCase();

const isClean = (out: string) =>
  !out.includes("alert(1)") && !/\son[a-z]+=/.test(out) && !out.includes("<script");

describe("sanitizeSvgDom", () => {
  it.each([
    ["script tag", `<script>alert(1)</script><rect width="1" height="1"/>`],
    ["uppercase SCRIPT", `<SCRIPT>alert(1)</SCRIPT><rect width="1" height="1"/>`],
    ["onload handler", `<rect width="1" height="1" onload="alert(1)"/>`],
    ["mixed-case handler", `<rect width="1" height="1" onLoAd="alert(1)"/>`],
    ["onerror on image", `<image href="x" onerror="alert(1)"/>`],
    ["foreignObject", `<foreignObject><div onclick="alert(1)">x</div></foreignObject>`],
    ["javascript: href", `<a href="javascript:alert(1)"><rect width="1" height="1"/></a>`],
    ["javascript: xlink", `<a xlink:href="javascript:alert(1)"><rect width="1" height="1"/></a>`],
    ["mixed-case scheme", `<a href="JaVaScRiPt:alert(1)"><rect width="1" height="1"/></a>`],
    ["script inside defs", `<defs><script>alert(1)</script></defs><rect width="1" height="1"/>`],
    ["script inside group", `<g><script>alert(1)</script></g>`],
    ["script inside text", `<text>hi<script>alert(1)</script></text>`],
  ])("blocks %s", (_name, body) => {
    expect(isClean(sanitized(body))).toBe(true);
  });

  // Regression: the old check was /^\s*javascript:/i, but browsers strip
  // tab/newline/CR from URLs before resolving the scheme, so an encoded
  // newline split the token past the regex and reassembled in the browser.
  it.each([
    ["encoded newline", `<a href="java&#10;script:alert(1)"><rect width="1" height="1"/></a>`],
    ["encoded tab", `<a href="java&#9;script:alert(1)"><rect width="1" height="1"/></a>`],
    ["encoded CR", `<a href="java&#13;script:alert(1)"><rect width="1" height="1"/></a>`],
  ])("blocks control-character scheme smuggling — %s", (_name, body) => {
    expect(isClean(sanitized(body))).toBe(true);
  });

  it("rejects documents containing XML-illegal control characters", () => {
    // Tab, LF, and CR are the only control characters expressible in XML, and
    // those are covered above. Anything else (a NUL, say) is a malformed
    // entity, so the parser refuses the document outright — which is stricter
    // than sanitizing it, and is the behaviour we want to keep.
    expect(() =>
      sanitized(`<a href="&#0;javascript:alert(1)"><rect width="1" height="1"/></a>`)
    ).toThrow(/parse error/i);
  });

  it("blocks data:image/svg+xml, which can carry its own script", () => {
    const out = sanitized(`<image href="data:image/svg+xml;base64,PHN2Zz48L3N2Zz4="/>`);
    expect(out).not.toContain("svg+xml");
  });

  it("keeps legitimate URLs intact", () => {
    // Over-blocking would break real artwork, so the allowlist must let these through.
    expect(sanitized(`<a href="https://example.test/a-b_c?d=1"><rect width="1" height="1"/></a>`))
      .toContain("https://example.test");
    expect(sanitized(`<image href="data:image/png;base64,iVBORw0KGgo="/>`))
      .toContain("data:image/png");
    expect(sanitized(`<use href="#local-ref"/>`)).toContain("#local-ref");
  });
});
