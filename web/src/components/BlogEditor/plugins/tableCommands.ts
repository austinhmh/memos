import { chainCommands } from "prosemirror-commands";
import { GapCursor } from "prosemirror-gapcursor";
import type { Node as ProseMirrorNode, ResolvedPos } from "prosemirror-model";
import { Slice } from "prosemirror-model";
import type { Command, EditorState } from "prosemirror-state";
import { Selection, TextSelection } from "prosemirror-state";
import {
  addColumn,
  addRow,
  CellSelection,
  cellAround,
  cellNear,
  deleteColumn,
  deleteRow,
  inSameTable,
  isInTable,
  nextCell,
  pointsAtCell,
  selectedRect,
  TableMap,
  tableNodeTypes,
  toggleHeader,
} from "prosemirror-tables";
import type { Mappable } from "prosemirror-transform";

const chainTransactions = (...commands: Array<Command | undefined>): Command => {
  return (state, dispatch) => {
    let currentState = state;
    const dispatcher = dispatch
      ? (tr: Parameters<NonNullable<typeof dispatch>>[0]) => {
          currentState = currentState.apply(tr);
          dispatch(tr);
        }
      : undefined;

    for (const command of commands) {
      command?.(currentState, dispatcher);
    }

    return true;
  };
};

const collapseSelection = (): Command => {
  return (state, dispatch) => {
    if (!dispatch) {
      return true;
    }

    dispatch(state.tr.setSelection(TextSelection.near(state.selection.$from)));
    return true;
  };
};

export class RowSelection extends CellSelection {
  constructor(
    public $anchorCell: ResolvedPos,
    public $headCell: ResolvedPos,
    public $index = 0,
  ) {
    super($anchorCell, $headCell);
  }

  getBookmark(): RowBookmark {
    return new RowBookmark(this.$anchorCell.pos, this.$headCell.pos, this.$index);
  }

  eq(other: Selection): boolean {
    return (
      other instanceof RowSelection &&
      other.$anchorCell.pos === this.$anchorCell.pos &&
      other.$headCell.pos === this.$headCell.pos &&
      other.$index === this.$index
    );
  }

  toJSON(): { type: string; anchor: number; head: number; index: number } {
    return { type: "row", anchor: this.$anchorCell.pos, head: this.$headCell.pos, index: this.$index };
  }

  static fromJSON(doc: ProseMirrorNode, json: { anchor: number; head: number; index?: number }): RowSelection {
    return new RowSelection(doc.resolve(json.anchor), doc.resolve(json.head), json.index ?? 0);
  }

  static rowSelection($anchorCell: ResolvedPos, $headCell: ResolvedPos = $anchorCell, $index = 0): CellSelection {
    const table = $anchorCell.node(-1);
    const map = TableMap.get(table);
    const tableStart = $anchorCell.start(-1);
    const anchorRect = map.findCell($anchorCell.pos - tableStart);
    const headRect = map.findCell($headCell.pos - tableStart);
    const doc = $anchorCell.node(0);

    if (anchorRect.left <= headRect.left) {
      if (anchorRect.left > 0) {
        $anchorCell = doc.resolve(tableStart + map.map[anchorRect.top * map.width]);
      }
      if (headRect.right < map.width) {
        $headCell = doc.resolve(tableStart + map.map[map.width * (headRect.top + 1) - 1]);
      }
    } else {
      if (headRect.left > 0) {
        $headCell = doc.resolve(tableStart + map.map[headRect.top * map.width]);
      }
      if (anchorRect.right < map.width) {
        $anchorCell = doc.resolve(tableStart + map.map[map.width * (anchorRect.top + 1) - 1]);
      }
    }

    return new RowSelection($anchorCell, $headCell, $index);
  }
}

class RowBookmark {
  constructor(
    public anchor: number,
    public head: number,
    public index = 0,
  ) {}

  map(mapping: Mappable): RowBookmark {
    return new RowBookmark(mapping.map(this.anchor), mapping.map(this.head), this.index);
  }

  resolve(doc: ProseMirrorNode): Selection {
    const $anchorCell = doc.resolve(this.anchor);
    const $headCell = doc.resolve(this.head);

    if (pointsAtCell($anchorCell) && pointsAtCell($headCell) && inSameTable($anchorCell, $headCell)) {
      return new RowSelection($anchorCell, $headCell, this.index);
    }

    return Selection.near($headCell, 1);
  }
}

