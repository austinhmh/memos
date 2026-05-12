import { describe, expect, it } from "vitest";
import { sanitizeSvg } from "./sanitize-svg";

describe("sanitizeSvg", () => {
  it("removes executable SVG content and dangerous URL attributes", () => {
    const sanitized = sanitizeSvg(`
      <svg xmlns="http://www.w3.org/2000/svg" onload="alert(1)">
        <script>alert(1)</script>
        <foreignObject><div xmlns="http://www.w3.org/1999/xhtml">bad</div></foreignObject>
        <a href="javascript:alert(1)"><text>bad href</text></a>
        <image href="data:text/html,bad" />
        <text onclick="alert(1)">hello</text>
      </svg>
    `);

    expect(sanitized).not.toContain("<script");
    expect(sanitized.toLowerCase()).not.toContain("foreignobject");
    expect(sanitized).not.toContain("onload");
    expect(sanitized).not.toContain("onclick");
    expect(sanitized).not.toContain("javascript:");
    expect(sanitized).not.toContain("data:text/html");
    expect(sanitized).toContain("hello");
  });

  it("keeps safe SVG markup", () => {
    const sanitized = sanitizeSvg(
      `<svg xmlns="http://www.w3.org/2000/svg"><g><text>safe</text><a href="https://example.com"><text>link</text></a></g></svg>`,
    );

    expect(sanitized).toContain("<text>safe</text>");
    expect(sanitized).toContain("https://example.com");
  });

  it("returns an empty string for non-SVG input", () => {
    expect(sanitizeSvg(`<html><body>not svg</body></html>`)).toBe("");
  });
});
