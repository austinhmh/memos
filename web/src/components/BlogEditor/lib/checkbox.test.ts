import { describe, expect, it } from "vitest";
import { blogEditorSchema } from "./schema";
import { createMdParser } from "./markdownParser";
import { createMdSerializer } from "./markdownSerializer";

const parser = createMdParser(blogEditorSchema);
const serializer = createMdSerializer();

describe("BlogEditor checkbox schema", () => {
  it("parses markdown checkbox list into checkbox nodes", () => {
    const doc = parser.parse("- [x] done\n- [ ] todo");
    expect(doc.childCount).toBe(1);
    const list = doc.child(0);
    expect(list.type.name).toBe("checkbox_list");
    expect(list.childCount).toBe(2);
    expect(list.child(0).type.name).toBe("checkbox_item");
    expect(list.child(0).attrs.checked).toBe(true);
    expect(list.child(1).attrs.checked).toBe(false);
  });

  it("serializes checkbox nodes back to markdown", () => {
    const doc = parser.parse("- [x] done\n- [ ] todo");
    expect(serializer.serialize(doc)).toBe("- [x] done\n- [ ] todo");
  });
});
