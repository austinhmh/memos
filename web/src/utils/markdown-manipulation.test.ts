import { describe, expect, it } from "vitest";
import { updateTaskContentAtIndex } from "./markdown-manipulation";

describe("markdown task manipulation", () => {
  it("preserves image references when editing task content", () => {
    const markdown = "- [ ] Original task ![pasted image](/file/attachments/image-uid/pasted.png)\n\n#todo";

    expect(updateTaskContentAtIndex(markdown, 0, "Renamed task")).toBe(
      "- [ ] Renamed task ![pasted image](/file/attachments/image-uid/pasted.png)\n\n#todo",
    );
  });

  it("does not duplicate existing image references", () => {
    const markdown = "- [ ] Original task ![pasted image](/file/attachments/image-uid/pasted.png)\n\n#todo";

    expect(updateTaskContentAtIndex(markdown, 0, "Renamed task ![pasted image](/file/attachments/image-uid/pasted.png)")).toBe(
      "- [ ] Renamed task ![pasted image](/file/attachments/image-uid/pasted.png)\n\n#todo",
    );
  });
});