export class ColumnSelection extends CellSelection {
  getBookmark(): ColumnBookmark {
    return new ColumnBookmark(this.$anchorCell.pos, this.$headCell.pos);
  }

  eq(other: Selection): boolean {
    return other instanceof ColumnSelection && other.$anchorCell.pos === this.$anchorCell.pos && other.$headCell.pos === this.$headCell.pos;
  }

  toJSON(): { type: string; anchor: number; head: number } {
    return { type: "column", anchor: this.$anchorCell.pos, head: this.$headCell.pos };
  }

  static fromJSON(doc: ProseMirrorNode, json: { anchor: number; head: number }): ColumnSelection {
    return new ColumnSelection(doc.resolve(json.anchor), doc.resolve(json.head));
  }

  static colSelection($anchorCell: ResolvedPos, $headCell: ResolvedPos = $anchorCell): CellSelection {
    const table = $anchorCell.node(-1);
    const map = TableMap.get(table);
    const tableStart = $anchorCell.start(-1);
    const anchorRect = map.findCell($anchorCell.pos - tableStart);
    const headRect = map.findCell($headCell.pos - tableStart);
    const doc = $anchorCell.node(0);

    if (anchorRect.top <= headRect.top) {
      if (anchorRect.top > 0) {
        $anchorCell = doc.resolve(tableStart + map.map[anchorRect.left]);
      }
      if (headRect.bottom < map.height) {
        $headCell = doc.resolve(tableStart + map.map[map.width * (map.height - 1) + headRect.right - 1]);
      }
    } else {
      if (headRect.top > 0) {
        $headCell = doc.resolve(tableStart + map.map[headRect.left]);
      }
      if (anchorRect.bottom < map.height) {
        $anchorCell = doc.resolve(tableStart + map.map[map.width * (map.height - 1) + anchorRect.right - 1]);
      }
    }

    return new ColumnSelection($anchorCell, $headCell);
  }
}

class ColumnBookmark {
  constructor(
    public anchor: number,
    public head: number,
  ) {}

  map(mapping: Mappable): ColumnBookmark {
    return new ColumnBookmark(mapping.map(this.anchor), mapping.map(this.head));
  }

  resolve(doc: ProseMirrorNode): Selection {
    const $anchorCell = doc.resolve(this.anchor);
    const $headCell = doc.resolve(this.head);

    if (pointsAtCell($anchorCell) && pointsAtCell($headCell) && inSameTable($anchorCell, $headCell)) {
      return new ColumnSelection($anchorCell, $headCell);
    }

    return Selection.near($headCell, 1);
  }
}

export const getCellsInRow =
  (index: number) =>
  (state: EditorState): number[] => {
    if (!isInTable(state)) {
      return [];
    }

    const rect = selectedRect(state);
    const cells: number[] = [];
    let previous: number | undefined;

    for (let i = 0; i < rect.map.width; i += 1) {
      const cell = rect.tableStart + rect.map.map[index * rect.map.width + i];
      if (previous === cell) {
        continue;
      }
      previous = cell;
      cells.push(cell);
    }

    return cells;
  };

export const isRowSelection = (selection: Selection): selection is RowSelection => selection instanceof RowSelection;

export const isColumnSelection = (selection: Selection): selection is ColumnSelection => selection instanceof ColumnSelection;

const getSelectedCellRect = (state: EditorState) => {
  if (!(state.selection instanceof CellSelection)) {
    return null;
  }

  return selectedRect(state);
};

const isFullRowCellSelection = (state: EditorState): boolean => {
  const rect = getSelectedCellRect(state);
  return Boolean(rect && rect.left === 0 && rect.right === rect.map.width);
};

const isFullColumnCellSelection = (state: EditorState): boolean => {
  const rect = getSelectedCellRect(state);
  return Boolean(rect && rect.top === 0 && rect.bottom === rect.map.height);
};

const isCompleteTableCellSelection = (state: EditorState): boolean => {
  const rect = getSelectedCellRect(state);
  return Boolean(rect && rect.top === 0 && rect.left === 0 && rect.bottom === rect.map.height && rect.right === rect.map.width);
};

const getSelectedTablePosition = (state: EditorState): number | null => {
  if (!(state.selection instanceof CellSelection)) {
    return null;
  }

  return selectedRect(state).tableStart - 1;
};

const setSelectionNearPosition = (tr: ReturnType<EditorState["tr"]["setMeta"]>, position: number) => {
  const selectionPos = Math.max(0, Math.min(position, tr.doc.content.size));
  tr.setSelection(TextSelection.near(tr.doc.resolve(selectionPos), selectionPos === 0 ? 1 : -1)).scrollIntoView();
};

