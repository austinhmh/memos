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
});
