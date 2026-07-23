import { describe, expect, it } from "vitest";
import { createMdParser } from "./markdownParser";
import { createMdSerializer } from "./markdownSerializer";
import { blogEditorSchema } from "./schema";

const parser = createMdParser(blogEditorSchema);
const serializer = createMdSerializer();

const createParagraphDoc = (text: string) =>
  blogEditorSchema.nodes.doc.create(null, [blogEditorSchema.nodes.paragraph.create(null, blogEditorSchema.text(text))]);

describe("BlogEditor paragraph indent markdown roundtrip", () => {
  it("serializes leading NBSP indent as &nbsp; entities", () => {
    const indent = "\u00a0\u00a0";
    const doc = createParagraphDoc(`${indent}hello`);
    const md = serializer.serialize(doc);
    expect(md.startsWith("&nbsp;&nbsp;")).toBe(true);
  });

  it("preserves NBSP paragraph indent through serialize/parse", () => {
    const indent = "\u00a0\u00a0";
    const doc = createParagraphDoc(`${indent}hello`);
    const md = serializer.serialize(doc);
    const reparsed = parser.parse(md);
    expect(reparsed.firstChild?.type.name).toBe("paragraph");
    expect(reparsed.firstChild?.textContent).toBe(`${indent}hello`);
  });

  it("converts leading ASCII spaces to &nbsp; on serialize so indent is not stripped", () => {
    const doc = createParagraphDoc("  hello");
    const md = serializer.serialize(doc);
    expect(md.startsWith("&nbsp;&nbsp;")).toBe(true);

    const reparsed = parser.parse(md);
    expect(reparsed.firstChild?.type.name).toBe("paragraph");
    expect(reparsed.firstChild?.textContent.startsWith("\u00a0\u00a0")).toBe(true);
    expect(reparsed.firstChild?.textContent.endsWith("hello")).toBe(true);
  });

  it("does not turn four-space indent into a code block after serialize", () => {
    const doc = createParagraphDoc("    indented");
    const md = serializer.serialize(doc);
    expect(md.startsWith("&nbsp;&nbsp;&nbsp;&nbsp;")).toBe(true);
    const reparsed = parser.parse(md);
    expect(reparsed.firstChild?.type.name).toBe("paragraph");
    expect(reparsed.firstChild?.textContent.replace(/\u00a0/g, " ")).toBe("    indented");
  });

  it("parses literal leading NBSP via preserve_leading_nbsp rule", () => {
    const md = "\u00a0\u00a0hello";
    const reparsed = parser.parse(md);
    expect(reparsed.firstChild?.type.name).toBe("paragraph");
    expect(reparsed.firstChild?.textContent).toBe("\u00a0\u00a0hello");
  });

  it("keeps non-leading spaces as ordinary spaces", () => {
    const doc = createParagraphDoc("hello  world");
    const md = serializer.serialize(doc);
    expect(md).toBe("hello  world");
    expect(parser.parse(md).firstChild?.textContent).toBe("hello  world");
  });

  it("does not rewrite list indentation spaces into entities", () => {
    const md = "- item\n  - nested";
    const doc = parser.parse(md);
    expect(doc.childCount).toBeGreaterThan(0);
    expect(doc.firstChild?.type.name).toBe("bullet_list");
    const out = serializer.serialize(doc);
    expect(out).toContain("nested");
    expect(out.includes("&nbsp;")).toBe(false);
  });
});