export const isTableSelected = (state: EditorState): boolean => {
  if (isRowSelection(state.selection) || isColumnSelection(state.selection)) {
    return false;
  }

  return isCompleteTableCellSelection(state);
};

const stateWithCellSelection = (state: EditorState, cellPosition?: number): EditorState | null => {
  if (cellPosition === undefined) {
    return isInTable(state) ? state : null;
  }

  try {
    const $cell = state.doc.resolve(cellPosition);
    if (!pointsAtCell($cell)) {
      return null;
    }
    return state.apply(state.tr.setSelection(new CellSelection($cell)));
  } catch {
    return null;
  }
};

const isHeaderEnabled = (state: EditorState, type: "row" | "column") => {
  if (!isInTable(state)) {
    return false;
  }

  const rect = selectedRect(state);
  if (type === "row") {
    return getCellsInRow(0)(state).some((pos) => state.doc.nodeAt(pos)?.type.spec.tableRole === "header_cell");
  }

  for (let row = 0; row < rect.map.height; row += 1) {
    const pos = rect.tableStart + rect.map.map[row * rect.map.width];
    if (state.doc.nodeAt(pos)?.type.spec.tableRole !== "header_cell") {
      return false;
    }
  }
  return rect.map.height > 0;
};

export const createTable = ({ rowsCount, colsCount }: { rowsCount: number; colsCount: number }): Command => {
  return (state, dispatch) => {
    const cell = tableNodeTypes(state.schema).cell.createAndFill();
    const headerCell = tableNodeTypes(state.schema).header_cell.createAndFill();
    const rowType = tableNodeTypes(state.schema).row;
    const tableType = tableNodeTypes(state.schema).table;
    if (!cell || !headerCell) {
      return false;
    }

    const headerCells = Array.from({ length: colsCount }, () => headerCell.copy(headerCell.content));
    const bodyCells = Array.from({ length: colsCount }, () => cell.copy(cell.content));
    const rows = Array.from({ length: rowsCount }, (_, index) =>
      rowType.create(null, index === 0 ? headerCells : bodyCells.map((bodyCell) => bodyCell.copy(bodyCell.content))),
    );
    const table = tableType.create(null, rows);

    if (dispatch) {
      const offset = state.tr.selection.anchor + 1;
      const tr = state.tr.replaceSelectionWith(table).scrollIntoView();
      const resolvedPos = tr.doc.resolve(Math.min(offset, tr.doc.content.size));
      tr.setSelection(TextSelection.near(resolvedPos));
      dispatch(tr);
    }
    return true;
  };
};

export const moveOutOfTable = (direction: 1 | -1): Command => {
  return (state, dispatch) => {
    if (state.selection instanceof GapCursor || !isInTable(state)) {
      return false;
    }

    const rect = selectedRect(state);
    const topOfTable = rect.top === 0 && rect.bottom === 1 && direction === -1;
    const bottomOfTable = rect.top === rect.map.height - 1 && rect.bottom === rect.map.height && direction === 1;
    if (!topOfTable && !bottomOfTable) {
      return false;
    }

    const map = rect.map.map;
    const $start = state.doc.resolve(rect.tableStart + map[0] - 1);
    const $end = state.doc.resolve(rect.tableStart + map[map.length - 1] + 2);
    const gapCursor = GapCursor as typeof GapCursor & {
      findGapCursorFrom?: ($pos: ResolvedPos, dir: number, mustMove?: boolean) => ResolvedPos | null;
    };
    const $found = gapCursor.findGapCursorFrom?.(direction > 0 ? $end : $start, direction, true);

    if (!$found) {
      return false;
    }

    dispatch?.(state.tr.setSelection(new GapCursor($found)));
    return true;
  };
};

export const moveToAdjacentSelectedCell = (axis: "horiz" | "vert", direction: 1 | -1): Command => {
  return (state, dispatch) => {
    const $currentCell =
      state.selection instanceof CellSelection
        ? state.selection.$headCell
        : cellAround(state.selection.$head) || cellNear(state.selection.$head);
    if (!$currentCell) {
      return false;
    }

    const $next = nextCell($currentCell, axis, direction);
    if ($next) {
      dispatch?.(state.tr.setSelection(new CellSelection($next)).scrollIntoView());
    } else if (state.selection instanceof CellSelection) {
      return true;
    } else {
      dispatch?.(state.tr.setSelection(new CellSelection($currentCell)).scrollIntoView());
    }
    return true;
  };
};

