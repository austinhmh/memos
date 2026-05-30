import { describe, expect, it } from "vitest";
import { createMdParser } from "./markdownParser";
import { createMdSerializer } from "./markdownSerializer";
import { blogEditorSchema } from "./schema";

const parser = createMdParser(blogEditorSchema);
const serializer = createMdSerializer();

describe("BlogEditor table schema", () => {
  it("parses markdown tables into editable table nodes", () => {
    const doc = parser.parse("| A | B |\n|---|---|\n| 1 | 2 |");

    expect(doc.firstChild?.type.name).toBe("table");
    expect(doc.firstChild?.childCount).toBe(2);
    expect(doc.firstChild?.firstChild?.firstChild?.type.name).toBe("table_header");
  });

  it("serializes body-only tables with a markdown header separator", () => {
    const row = blogEditorSchema.nodes.table_row.create(null, [
      blogEditorSchema.nodes.table_cell.create(null, blogEditorSchema.text("1")),
      blogEditorSchema.nodes.table_cell.create(null, blogEditorSchema.text("2")),
    ]);
    const table = blogEditorSchema.nodes.table.create(null, [row]);
    const doc = blogEditorSchema.nodes.doc.create(null, [table]);

    expect(serializer.serialize(doc)).toBe("|     |     |\n|-----|-----|\n| 1   | 2   |");
  });

  it("escapes table cell markdown control characters", () => {
    const row = blogEditorSchema.nodes.table_row.create(null, [
      blogEditorSchema.nodes.table_header.create(null, blogEditorSchema.text("A|B")),
      blogEditorSchema.nodes.table_header.create(null, blogEditorSchema.text("C\\D")),
    ]);
    const body = blogEditorSchema.nodes.table_row.create(null, [
      blogEditorSchema.nodes.table_cell.create(null, blogEditorSchema.text("1\n2")),
      blogEditorSchema.nodes.table_cell.create(null, blogEditorSchema.text("x|y\\z")),
    ]);
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
});
