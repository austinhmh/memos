import { describe, expect, it } from "vitest";
import { createMdParser } from "./markdownParser";
import { createMdSerializer } from "./markdownSerializer";
import { blogEditorSchema } from "./schema";

const parser = createMdParser(blogEditorSchema);
const serializer = createMdSerializer();

describe("BlogEditor colored highlight markdown", () => {
  it("parses colored highlight attrs from extended highlight syntax", () => {
    const doc = parser.parse("=={color:FDEA9B}colored==");
    const paragraph = doc.firstChild;
    const text = paragraph?.firstChild;
    const highlight = text?.marks.find((mark) => mark.type === blogEditorSchema.marks.highlight);

    expect(highlight?.attrs.color).toBe("#FDEA9B");
    expect(text?.text).toBe("colored");
  });

  it("serializes colored highlight attrs to extended highlight syntax", () => {
    const doc = blogEditorSchema.nodes.doc.create(null, [
      blogEditorSchema.nodes.paragraph.create(null, [
        blogEditorSchema.text("colored", [blogEditorSchema.marks.highlight.create({ color: "#FDEA9B" })]),
      ]),
    ]);

    expect(serializer.serialize(doc)).toBe("=={color:FDEA9B}colored==");
  });

  it("keeps plain highlight syntax without color attrs", () => {
    const doc = parser.parse("==plain==");
    const serialized = serializer.serialize(doc);

    expect(serialized).toBe("==plain==");
  });
});

describe("BlogEditor text color markdown", () => {
  it("parses text color attrs from extended color syntax", () => {
    const doc = parser.parse("{{color:DC2626|red text}}");
    const paragraph = doc.firstChild;
    const text = paragraph?.firstChild;
    const textColor = text?.marks.find((mark) => mark.type === blogEditorSchema.marks.text_color);

    expect(textColor?.attrs.color).toBe("#DC2626");
    expect(text?.text).toBe("red text");
  });

  it("serializes text color attrs to extended color syntax", () => {
    const doc = blogEditorSchema.nodes.doc.create(null, [
      blogEditorSchema.nodes.paragraph.create(null, [
        blogEditorSchema.text("red text", [blogEditorSchema.marks.text_color.create({ color: "#DC2626" })]),
      ]),
    ]);

    expect(serializer.serialize(doc)).toBe("{{color:DC2626|red text}}");
  });

  it("roundtrips text color with underline", () => {
    const doc = blogEditorSchema.nodes.doc.create(null, [
      blogEditorSchema.nodes.paragraph.create(null, [
        blogEditorSchema.text("roundtrip", [
          blogEditorSchema.marks.text_color.create({ color: "#DC2626" }),
          blogEditorSchema.marks.underline.create(),
        ]),
      ]),
    ]);

    const serialized = serializer.serialize(doc);
    const parsedText = parser.parse(serialized).firstChild?.firstChild;
    const parsedMarkNames = parsedText?.marks.map((mark) => mark.type.name) ?? [];

    expect(serialized).toBe("{{color:DC2626|__roundtrip__}}");
    expect(parsedText?.text).toBe("roundtrip");
    expect(parsedMarkNames).toEqual(expect.arrayContaining(["text_color", "underline"]));
  });

  it("roundtrips highlight with underline", () => {
    const doc = blogEditorSchema.nodes.doc.create(null, [
      blogEditorSchema.nodes.paragraph.create(null, [
        blogEditorSchema.text("roundtrip", [
          blogEditorSchema.marks.highlight.create({ color: "#FDEA9B" }),
          blogEditorSchema.marks.underline.create(),
        ]),
      ]),
    ]);

    const serialized = serializer.serialize(doc);
    const parsedText = parser.parse(serialized).firstChild?.firstChild;
    const parsedMarkNames = parsedText?.marks.map((mark) => mark.type.name) ?? [];

    expect(serialized).toBe("=={color:FDEA9B}__roundtrip__==");
    expect(parsedText?.text).toBe("roundtrip");
    expect(parsedMarkNames).toEqual(expect.arrayContaining(["highlight", "underline"]));
  });

  it("roundtrips nested highlight, text color, and basic marks", () => {
    const marks = [
      blogEditorSchema.marks.strong.create(),
      blogEditorSchema.marks.em.create(),
      blogEditorSchema.marks.underline.create(),
      blogEditorSchema.marks.s.create(),
      blogEditorSchema.marks.highlight.create({ color: "#FDEA9B" }),
      blogEditorSchema.marks.text_color.create({ color: "#DC2626" }),
    ];
    const doc = blogEditorSchema.nodes.doc.create(null, [
      blogEditorSchema.nodes.paragraph.create(null, [blogEditorSchema.text("roundtrip", marks)]),
    ]);

    const serialized = serializer.serialize(doc);
    const parsed = parser.parse(serialized);
    const parsedText = parsed.firstChild?.firstChild;
    const parsedMarkNames = parsedText?.marks.map((mark) => mark.type.name) ?? [];

    expect(serialized).toBe("***~~=={color:FDEA9B}{{color:DC2626|__roundtrip__}}==~~***");
    expect(parsedText?.text).toBe("roundtrip");
    expect(parsedMarkNames).toEqual(expect.arrayContaining(["strong", "em", "underline", "s", "highlight", "text_color"]));
    expect(parsedText?.marks.find((mark) => mark.type === blogEditorSchema.marks.highlight)?.attrs.color).toBe("#FDEA9B");
    expect(parsedText?.marks.find((mark) => mark.type === blogEditorSchema.marks.text_color)?.attrs.color).toBe("#DC2626");
  });
});