export const enterNearTableGapCursor: Command = (state, dispatch) => {
  if (!(state.selection instanceof GapCursor)) {
    return false;
  }

  const paragraph = state.schema.nodes.paragraph?.create();
  if (!paragraph) {
    return false;
  }

  if (dispatch) {
    const pos = state.selection.from;
    let tr = state.tr.insert(pos, paragraph);
    tr = tr.setSelection(TextSelection.near(tr.doc.resolve(pos + 1))).scrollIntoView();
    dispatch(tr);
  }
  return true;
};

export const typeTextNearTableGapCursor = (text: string): Command => {
  return (state, dispatch) => {
    if (!(state.selection instanceof GapCursor) || !text) {
      return false;
    }

    const paragraphType = state.schema.nodes.paragraph;
    if (!paragraphType) {
      return false;
    }

    if (dispatch) {
      const pos = state.selection.from;
      const paragraph = paragraphType.create(null, state.schema.text(text));
      let tr = state.tr.insert(pos, paragraph);
      tr = tr.setSelection(TextSelection.near(tr.doc.resolve(pos + text.length + 1))).scrollIntoView();
      dispatch(tr);
    }
    return true;
  };
};

export const insertTextNearTableBoundary = (text: string): Command => {
  return (state, dispatch) => {
    if (!text || !state.selection.empty || !(state.selection instanceof TextSelection)) {
      return false;
    }

    const { $from } = state.selection;
    if (!$from.parent.isTextblock || $from.parentOffset !== $from.parent.textContent.length) {
      return false;
    }

    const parent = $from.node($from.depth - 1);
    const parentIndex = $from.index($from.depth - 1);
    const before = parentIndex > 0 ? parent.child(parentIndex - 1) : null;
    const after = parentIndex + 1 < parent.childCount ? parent.child(parentIndex + 1) : null;
    if (before?.type.spec.tableRole !== "table" && after?.type.spec.tableRole !== "table") {
      return false;
    }

    if (dispatch) {
      dispatch(state.tr.insertText(text).scrollIntoView());
    }
    return true;
  };
};

const addRowWithAlignment = (
  tr: ReturnType<EditorState["tr"]["setMeta"]>,
  rect: ReturnType<typeof selectedRect>,
  index: number,
  copyFromRow: number | undefined,
  state: EditorState,
) => {
  let sourceRowAlignments: Array<string | null> | undefined;

  if (copyFromRow !== undefined && copyFromRow >= 0 && copyFromRow < rect.map.height) {
    sourceRowAlignments = getCellsInRow(copyFromRow)(state).map((pos) => state.doc.nodeAt(pos)?.attrs.alignment ?? null);
  }

  const nextTr = addRow(tr, rect, index);
  if (!sourceRowAlignments) {
    return nextTr;
  }

  const nextState = state.apply(nextTr);
  for (const [columnIndex, newCellPos] of getCellsInRow(index)(nextState).entries()) {
    const alignment = sourceRowAlignments[columnIndex];
    const newCellNode = nextTr.doc.nodeAt(newCellPos);
    if (alignment && newCellNode) {
      nextTr.setNodeMarkup(newCellPos, undefined, { ...newCellNode.attrs, alignment });
    }
  }

  return nextTr;
};

export const addRowBeforeIndex = ({ index, cellPosition }: { index: number; cellPosition?: number }): Command => {
  return (state, dispatch) => {
    const commandState = stateWithCellSelection(state, cellPosition);
    if (!commandState) {
      return false;
    }

    const headerSpecialCase = index === 0 && isHeaderEnabled(commandState, "row");
    const copyFromRow = index === 0 ? 0 : index - 1;
    const addRowCommand: Command = (currentState, currentDispatch) => {
      currentDispatch?.(addRowWithAlignment(currentState.tr, selectedRect(currentState), index, copyFromRow, currentState));
      return true;
    };

    return chainTransactions(
      headerSpecialCase ? toggleHeader("row") : undefined,
      addRowCommand,
      headerSpecialCase ? toggleHeader("row") : undefined,
      collapseSelection(),
    )(commandState, dispatch);
  };
};

