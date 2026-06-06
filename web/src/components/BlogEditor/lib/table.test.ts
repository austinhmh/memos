import type { Mark } from "prosemirror-model";
import { describe, expect, it } from "vitest";
import { createMdParser } from "./markdownParser";
import { createMdSerializer } from "./markdownSerializer";
import { blogEditorSchema } from "./schema";

const parser = createMdParser(blogEditorSchema);
const serializer = createMdSerializer();

const createCellContent = (text?: string, marks?: readonly Mark[]) => {
  return text
    ? blogEditorSchema.nodes.paragraph.create(null, blogEditorSchema.text(text, marks))
    : blogEditorSchema.nodes.paragraph.create();
};

const createTableHeader = (text?: string, marks?: readonly Mark[]) =>
  blogEditorSchema.nodes.table_header.create(null, createCellContent(text, marks));

const createTableCell = (text?: string, marks?: readonly Mark[]) =>
  blogEditorSchema.nodes.table_cell.create(null, createCellContent(text, marks));

describe("BlogEditor table schema", () => {
  it("parses markdown tables into editable table nodes", () => {
    const doc = parser.parse("| A | B |\n|---|---|\n| 1 | 2 |");

    expect(doc.firstChild?.type.name).toBe("table");
    expect(doc.firstChild?.childCount).toBe(2);
    expect(doc.firstChild?.firstChild?.firstChild?.type.name).toBe("table_header");
  });

  it("serializes body-only tables with a markdown header separator", () => {
    const row = blogEditorSchema.nodes.table_row.create(null, [createTableCell("1"), createTableCell("2")]);
    const table = blogEditorSchema.nodes.table.create(null, [row]);
    const doc = blogEditorSchema.nodes.doc.create(null, [table]);

    expect(serializer.serialize(doc)).toBe("|     |     |\n|-----|-----|\n| 1   | 2   |");
  });

  it("escapes table cell markdown control characters", () => {
    const row = blogEditorSchema.nodes.table_row.create(null, [createTableHeader("A|B"), createTableHeader("C\\D")]);
    const body = blogEditorSchema.nodes.table_row.create(null, [createTableCell("1\n2"), createTableCell("x|y\\z")]);
    const table = blogEditorSchema.nodes.table.create(null, [row, body]);
    const doc = blogEditorSchema.nodes.doc.create(null, [table]);

    expect(serializer.serialize(doc)).toBe("| A\\|B     | C\\\\D      |\n|----------|-----------|\n| 1<br>2   | x\\|y\\\\z   |");
  });

  it("preserves a table followed by a paragraph through markdown serialization", () => {
    const doc = parser.parse("before\n\n| A | B |\n|---|---|\n| 1 | 2 |\n\nafter");
    const serialized = serializer.serialize(doc);
    const reparsed = parser.parse(serialized);

    expect(reparsed.childCount).toBe(3);
    expect(reparsed.child(0).type.name).toBe("paragraph");
    expect(reparsed.child(1).type.name).toBe("table");
    expect(reparsed.child(2).type.name).toBe("paragraph");
    expect(reparsed.child(2).textContent).toBe("after");
  });

  it("preserves an empty inserted table between paragraphs through markdown serialization", () => {
    const headerCellA = blogEditorSchema.nodes.table_header.createAndFill();
    const headerCellB = blogEditorSchema.nodes.table_header.createAndFill();
    const cellA = blogEditorSchema.nodes.table_cell.createAndFill();
    const cellB = blogEditorSchema.nodes.table_cell.createAndFill();
    expect(headerCellA).not.toBeNull();
    expect(headerCellB).not.toBeNull();
    expect(cellA).not.toBeNull();
    expect(cellB).not.toBeNull();

    const headerRow = blogEditorSchema.nodes.table_row.create(null, [headerCellA!, headerCellB!]);
    const bodyRow = blogEditorSchema.nodes.table_row.create(null, [cellA!, cellB!]);
    const doc = blogEditorSchema.nodes.doc.create(null, [
      blogEditorSchema.nodes.paragraph.create(null, blogEditorSchema.text("#core-e2e-table")),
      blogEditorSchema.nodes.paragraph.create(null, blogEditorSchema.text("before table")),
      blogEditorSchema.nodes.table.create(null, [headerRow, bodyRow]),
      blogEditorSchema.nodes.paragraph.create(null, blogEditorSchema.text("after table")),
    ]);

    const serialized = serializer.serialize(doc);
    const reparsed = parser.parse(serialized);

    expect(reparsed.childCount).toBe(4);
    expect(reparsed.child(0).textContent).toBe("#core-e2e-table");
    expect(reparsed.child(1).textContent).toBe("before table");
    expect(reparsed.child(2).type.name).toBe("table");
    expect(reparsed.child(3).textContent).toBe("after table");
  });

  it("preserves inline marks inside table cells through markdown serialization", () => {
    const strong = blogEditorSchema.marks.strong.create();
    const link = blogEditorSchema.marks.link.create({ href: "https://example.com", title: null });
    const headerRow = blogEditorSchema.nodes.table_row.create(null, [createTableHeader("Name"), createTableHeader("Link")]);
    const bodyRow = blogEditorSchema.nodes.table_row.create(null, [createTableCell("Bold", [strong]), createTableCell("Example", [link])]);
    const doc = blogEditorSchema.nodes.doc.create(null, [blogEditorSchema.nodes.table.create(null, [headerRow, bodyRow])]);

    const serialized = serializer.serialize(doc);
    const reparsed = parser.parse(serialized);
    const firstBodyCell = reparsed.firstChild?.child(1).child(0);
    const secondBodyCell = reparsed.firstChild?.child(1).child(1);

    expect(serialized).toContain("**Bold**");
    expect(serialized).toContain("[Example](https://example.com/");
    expect(firstBodyCell?.firstChild?.firstChild?.marks.some((mark) => mark.type.name === "strong")).toBe(true);
    expect(secondBodyCell?.firstChild?.firstChild?.marks.some((mark) => mark.type.name === "link")).toBe(true);
  });
});
