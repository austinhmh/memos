import { describe, expect, it } from "vitest";
import { getRenderFallbackText, getRenderLimitMessage, MATH_RENDER_LIMIT, MERMAID_RENDER_LIMIT } from "./renderLimits";

describe("markdown render limits", () => {
  it("rejects oversized Mermaid diagrams by characters and lines", () => {
    expect(getRenderLimitMessage("x".repeat(MERMAID_RENDER_LIMIT.maxChars + 1), MERMAID_RENDER_LIMIT)).toContain("characters");
    expect(
      getRenderLimitMessage(Array.from({ length: MERMAID_RENDER_LIMIT.maxLines + 1 }, () => "graph TD").join("\n"), MERMAID_RENDER_LIMIT),
    ).toContain("lines");
  });

  it("rejects oversized math expressions by characters and lines", () => {
    expect(getRenderLimitMessage("x".repeat(MATH_RENDER_LIMIT.maxChars + 1), MATH_RENDER_LIMIT)).toContain("characters");
    expect(
      getRenderLimitMessage(Array.from({ length: MATH_RENDER_LIMIT.maxLines + 1 }, () => "x = y").join("\n"), MATH_RENDER_LIMIT),
    ).toContain("lines");
  });

  it("truncates fallback text for oversized render content", () => {
    expect(getRenderFallbackText("x".repeat(2_001))).toBe(`${"x".repeat(2_000)}\n…`);
  });
});
