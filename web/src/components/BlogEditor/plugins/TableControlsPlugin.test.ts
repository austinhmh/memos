import { GapCursor } from "prosemirror-gapcursor";
import type { Mark, Node as ProseMirrorNode } from "prosemirror-model";
import { DOMParser as ProseMirrorDOMParser } from "prosemirror-model";
import { EditorState, TextSelection, type Transaction } from "prosemirror-state";
import { CellSelection, selectedRect } from "prosemirror-tables";
import { EditorView } from "prosemirror-view";
import { describe, expect, it, vi } from "vitest";
import { blogEditorSchema } from "../lib/schema";
import { createTablePlugins, tableKeymap } from "./TableControlsPlugin";
import {
  addColumnBeforeIndex,
  addRowBeforeIndex,
  deleteColSelection,
  deleteColumnRange,
  deleteRowRange,
  deleteRowSelection,
  deleteSelectedTablePart,
  deleteTableAtPosition,
  deleteTableIfSelected,
  enterNearTableGapCursor,
  getTableCellPosition,
  insertTextNearTableBoundary,
  moveOutOfTable,
  moveToAdjacentSelectedCell,
  selectColumnAtIndex,
  selectRowAtIndex,
  selectTable,
  typeTextNearTableGapCursor,
} from "./tableCommands";

const createCellContent = (text?: string, marks?: readonly Mark[]) => {
  return text
    ? blogEditorSchema.nodes.paragraph.create(null, blogEditorSchema.text(text, marks))
    : blogEditorSchema.nodes.paragraph.create();
};

const createTableHeader = (text?: string, marks?: readonly Mark[]) =>
  blogEditorSchema.nodes.table_header.create(null, createCellContent(text, marks));

const createTableCell = (text?: string, marks?: readonly Mark[]) =>
  blogEditorSchema.nodes.table_cell.create(null, createCellContent(text, marks));

const getCellParagraph = (cell: ProseMirrorNode | null | undefined) => cell?.firstChild;

const getCellTextEndPosition = (cellPosition: number, cell: ProseMirrorNode | null | undefined) => {
  const paragraph = getCellParagraph(cell);
  return cellPosition + 2 + (paragraph?.textContent.length ?? 0);
};

const getBodyLastCellTextEndPosition = (state: EditorState) => {
  const cellPosition = getTableCellPosition(state, 0, 1, 1);
  const cell = cellPosition === null ? null : state.doc.nodeAt(cellPosition);
  return getCellTextEndPosition(cellPosition ?? 0, cell);
};

const createTableNode = () => {
  const headerCellA = createTableHeader("A");
  const headerCellB = createTableHeader("B");
  const cellA = createTableCell("1");
  const cellB = createTableCell("2");
  const headerRow = blogEditorSchema.nodes.table_row.create(null, [headerCellA, headerCellB]);
  const bodyRow = blogEditorSchema.nodes.table_row.create(null, [cellA, cellB]);
  return blogEditorSchema.nodes.table.create(null, [headerRow, bodyRow]);
};

const createTableState = () => {
  const table = createTableNode();
  const doc = blogEditorSchema.nodes.doc.create(null, [table]);
  const state = EditorState.create({ doc, schema: blogEditorSchema });

  const firstCellPosition = getTableCellPosition(state, 0, 0, 0);
  const firstCell = firstCellPosition === null ? null : doc.nodeAt(firstCellPosition);
  return state.apply(state.tr.setSelection(TextSelection.near(doc.resolve(getCellTextEndPosition(firstCellPosition ?? 0, firstCell)))));
};

const applyCommand = (state: EditorState, command: (state: EditorState, dispatch: (tr: Transaction) => void) => boolean) => {
  let nextState = state;
  const handled = command(nextState, (tr) => {
    nextState = nextState.apply(tr);
  });
  return { handled, state: nextState };
};

