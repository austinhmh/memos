import { describe, expect, it } from "vitest";
import { hasMarkdownImageReferences, stripMarkdownImageReferences, updateTaskContentAtIndex } from "./markdown-manipulation";

describe("markdown task manipulation", () => {
  it("removes image references from task content when editing", () => {
    const markdown = "- [ ] Original task ![pasted image](/file/attachments/image-uid/pasted.png)\n\n#todo";

    expect(updateTaskContentAtIndex(markdown, 0, "Renamed task ![pasted image](/file/attachments/image-uid/pasted.png)")).toBe(
      "- [ ] Renamed task\n\n#todo",
    );
  });

  it("does not keep previous image references when editing task content", () => {
    const markdown = "- [ ] Original task ![pasted image](/file/attachments/image-uid/pasted.png)\n\n#todo";

    expect(updateTaskContentAtIndex(markdown, 0, "Renamed task")).toBe("- [ ] Renamed task\n\n#todo");
  });

  it("strips pasted markdown image text before it reaches todo content", () => {
    expect(hasMarkdownImageReferences("sync monitor ![image.png](/file/attachments/XNzshn2VvaVgUWYaC9vs5Z/image.png) fixed")).toBe(true);
    expect(hasMarkdownImageReferences("sync  monitor  fixed")).toBe(false);
    expect(stripMarkdownImageReferences("sync monitor ![image.png](/file/attachments/XNzshn2VvaVgUWYaC9vs5Z/image.png) fixed")).toBe(
      "sync monitor fixed",
    );
  });
});
