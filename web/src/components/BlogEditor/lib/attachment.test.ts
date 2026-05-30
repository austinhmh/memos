import { describe, expect, it } from "vitest";
import { createMdParser } from "./markdownParser";
import { createMdSerializer } from "./markdownSerializer";
import { blogEditorSchema } from "./schema";

const parser = createMdParser(blogEditorSchema);
const serializer = createMdSerializer();

describe("attachment markdown", () => {
  it("serializes an attachment node like Outline", () => {
    const doc = blogEditorSchema.nodes.doc.create(null, [
      blogEditorSchema.nodes.attachment.create({
        href: "/file/attachments/test/notes.txt",
        title: "notes.txt",
        size: 5,
        contentType: "text/plain",
      }),
    ]);

    expect(serializer.serialize(doc)).toBe("[notes.txt 5](http://localhost:3000/file/attachments/test/notes.txt)");
  });

  it("parses internal file links back into attachment nodes", () => {
    const doc = parser.parse("[notes.txt 5](/file/attachments/test/notes.txt)");
    const attachment = doc.firstChild;

    expect(attachment?.type.name).toBe("attachment");
    expect(attachment?.attrs.href).toBe("http://localhost:3000/file/attachments/test/notes.txt");
    expect(attachment?.attrs.title).toBe("notes.txt");
    expect(attachment?.attrs.size).toBe(5);
  });
});