export const addColumnBeforeIndex = ({ index, cellPosition }: { index: number; cellPosition?: number }): Command => {
  return (state, dispatch) => {
    const commandState = stateWithCellSelection(state, cellPosition);
    if (!commandState) {
      return false;
    }

    const headerSpecialCase = index === 0 && isHeaderEnabled(commandState, "column");
    const addColumnCommand: Command = (currentState, currentDispatch) => {
      currentDispatch?.(addColumn(currentState.tr, selectedRect(currentState), index));
      return true;
    };

    return chainTransactions(
      headerSpecialCase ? toggleHeader("column") : undefined,
      addColumnCommand,
      headerSpecialCase ? toggleHeader("column") : undefined,
      collapseSelection(),
    )(commandState, dispatch);
  };
};

export const selectRowAtIndex = (index: number, expand = false, cellPosition?: number): Command => {
  return (state, dispatch) => {
    if (!dispatch) {
      return false;
    }

    let $pos: ResolvedPos;
    if (cellPosition !== undefined) {
      const $controlCell = state.doc.resolve(cellPosition);
      if (!pointsAtCell($controlCell)) {
        return false;
      }
      const table = $controlCell.node(-1);
      const map = TableMap.get(table);
      if (index < 0 || index >= map.height) {
        return false;
      }
      $pos = state.doc.resolve($controlCell.start(-1) + map.positionAt(index, 0, table));
    } else {
      if (!isInTable(state)) {
        return false;
      }
      const rect = selectedRect(state);
      const pos = rect.map.positionAt(index, 0, rect.table);
      $pos = state.doc.resolve(rect.tableStart + pos);
    }

    const currentSelection = state.selection;
    const shouldExpand =
      expand &&
      currentSelection instanceof CellSelection &&
      isRowSelection(currentSelection) &&
      inSameTable(currentSelection.$anchorCell, $pos);
    const rowSelection = shouldExpand
      ? RowSelection.rowSelection(currentSelection.$anchorCell, $pos, index)
      : RowSelection.rowSelection($pos, $pos, index);
    dispatch(state.tr.setSelection(rowSelection));
    return true;
  };
};

export const selectColumnAtIndex = (index: number, expand = false, cellPosition?: number): Command => {
  return (state, dispatch) => {
    if (!dispatch) {
      return false;
    }

    let $pos: ResolvedPos;
    if (cellPosition !== undefined) {
      const $controlCell = state.doc.resolve(cellPosition);
      if (!pointsAtCell($controlCell)) {
        return false;
      }
      const table = $controlCell.node(-1);
      const map = TableMap.get(table);
      if (index < 0 || index >= map.width) {
        return false;
      }
      $pos = state.doc.resolve($controlCell.start(-1) + map.positionAt(0, index, table));
    } else {
      if (!isInTable(state)) {
        return false;
      }
      const rect = selectedRect(state);
      const pos = rect.map.positionAt(0, index, rect.table);
      $pos = state.doc.resolve(rect.tableStart + pos);
    }

    const currentSelection = state.selection;
    const shouldExpand =
      expand &&
      currentSelection instanceof CellSelection &&
      isColumnSelection(currentSelection) &&
      inSameTable(currentSelection.$anchorCell, $pos);
    const columnSelection = shouldExpand
      ? ColumnSelection.colSelection(currentSelection.$anchorCell, $pos)
      : ColumnSelection.colSelection($pos);
    dispatch(state.tr.setSelection(columnSelection));
    return true;
  };
};

export const selectTable = (cellPosition?: number): Command => {
  return (state, dispatch) => {
    if (!dispatch) {
      return false;
    }

    let $pos: ResolvedPos;
    let lastCell: ResolvedPos;
    if (cellPosition !== undefined) {
      const $controlCell = state.doc.resolve(cellPosition);
      if (!pointsAtCell($controlCell)) {
        return false;
      }
      const table = $controlCell.node(-1);
      const map = TableMap.get(table);
      const tableStart = $controlCell.start(-1);
      $pos = state.doc.resolve(tableStart + map.map[0]);
      lastCell = state.doc.resolve(tableStart + map.map[map.map.length - 1]);
    } else {
      if (!isInTable(state)) {
        return false;
      }
      const rect = selectedRect(state);
      $pos = state.doc.resolve(rect.tableStart + rect.map.map[0]);
      lastCell = state.doc.resolve(rect.tableStart + rect.map.map[rect.map.map.length - 1]);
    }

    dispatch(state.tr.setSelection(new CellSelection($pos, lastCell)));
    return true;
  };
};

