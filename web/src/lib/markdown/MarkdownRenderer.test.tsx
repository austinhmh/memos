import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { MarkdownRenderer } from "./MarkdownRenderer";

describe("MarkdownRenderer", () => {
  it("does not throw when clicking malformed hash links", () => {
    render(<MarkdownRenderer content="[bad hash](#%E0%A4%A)" />);

    expect(() => fireEvent.click(screen.getByRole("link", { name: "bad hash" }))).not.toThrow();
  });
});
