import { EditorState, TextSelection } from "prosemirror-state";
import { Decoration } from "prosemirror-view";
import { describe, expect, it } from "vitest";
import { blogEditorSchema } from "../lib/schema";
import { addColumnBeforeIndex, addRowBeforeIndex, createTableControlDecorationsForTest } from "./TableControlsPlugin";

const createTableState = () => {
  const headerCellA = blogEditorSchema.nodes.table_header.create(null, blogEditorSchema.text("A"));
  const headerCellB = blogEditorSchema.nodes.table_header.create(null, blogEditorSchema.text("B"));
  const cellA = blogEditorSchema.nodes.table_cell.create(null, blogEditorSchema.text("1"));
  const cellB = blogEditorSchema.nodes.table_cell.create(null, blogEditorSchema.text("2"));
  const headerRow = blogEditorSchema.nodes.table_row.create(null, [headerCellA, headerCellB]);
  const bodyRow = blogEditorSchema.nodes.table_row.create(null, [cellA, cellB]);
  const table = blogEditorSchema.nodes.table.create(null, [headerRow, bodyRow]);
  const doc = blogEditorSchema.nodes.doc.create(null, [table]);
  const state = EditorState.create({ doc, schema: blogEditorSchema });

  return state.apply(state.tr.setSelection(TextSelection.near(doc.resolve(3))));
};

describe("TableControlsPlugin", () => {
  it("adds a row at the requested table boundary", () => {
    const state = createTableState();
    let nextState = state;

    const handled = addRowBeforeIndex({ index: 2 })(state, (tr) => {
      nextState = nextState.apply(tr);
    });

    expect(handled).toBe(true);
    expect(nextState.doc.firstChild?.childCount).toBe(3);
    expect(nextState.selection.empty).toBe(true);
  });

  it("adds a column at the requested table boundary", () => {
    const state = createTableState();
    let nextState = state;

    const handled = addColumnBeforeIndex({ index: 2 })(state, (tr) => {
      nextState = nextState.apply(tr);
    });

    expect(handled).toBe(true);
    expect(nextState.doc.firstChild?.firstChild?.childCount).toBe(3);
    expect(nextState.selection.empty).toBe(true);
  });

  it("adds controls for tables before the table is focused", () => {
    const state = createTableState();
    const decorations = createTableControlDecorationsForTest(state, true).find();

    expect(decorations.length).toBe(6);
  });

  it("stores the table cell position on each control", () => {
    const state = createTableState();
    const decorations = createTableControlDecorationsForTest(state, true).find();

    for (const decoration of decorations) {
      expect(decoration.spec.key).toMatch(/-\d+-\d+$/);
      const widget = decoration as Decoration & { type: { toDOM: (view?: unknown, getPos?: unknown) => HTMLElement } };
      const element = widget.type.toDOM();
      expect(element.getAttribute("data-position")).toMatch(/^\d+$/);
      expect(element.textContent).toBe("+");
      expect(element.getAttribute("href")).toBeNull();
      expect(element.getAttribute("contenteditable")).toBe("false");
    }
  });
});