describe("tableCommands", () => {
  it("adds a row at the requested table boundary", () => {
    const { handled, state } = applyCommand(createTableState(), addRowBeforeIndex({ index: 2 }));

    expect(handled).toBe(true);
    expect(state.doc.firstChild?.childCount).toBe(3);
    expect(state.selection.empty).toBe(true);
  });

  it("adds a column at the requested table boundary", () => {
    const { handled, state } = applyCommand(createTableState(), addColumnBeforeIndex({ index: 2 }));

    expect(handled).toBe(true);
    expect(state.doc.firstChild?.firstChild?.childCount).toBe(3);
    expect(state.selection.empty).toBe(true);
  });

  it("adds a row using a table cell position without moving the visible cursor first", () => {
    const state = createTableState();
    const cellPosition = getTableCellPosition(state, 0, 1, 0);
    expect(cellPosition).toBeTypeOf("number");

    const result = applyCommand(state, addRowBeforeIndex({ index: 2, cellPosition: cellPosition ?? undefined }));

    expect(result.handled).toBe(true);
    expect(result.state.doc.firstChild?.childCount).toBe(3);
  });

  it("adds a column using a table cell position without moving the visible cursor first", () => {
    const state = createTableState();
    const cellPosition = getTableCellPosition(state, 0, 0, 1);
    expect(cellPosition).toBeTypeOf("number");

    const result = applyCommand(state, addColumnBeforeIndex({ index: 2, cellPosition: cellPosition ?? undefined }));

    expect(result.handled).toBe(true);
    expect(result.state.doc.firstChild?.firstChild?.childCount).toBe(3);
  });

  it("selects and deletes one row", () => {
    let state = createTableState();
    const dispatch = (tr: Transaction) => {
      state = state.apply(tr);
    };

    expect(selectRowAtIndex(1)(state, dispatch)).toBe(true);
    expect(deleteRowSelection()(state, dispatch)).toBe(true);
    expect(state.doc.firstChild?.childCount).toBe(1);
  });

  it("extends row selection and deletes multiple rows", () => {
    let state = createTableState();
    const dispatch = (tr: Transaction) => {
      state = state.apply(tr);
    };

    expect(addRowBeforeIndex({ index: 2 })(state, dispatch)).toBe(true);
    expect(state.doc.firstChild?.childCount).toBe(3);
    expect(selectRowAtIndex(1)(state, dispatch)).toBe(true);
    expect(selectRowAtIndex(2, true)(state, dispatch)).toBe(true);
    expect(state.selection).toBeInstanceOf(CellSelection);
    expect(selectedRect(state).bottom - selectedRect(state).top).toBe(2);
    expect(deleteRowSelection()(state, dispatch)).toBe(true);
    expect(state.doc.firstChild?.childCount).toBe(1);
  });

  it("selects and deletes one column", () => {
    let state = createTableState();
    const dispatch = (tr: Transaction) => {
      state = state.apply(tr);
    };

    expect(selectColumnAtIndex(1)(state, dispatch)).toBe(true);
    expect(deleteColSelection()(state, dispatch)).toBe(true);
    expect(state.doc.firstChild?.firstChild?.childCount).toBe(1);
  });

  it("extends column selection and deletes multiple columns", () => {
    let state = createTableState();
    const dispatch = (tr: Transaction) => {
      state = state.apply(tr);
    };

    expect(addColumnBeforeIndex({ index: 2 })(state, dispatch)).toBe(true);
    expect(state.doc.firstChild?.firstChild?.childCount).toBe(3);
    expect(selectColumnAtIndex(1)(state, dispatch)).toBe(true);
    expect(selectColumnAtIndex(2, true)(state, dispatch)).toBe(true);
    expect(state.selection).toBeInstanceOf(CellSelection);
    expect(selectedRect(state).right - selectedRect(state).left).toBe(2);
    expect(deleteColSelection()(state, dispatch)).toBe(true);
    expect(state.doc.firstChild?.firstChild?.childCount).toBe(1);
  });

  it("keeps an expanded all-row selection as row deletion instead of table or column deletion", () => {
    let state = createTableState();
    const dispatch = (tr: Transaction) => {
      state = state.apply(tr);
    };

    expect(addColumnBeforeIndex({ index: 2 })(state, dispatch)).toBe(true);
    expect(selectRowAtIndex(0)(state, dispatch)).toBe(true);
    expect(selectRowAtIndex(1, true)(state, dispatch)).toBe(true);
    expect(deleteRowSelection()(state, dispatch)).toBe(true);
    expect(state.doc.firstChild?.type.name).not.toBe("table");
  });

  it("keeps an expanded all-column selection as column deletion instead of table or row deletion", () => {
    let state = createTableState();
    const dispatch = (tr: Transaction) => {
      state = state.apply(tr);
    };

    expect(addRowBeforeIndex({ index: 2 })(state, dispatch)).toBe(true);
    expect(selectColumnAtIndex(0)(state, dispatch)).toBe(true);
    expect(selectColumnAtIndex(1, true)(state, dispatch)).toBe(true);
    expect(deleteColSelection()(state, dispatch)).toBe(true);
    expect(state.doc.firstChild?.type.name).not.toBe("table");
  });

  it("deletes the whole table through the table selection command", () => {
    let state = createTableState();
    const dispatch = (tr: Transaction) => {
      state = state.apply(tr);
    };

    expect(selectTable()(state, dispatch)).toBe(true);
    expect(deleteTableIfSelected()(state, dispatch)).toBe(true);
    expect(state.doc.firstChild?.type.name).not.toBe("table");
  });

  it("deletes the table by stable table position and leaves an editable paragraph", () => {
    let state = createTableState();
    const dispatch = (tr: Transaction) => {
      state = state.apply(tr);
    };

    expect(deleteTableAtPosition(0)(state, dispatch)).toBe(true);
    expect(state.doc.childCount).toBe(1);
    expect(state.doc.firstChild?.type.name).toBe("paragraph");
    expect(state.selection).toBeInstanceOf(TextSelection);
  });

  it("deletes an empty whole table selection even when ProseMirror reports it as empty", () => {
    const emptyHeaderCellA = blogEditorSchema.nodes.table_header.createAndFill();
    const emptyHeaderCellB = blogEditorSchema.nodes.table_header.createAndFill();
    const emptyCellA = blogEditorSchema.nodes.table_cell.createAndFill();
    const emptyCellB = blogEditorSchema.nodes.table_cell.createAndFill();
    expect(emptyHeaderCellA).not.toBeNull();
    expect(emptyHeaderCellB).not.toBeNull();
    expect(emptyCellA).not.toBeNull();
    expect(emptyCellB).not.toBeNull();

    const headerRow = blogEditorSchema.nodes.table_row.create(null, [emptyHeaderCellA!, emptyHeaderCellB!]);
    const bodyRow = blogEditorSchema.nodes.table_row.create(null, [emptyCellA!, emptyCellB!]);
    const table = blogEditorSchema.nodes.table.create(null, [headerRow, bodyRow]);
    const doc = blogEditorSchema.nodes.doc.create(null, [table]);
    let state = EditorState.create({ doc, schema: blogEditorSchema });
    state = state.apply(state.tr.setSelection(TextSelection.near(doc.resolve(3))));
    const dispatch = (tr: Transaction) => {
      state = state.apply(tr);
    };

    expect(selectTable()(state, dispatch)).toBe(true);
    expect(state.selection).toBeInstanceOf(CellSelection);
    expect(deleteTableIfSelected()(state, dispatch)).toBe(true);
    expect(state.doc.firstChild?.type.name).not.toBe("table");
  });

  it("handles Backspace/Delete command in Outline order", () => {
    let state = createTableState();
    const dispatch = (tr: Transaction) => {
      state = state.apply(tr);
    };

    expect(selectColumnAtIndex(1)(state, dispatch)).toBe(true);
    expect(deleteSelectedTablePart(state, dispatch)).toBe(true);
    expect(state.doc.firstChild?.firstChild?.childCount).toBe(1);
  });

  it("shows delete action for a full-column CellSelection even if the custom ColumnSelection class is lost", () => {
    let state = createTableState();
    const dispatch = (tr: Transaction) => {
      state = state.apply(tr);
    };
    const topCell = getTableCellPosition(state, 0, 0, 1);
    const bottomCell = getTableCellPosition(state, 0, 1, 1);
    expect(topCell).toBeTypeOf("number");
    expect(bottomCell).toBeTypeOf("number");

    state = state.apply(state.tr.setSelection(new CellSelection(state.doc.resolve(topCell ?? 0), state.doc.resolve(bottomCell ?? 0))));
    expect(state.selection).toBeInstanceOf(CellSelection);
    expect(deleteSelectedTablePart(state, dispatch)).toBe(true);
    expect(state.doc.firstChild?.firstChild?.childCount).toBe(1);
  });

  it("shows delete action for a full-row CellSelection even if the custom RowSelection class is lost", () => {
    let state = createTableState();
    const dispatch = (tr: Transaction) => {
      state = state.apply(tr);
    };
    const leftCell = getTableCellPosition(state, 0, 1, 0);
    const rightCell = getTableCellPosition(state, 0, 1, 1);
    expect(leftCell).toBeTypeOf("number");
    expect(rightCell).toBeTypeOf("number");

    state = state.apply(state.tr.setSelection(new CellSelection(state.doc.resolve(leftCell ?? 0), state.doc.resolve(rightCell ?? 0))));
    expect(state.selection).toBeInstanceOf(CellSelection);
    expect(deleteSelectedTablePart(state, dispatch)).toBe(true);
    expect(state.doc.firstChild?.childCount).toBe(1);
  });

  it("deletes a selected column by stable control metadata after selection focus is lost", () => {
    let state = createTableState();
    const dispatch = (tr: Transaction) => {
      state = state.apply(tr);
    };
    const controlCell = getTableCellPosition(state, 0, 0, 1);
    expect(controlCell).toBeTypeOf("number");

    state = state.apply(state.tr.setSelection(TextSelection.near(state.doc.resolve((controlCell ?? 0) + 1))));
    expect(deleteColumnRange({ fromIndex: 1, toIndex: 1, cellPosition: controlCell ?? undefined })(state, dispatch)).toBe(true);
    expect(state.doc.firstChild?.firstChild?.childCount).toBe(1);
  });

  it("deletes a selected row by stable control metadata after selection focus is lost", () => {
    let state = createTableState();
    const dispatch = (tr: Transaction) => {
      state = state.apply(tr);
    };
    const controlCell = getTableCellPosition(state, 0, 1, 0);
    expect(controlCell).toBeTypeOf("number");

    state = state.apply(state.tr.setSelection(TextSelection.near(state.doc.resolve((controlCell ?? 0) + 1))));
    expect(deleteRowRange({ fromIndex: 1, toIndex: 1, cellPosition: controlCell ?? undefined })(state, dispatch)).toBe(true);
    expect(state.doc.firstChild?.childCount).toBe(1);
  });

  it("deletes a selected table through the Delete/Backspace command without requiring isInTable", () => {
    let state = createTableState();
    const dispatch = (tr: Transaction) => {
      state = state.apply(tr);
    };

    expect(selectTable()(state, dispatch)).toBe(true);
    expect(deleteSelectedTablePart(state, dispatch)).toBe(true);
    expect(state.doc.firstChild?.type.name).not.toBe("table");
  });

  it("moves selected cells directly with arrow keys without collapsing into text", () => {
    let state = createTableState();
    const dispatch = (tr: Transaction) => {
      state = state.apply(tr);
    };

    const firstCell = getTableCellPosition(state, 0, 0, 0);
    const secondCell = getTableCellPosition(state, 0, 0, 1);
    const bottomRightCell = getTableCellPosition(state, 0, 1, 1);
    expect(firstCell).toBeTypeOf("number");
    expect(secondCell).toBeTypeOf("number");
    expect(bottomRightCell).toBeTypeOf("number");

    state = state.apply(state.tr.setSelection(new CellSelection(state.doc.resolve(firstCell ?? 0))));

    expect(moveToAdjacentSelectedCell("horiz", 1)(state, dispatch)).toBe(true);
    expect(state.selection).toBeInstanceOf(CellSelection);
    expect((state.selection as CellSelection).$headCell.pos).toBe(secondCell);

    expect(moveToAdjacentSelectedCell("vert", 1)(state, dispatch)).toBe(true);
    expect(state.selection).toBeInstanceOf(CellSelection);
    expect((state.selection as CellSelection).$headCell.pos).toBe(bottomRightCell);
  });

  it("keeps selected cells selected at table arrow boundaries", () => {
    let state = createTableState();
    const firstCell = getTableCellPosition(state, 0, 0, 0);
    expect(firstCell).toBeTypeOf("number");
    state = state.apply(state.tr.setSelection(new CellSelection(state.doc.resolve(firstCell ?? 0))));

    let dispatched = false;
    expect(
      moveToAdjacentSelectedCell("horiz", -1)(state, (tr) => {
        dispatched = true;
        state = state.apply(tr);
      }),
    ).toBe(true);
    expect(dispatched).toBe(false);
    expect(state.selection).toBeInstanceOf(CellSelection);
    expect((state.selection as CellSelection).$headCell.pos).toBe(firstCell);
  });

  it("moves from an in-cell text cursor directly to the adjacent selected cell", () => {
    let state = createTableState();
    const dispatch = (tr: Transaction) => {
      state = state.apply(tr);
    };

    const firstCell = getTableCellPosition(state, 0, 0, 0);
    const secondCell = getTableCellPosition(state, 0, 0, 1);
    expect(firstCell).toBeTypeOf("number");
    expect(secondCell).toBeTypeOf("number");

    state = state.apply(state.tr.setSelection(TextSelection.near(state.doc.resolve((firstCell ?? 0) + 1))));
    expect(state.selection).toBeInstanceOf(TextSelection);

    expect(moveToAdjacentSelectedCell("horiz", 1)(state, dispatch)).toBe(true);
    expect(state.selection).toBeInstanceOf(CellSelection);
    expect((state.selection as CellSelection).$headCell.pos).toBe(secondCell);
  });

  it("converts an in-cell text cursor to a selected cell at arrow boundaries", () => {
    let state = createTableState();
    const dispatch = (tr: Transaction) => {
      state = state.apply(tr);
    };

    const firstCell = getTableCellPosition(state, 0, 0, 0);
    expect(firstCell).toBeTypeOf("number");

    state = state.apply(state.tr.setSelection(TextSelection.near(state.doc.resolve((firstCell ?? 0) + 1))));
    expect(state.selection).toBeInstanceOf(TextSelection);

    expect(moveToAdjacentSelectedCell("horiz", -1)(state, dispatch)).toBe(true);
    expect(state.selection).toBeInstanceOf(CellSelection);
    expect((state.selection as CellSelection).$headCell.pos).toBe(firstCell);
  });

  it("moves out of table to gap cursor before and after the table", () => {
    let state = createTableState();
    const dispatch = (tr: Transaction) => {
      state = state.apply(tr);
    };

    expect(moveOutOfTable(-1)(state, dispatch)).toBe(true);
    expect(state.selection).toBeInstanceOf(GapCursor);
    expect(state.selection.from).toBe(0);

    state = createTableState();
    state = state.apply(state.tr.setSelection(TextSelection.near(state.doc.resolve(getBodyLastCellTextEndPosition(state)), -1)));
    expect(moveOutOfTable(1)(state, dispatch)).toBe(true);
    expect(state.selection).toBeInstanceOf(GapCursor);
    expect(state.selection.from).toBe(state.doc.content.size);
  });

  it("creates a paragraph from a table gap cursor so typing can continue after the table", () => {
    let state = createTableState();
    state = state.apply(state.tr.setSelection(TextSelection.near(state.doc.resolve(getBodyLastCellTextEndPosition(state)), -1)));
    const dispatch = (tr: Transaction) => {
      state = state.apply(tr);
    };

    expect(moveOutOfTable(1)(state, dispatch)).toBe(true);
    expect(enterNearTableGapCursor(state, dispatch)).toBe(true);
    expect(state.doc.childCount).toBe(2);
    expect(state.doc.lastChild?.type.name).toBe("paragraph");
    expect(state.selection).toBeInstanceOf(TextSelection);
  });

  it("handles Enter inside a table cell before browser native DOM mutation", () => {
    let state = createTableState();
    const cellPosition = getTableCellPosition(state, 0, 1, 0);
    expect(cellPosition).toBeTypeOf("number");
    const paragraph = getCellParagraph(state.doc.nodeAt(cellPosition ?? 0));
    expect(paragraph).toBeTruthy();
    state = state.apply(
      state.tr.setSelection(
        TextSelection.create(state.doc, getCellTextEndPosition(cellPosition ?? 0, state.doc.nodeAt(cellPosition ?? 0))),
      ),
    );

    expect(
      tableKeymap.Enter(state, (tr) => {
        state = state.apply(tr);
      }),
    ).toBe(true);
    const targetCell = state.doc.nodeAt(cellPosition ?? 0);

    expect(state.doc.firstChild?.childCount).toBe(2);
    expect(state.doc.firstChild?.firstChild?.childCount).toBe(2);
    expect(targetCell?.childCount).toBe(2);
    expect(targetCell?.firstChild?.textContent).toBe("1");
  });

  it("places selection inside a clicked block table cell", () => {
    const table = createTableNode();
    const doc = blogEditorSchema.nodes.doc.create(null, [table]);
    const cellPosition = getTableCellPosition(EditorState.create({ doc, schema: blogEditorSchema }), 0, 1, 0);
    expect(cellPosition).toBeTypeOf("number");
    const cell = doc.nodeAt(cellPosition ?? 0);
    expect(cell).toBeTruthy();
    const host = document.createElement("div");
    document.body.appendChild(host);
    const view = new EditorView(host, {
      state: EditorState.create({
        doc,
        schema: blogEditorSchema,
        plugins: createTablePlugins({ isEditable: () => true }),
      }),
    });
    view.dom.classList.add("blog-editor-content");
    const tableCell = view.dom.querySelector("td");
    expect(tableCell).toBeInstanceOf(HTMLTableCellElement);
    const originalElementFromPoint = document.elementFromPoint;
    Object.defineProperty(document, "elementFromPoint", {
      configurable: true,
      value: vi.fn(() => tableCell),
    });
    Object.defineProperty(view, "posAtCoords", {
      value: () => ({ pos: 1, inside: -1 }),
    });

    try {
      const mouseDown = new MouseEvent("mousedown", { bubbles: true, cancelable: true, button: 0, clientX: 10, clientY: 10 });
      view.dom.dispatchEvent(mouseDown);
      const click = new MouseEvent("click", { bubbles: true, cancelable: true, button: 0, clientX: 10, clientY: 10 });
      view.dom.dispatchEvent(click);

      expect(mouseDown.defaultPrevented).toBe(true);
      expect(click.defaultPrevented).toBe(true);
      expect(view.state.selection).toBeInstanceOf(TextSelection);
      expect(view.state.selection.$from.node(view.state.selection.$from.depth - 1).type.spec.tableRole).toBe("cell");
    } finally {
      Object.defineProperty(document, "elementFromPoint", {
        configurable: true,
        value: originalElementFromPoint,
      });
      view.destroy();
      host.remove();
    }
  });

  it("blocks composition paragraph insertion inside a table cell", () => {
    const table = createTableNode();
    const doc = blogEditorSchema.nodes.doc.create(null, [table]);
    const cellPosition = getTableCellPosition(EditorState.create({ doc, schema: blogEditorSchema }), 0, 1, 0);
    expect(cellPosition).toBeTypeOf("number");
    const cell = doc.nodeAt(cellPosition ?? 0);
    const paragraph = getCellParagraph(cell);
    expect(paragraph).toBeTruthy();

    const host = document.createElement("div");
    document.body.appendChild(host);
    const state = EditorState.create({
      doc,
      schema: blogEditorSchema,
      plugins: createTablePlugins({ isEditable: () => true }),
      selection: TextSelection.create(doc, getCellTextEndPosition(cellPosition ?? 0, cell)),
    });
    const view = new EditorView(host, { state });
    const before = view.state.doc.toJSON();
    try {
      view.dom.dispatchEvent(new CompositionEvent("compositionstart", { bubbles: true }));
      const input = new InputEvent("beforeinput", { bubbles: true, cancelable: true, inputType: "insertParagraph" });
      view.dom.dispatchEvent(input);

      expect(input.defaultPrevented).toBe(true);
      expect(view.state.doc.toJSON()).toEqual(before);
    } finally {
      view.dom.dispatchEvent(new CompositionEvent("compositionend", { bubbles: true }));
      view.destroy();
      host.remove();
    }
  });

  it("handles non-composition beforeinput paragraph insertion inside a table cell", () => {
    const table = createTableNode();
    const doc = blogEditorSchema.nodes.doc.create(null, [table]);
    const cellPosition = getTableCellPosition(EditorState.create({ doc, schema: blogEditorSchema }), 0, 1, 0);
    expect(cellPosition).toBeTypeOf("number");
    const cell = doc.nodeAt(cellPosition ?? 0);
    const paragraph = getCellParagraph(cell);
    expect(paragraph).toBeTruthy();

    const host = document.createElement("div");
    document.body.appendChild(host);
    const state = EditorState.create({
      doc,
      schema: blogEditorSchema,
      plugins: createTablePlugins({ isEditable: () => true }),
      selection: TextSelection.create(doc, getCellTextEndPosition(cellPosition ?? 0, cell)),
    });
    const view = new EditorView(host, { state });
    try {
      const input = new InputEvent("beforeinput", { bubbles: true, cancelable: true, inputType: "insertParagraph" });
      view.dom.dispatchEvent(input);
      const targetCell = view.state.doc.nodeAt(cellPosition ?? 0);

      expect(input.defaultPrevented).toBe(true);
      expect(view.state.doc.firstChild?.type.name).toBe("table");
      expect(targetCell?.childCount).toBe(2);
      expect(targetCell?.firstChild?.textContent).toBe("1");
    } finally {
      view.destroy();
      host.remove();
    }
  });

  it("lets text beforeinput inside a table cell use the native ProseMirror input path", () => {
    const table = createTableNode();
    const doc = blogEditorSchema.nodes.doc.create(null, [table]);
    const cellPosition = getTableCellPosition(EditorState.create({ doc, schema: blogEditorSchema }), 0, 1, 0);
    expect(cellPosition).toBeTypeOf("number");
    const cell = doc.nodeAt(cellPosition ?? 0);

    const host = document.createElement("div");
    document.body.appendChild(host);
    const state = EditorState.create({
      doc,
      schema: blogEditorSchema,
      plugins: createTablePlugins({ isEditable: () => true }),
      selection: TextSelection.create(doc, getCellTextEndPosition(cellPosition ?? 0, cell)),
    });
    const view = new EditorView(host, { state });
    try {
      const input = new InputEvent("beforeinput", { bubbles: true, cancelable: true, inputType: "insertText", data: "中文" });
      view.dom.dispatchEvent(input);
      const targetCell = view.state.doc.nodeAt(cellPosition ?? 0);

      expect(input.defaultPrevented).toBe(false);
      expect(view.state.doc.firstChild?.type.name).toBe("table");
      expect(view.state.doc.firstChild?.childCount).toBe(2);
      expect(targetCell?.textContent).toBe("1");
    } finally {
      view.destroy();
      host.remove();
    }
  });

  it("restores native input fallback inside a table cell before DOM parsing flattens the table", () => {
    const table = createTableNode();
    const doc = blogEditorSchema.nodes.doc.create(null, [table]);
    const cellPosition = getTableCellPosition(EditorState.create({ doc, schema: blogEditorSchema }), 0, 1, 0);
    expect(cellPosition).toBeTypeOf("number");
    const cell = doc.nodeAt(cellPosition ?? 0);

    const host = document.createElement("div");
    document.body.appendChild(host);
    const state = EditorState.create({
      doc,
      schema: blogEditorSchema,
      plugins: createTablePlugins({ isEditable: () => true }),
      selection: TextSelection.create(doc, getCellTextEndPosition(cellPosition ?? 0, cell)),
    });
    const view = new EditorView(host, { state });
    try {
      view.dom.textContent = `${view.state.doc.textContent}直输`;
      const input = new Event("input", { bubbles: true, cancelable: false });
      view.dom.dispatchEvent(input);
      const targetCell = view.state.doc.nodeAt(cellPosition ?? 0);

      expect(view.state.doc.firstChild?.type.name).toBe("table");
      expect(view.state.doc.firstChild?.childCount).toBe(2);
      expect(view.state.doc.firstChild?.firstChild?.childCount).toBe(2);
      expect(targetCell?.textContent).toBe("1直输");
      expect(view.dom.querySelectorAll("table")).toHaveLength(1);
    } finally {
      view.destroy();
      host.remove();
    }
  });

  it("deduplicates repeated native input events inside a table cell by reading the DOM diff", () => {
    const table = createTableNode();
    const doc = blogEditorSchema.nodes.doc.create(null, [table]);
    const cellPosition = getTableCellPosition(EditorState.create({ doc, schema: blogEditorSchema }), 0, 1, 0);
    expect(cellPosition).toBeTypeOf("number");
    const cell = doc.nodeAt(cellPosition ?? 0);

    const host = document.createElement("div");
    document.body.appendChild(host);
    const state = EditorState.create({
      doc,
      schema: blogEditorSchema,
      plugins: createTablePlugins({ isEditable: () => true }),
      selection: TextSelection.create(doc, getCellTextEndPosition(cellPosition ?? 0, cell)),
    });
    const view = new EditorView(host, { state });
    try {
      let typed = "";
      for (const char of ["测", "试", "中", "文"]) {
        typed += char;
        const paragraph = view.dom.querySelector("td p");
        expect(paragraph).toBeInstanceOf(HTMLParagraphElement);
        if (paragraph) paragraph.textContent = `1${typed}`;
        view.dom.dispatchEvent(new InputEvent("input", { bubbles: true, cancelable: false, inputType: "insertText", data: char }));
        view.dom.dispatchEvent(new InputEvent("input", { bubbles: true, cancelable: false, inputType: "insertText", data: "测试中文" }));
      }
      const targetCell = view.state.doc.nodeAt(cellPosition ?? 0);

      expect(view.state.doc.firstChild?.type.name).toBe("table");
      expect(targetCell?.textContent).toBe("1测试中文");
      expect(view.dom.querySelectorAll("table")).toHaveLength(1);
    } finally {
      view.destroy();
      host.remove();
    }
  });

  it("parses ProseMirror table wrappers without flattening table text into a paragraph", () => {
    const container = document.createElement("div");
    container.innerHTML = `<div class="tableWrapper"><table><tbody><tr><th>Header</th><th>Header</th></tr><tr><td>Cell</td><td>Cell</td></tr></tbody></table></div><p>after</p>`;

    const doc = ProseMirrorDOMParser.fromSchema(blogEditorSchema).parse(container);

    expect(doc.childCount).toBe(2);
    expect(doc.firstChild?.type.name).toBe("table");
    expect(doc.lastChild?.type.name).toBe("paragraph");
    expect(doc.lastChild?.textContent).toBe("after");
  });

  it("parses a full editor DOM with heading, tag, table wrapper, and trailing paragraph", () => {
    const container = document.createElement("div");
    container.innerHTML = `<a class="heading-position-anchor ProseMirror-widget" contenteditable="false" aria-hidden="true"></a><h1 dir="auto">Title</h1><p dir="auto">#blog</p><div class="tableWrapper"><table style="--default-cell-min-width: 100px; min-width: 300px;"><colgroup><col><col></colgroup><tbody><tr><th><br class="ProseMirror-trailingBreak"></th><th><br class="ProseMirror-trailingBreak"></th></tr><tr><td><br class="ProseMirror-trailingBreak"></td><td><br class="ProseMirror-trailingBreak"></td></tr></tbody></table></div><p dir="auto">after table ok</p>`;

    const doc = ProseMirrorDOMParser.fromSchema(blogEditorSchema).parse(container);

    expect(doc.childCount).toBe(4);
    expect(doc.child(0).type.name).toBe("heading");
    expect(doc.child(0).textContent).toBe("Title");
    expect(doc.child(1).textContent).toBe("#blog");
    expect(doc.child(2).type.name).toBe("table");
    expect(doc.child(3).textContent).toBe("after table ok");
  });

  it("inserts typed text into an empty paragraph directly after a table", () => {
    const table = createTableNode();
    const paragraph = blogEditorSchema.nodes.paragraph.create();
    const doc = blogEditorSchema.nodes.doc.create(null, [table, paragraph]);
    const paragraphStart = table.nodeSize + 1;
    const state = EditorState.create({
      doc,
      schema: blogEditorSchema,
      selection: TextSelection.create(doc, paragraphStart),
    });
    let nextState = state;
    const dispatch = (tr: Transaction) => {
      nextState = nextState.apply(tr);
    };

    expect(insertTextNearTableBoundary("after")(state, dispatch)).toBe(true);
    expect(nextState.doc.childCount).toBe(2);
    expect(nextState.doc.firstChild?.type.name).toBe("table");
    expect(nextState.doc.lastChild?.textContent).toBe("after");
  });

  it("continues typed text in a non-empty paragraph directly after a table", () => {
    const table = createTableNode();
    const paragraph = blogEditorSchema.nodes.paragraph.create(null, blogEditorSchema.text("after"));
    const doc = blogEditorSchema.nodes.doc.create(null, [table, paragraph]);
    const paragraphEnd = table.nodeSize + paragraph.nodeSize;
    const state = EditorState.create({
      doc,
      schema: blogEditorSchema,
      selection: TextSelection.create(doc, paragraphEnd - 1),
    });
    let nextState = state;
    const dispatch = (tr: Transaction) => {
      nextState = nextState.apply(tr);
    };

    expect(insertTextNearTableBoundary("!")(state, dispatch)).toBe(true);
    expect(nextState.doc.childCount).toBe(2);
    expect(nextState.doc.firstChild?.type.name).toBe("table");
    expect(nextState.doc.lastChild?.textContent).toBe("after!");
  });

  it("inserts typed text into an empty paragraph directly before a table", () => {
    const paragraph = blogEditorSchema.nodes.paragraph.create();
    const table = createTableNode();
    const doc = blogEditorSchema.nodes.doc.create(null, [paragraph, table]);
    const state = EditorState.create({
      doc,
      schema: blogEditorSchema,
      selection: TextSelection.create(doc, 1),
    });
    let nextState = state;
    const dispatch = (tr: Transaction) => {
      nextState = nextState.apply(tr);
    };

    expect(insertTextNearTableBoundary("before")(state, dispatch)).toBe(true);
    expect(nextState.doc.childCount).toBe(2);
    expect(nextState.doc.firstChild?.textContent).toBe("before");
    expect(nextState.doc.lastChild?.type.name).toBe("table");
  });

  it("continues typed text in a non-empty paragraph directly before a table", () => {
    const paragraph = blogEditorSchema.nodes.paragraph.create(null, blogEditorSchema.text("before"));
    const table = createTableNode();
    const doc = blogEditorSchema.nodes.doc.create(null, [paragraph, table]);
    const state = EditorState.create({
      doc,
      schema: blogEditorSchema,
      selection: TextSelection.create(doc, paragraph.nodeSize - 1),
    });
    let nextState = state;
    const dispatch = (tr: Transaction) => {
      nextState = nextState.apply(tr);
    };

    expect(insertTextNearTableBoundary("!")(state, dispatch)).toBe(true);
    expect(nextState.doc.childCount).toBe(2);
    expect(nextState.doc.firstChild?.textContent).toBe("before!");
    expect(nextState.doc.lastChild?.type.name).toBe("table");
  });

  it("inserts typed text into a new paragraph from a table gap cursor", () => {
    let state = createTableState();
    state = state.apply(state.tr.setSelection(TextSelection.near(state.doc.resolve(getBodyLastCellTextEndPosition(state)), -1)));
    const dispatch = (tr: Transaction) => {
      state = state.apply(tr);
    };

    expect(moveOutOfTable(1)(state, dispatch)).toBe(true);
    expect(typeTextNearTableGapCursor("after")(state, dispatch)).toBe(true);
    expect(state.doc.childCount).toBe(2);
    expect(state.doc.lastChild?.textContent).toBe("after");
  });
});
