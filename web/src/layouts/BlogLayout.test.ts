import { describe, expect, it } from "vitest";
import { isWritingDetailPath } from "./BlogLayout";

describe("BlogLayout", () => {
  it("keeps the documents explorer only on writing/blog list routes", () => {
    expect(isWritingDetailPath("/writing")).toBe(false);
    expect(isWritingDetailPath("/blog")).toBe(false);
    expect(isWritingDetailPath("/writing/abc123")).toBe(true);
    expect(isWritingDetailPath("/blog/abc123")).toBe(true);
  });
});