export const deleteCellSelectionContent: Command = (state, dispatch) => {
  if (
    !(state.selection instanceof CellSelection) ||
    isRowSelection(state.selection) ||
    isColumnSelection(state.selection) ||
    isTableSelected(state)
  ) {
    return false;
  }

  const selection: CellSelection = state.selection;
  if (!dispatch) {
    return true;
  }

  const tr = state.tr;
  const baseContent = tableNodeTypes(state.schema).cell.createAndFill()?.content;
  if (!baseContent) {
    return false;
  }

  selection.forEachCell((cell, pos) => {
    if (!cell.content.eq(baseContent)) {
      tr.replace(tr.mapping.map(pos + 1), tr.mapping.map(pos + cell.nodeSize - 1), new Slice(baseContent, 0, 0));
    }
  });

  if (!tr.docChanged) {
    return false;
  }

  dispatch(tr);
  return true;
};

export const deleteColSelection = (): Command => {
  return (state, dispatch) => {
    if (state.selection instanceof CellSelection && isFullColumnCellSelection(state)) {
      return isCompleteTableCellSelection(state) ? deleteSelectedTableAtPosition(state, dispatch) : deleteColumn(state, dispatch);
    }
    return false;
  };
};

export const deleteRowSelection = (): Command => {
  return (state, dispatch) => {
    if (state.selection instanceof CellSelection && isFullRowCellSelection(state)) {
      return isCompleteTableCellSelection(state) ? deleteSelectedTableAtPosition(state, dispatch) : deleteRow(state, dispatch);
    }
    return false;
  };
};

type DeleteTableRangeOptions = {
  fromIndex: number;
  toIndex: number;
  cellPosition?: number;
};

export const deleteColumnRange = ({ fromIndex, toIndex, cellPosition }: DeleteTableRangeOptions): Command => {
  return (state, dispatch) => {
    const commandState = stateWithCellSelection(state, cellPosition);
    if (!commandState) {
      return false;
    }

    const start = Math.min(fromIndex, toIndex);
    const end = Math.max(fromIndex, toIndex);
    return chainTransactions(
      selectColumnAtIndex(start, false, cellPosition),
      selectColumnAtIndex(end, true, cellPosition),
      deleteColSelection(),
    )(commandState, dispatch);
  };
};

export const deleteRowRange = ({ fromIndex, toIndex, cellPosition }: DeleteTableRangeOptions): Command => {
  return (state, dispatch) => {
    const commandState = stateWithCellSelection(state, cellPosition);
    if (!commandState) {
      return false;
    }

    const start = Math.min(fromIndex, toIndex);
    const end = Math.max(fromIndex, toIndex);
    return chainTransactions(
      selectRowAtIndex(start, false, cellPosition),
      selectRowAtIndex(end, true, cellPosition),
      deleteRowSelection(),
    )(commandState, dispatch);
  };
};

const deleteSelectedTableAtPosition: Command = (state, dispatch) => {
  const tablePos = getSelectedTablePosition(state);
  return tablePos === null ? false : deleteTableAtPosition(tablePos)(state, dispatch);
};

export const deleteTableIfSelected = (): Command => {
  return (state, dispatch) => {
    if (isTableSelected(state)) {
      return deleteSelectedTableAtPosition(state, dispatch);
    }
    return false;
  };
};

export const deleteSelectedTablePart: Command = chainCommands(
  deleteColSelection(),
  deleteRowSelection(),
  deleteTableIfSelected(),
  deleteCellSelectionContent,
);

export const deleteTableAtPosition = (tablePos: number): Command => {
  return (state, dispatch) => {
    const table = state.doc.nodeAt(tablePos);
    if (!table || table.type.spec.tableRole !== "table") {
      return false;
    }

    if (dispatch) {
      const from = tablePos;
      const to = tablePos + table.nodeSize;
      const tr = state.tr.delete(from, to);
      const paragraph = state.schema.nodes.paragraph;
      if (tr.doc.content.size === 0 && paragraph) {
        tr.insert(0, paragraph.create());
      }
      setSelectionNearPosition(tr, from);
      dispatch(tr);
    }
    return true;
  };
};

export const getTableCellPosition = (state: EditorState, tablePos: number, rowIndex: number, columnIndex: number): number | null => {
  const table = state.doc.nodeAt(tablePos);
  if (!table || table.type.spec.tableRole !== "table") {
    return null;
  }

  const map = TableMap.get(table);
  if (rowIndex < 0 || rowIndex >= map.height || columnIndex < 0 || columnIndex >= map.width) {
    return null;
  }

  return tablePos + 1 + map.positionAt(rowIndex, columnIndex, table);
};
