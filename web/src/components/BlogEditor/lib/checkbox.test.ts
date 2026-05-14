import { DOMSerializer, DOMParser as ProseMirrorDOMParser } from "prosemirror-model";
import { describe, expect, it } from "vitest";
import { createMdParser } from "./markdownParser";
import { createMdSerializer } from "./markdownSerializer";
import { blogEditorSchema } from "./schema";

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

describe("BlogEditor URL safety", () => {
  it("sanitizes bookmark URLs from parseDOM", () => {
    const wrapper = document.createElement("div");
    const element = document.createElement("div");
    element.className = "bookmark-block";
    element.dataset.url = "javascript:alert(1)";
    wrapper.appendChild(element);

    const doc = ProseMirrorDOMParser.fromSchema(blogEditorSchema).parse(wrapper);
    const bookmark = doc.firstChild;

    expect(bookmark?.type.name).toBe("bookmark");
    expect(bookmark?.attrs.url).toBe("");
    expect(serializer.serialize(doc)).toBe("");
  });

  it("sanitizes bookmark URLs in toDOM output", () => {
    const doc = blogEditorSchema.nodeFromJSON({
      type: "doc",
      content: [{ type: "bookmark", attrs: { url: "javascript:alert(1)" } }],
    });

    const dom = DOMSerializer.fromSchema(blogEditorSchema).serializeNode(doc.firstChild!, { document }) as HTMLElement;

    expect(dom.getAttribute("data-url")).toBe("");
  });

  it("sanitizes bookmark URLs during markdown serialization", () => {
    const doc = blogEditorSchema.nodeFromJSON({
      type: "doc",
      content: [{ type: "bookmark", attrs: { url: "data:text/html,<script>alert(1)</script>" } }],
    });

    expect(serializer.serialize(doc)).toBe("");
  });

  it("sanitizes link hrefs during markdown serialization", () => {
    const doc = blogEditorSchema.nodeFromJSON({
      type: "doc",
      content: [
        {
          type: "paragraph",
          content: [{ type: "text", text: "bad", marks: [{ type: "link", attrs: { href: "javascript:alert(1)" } }] }],
        },
      ],
    });

    expect(serializer.serialize(doc)).toBe("[bad]()");
  });

  it("sanitizes image srcs during markdown serialization", () => {
    const doc = blogEditorSchema.nodeFromJSON({
      type: "doc",
      content: [
        {
          type: "paragraph",
          content: [{ type: "image", attrs: { src: "javascript:alert(1)", alt: "bad" } }],
        },
      ],
    });

    expect(serializer.serialize(doc)).toBe(" ![bad]()");
  });

  it("rejects mailto image srcs during markdown serialization", () => {
    const doc = blogEditorSchema.nodeFromJSON({
      type: "doc",
      content: [
        {
          type: "paragraph",
          content: [{ type: "image", attrs: { src: "mailto:test@example.com", alt: "mail" } }],
        },
      ],
    });

    expect(serializer.serialize(doc)).toBe(" ![mail]()");
  });
});
