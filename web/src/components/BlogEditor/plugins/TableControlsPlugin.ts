import type { Attrs, Node as ProseMirrorNode } from "prosemirror-model";
import type { Command, EditorState, Transaction } from "prosemirror-state";
import { Plugin, PluginKey, TextSelection } from "prosemirror-state";
import {
  addColumn,
  addRow,
  columnResizing,
  goToNextCell,
  isInTable,
  selectedRect,
  TableMap,
  tableEditing,
  toggleHeader,
} from "prosemirror-tables";
import type { EditorView, Decoration as ProseMirrorDecoration } from "prosemirror-view";
import { Decoration, DecorationSet } from "prosemirror-view";
import { isCompositionTransaction, isViewComposing } from "./CompositionGuardPlugin";

type MutableAttrs = Record<string, unknown>;

const TABLE_ADD_ROW_CLASS = "table-add-row";
const TABLE_ADD_COLUMN_CLASS = "table-add-column";
const FIRST_CLASS = "first";

const classNames = (...values: Array<string | false | undefined>) => values.filter(Boolean).join(" ");

const chainTransactions = (...commands: Array<Command | undefined>): Command => {
  return (state, dispatch) => {
    let currentState = state;
    const dispatcher = (tr: Transaction) => {
      currentState = currentState.apply(tr);
      dispatch?.(tr);
    };

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

const getCellsInRow =
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

const addRowWithAlignment = (
  tr: Transaction,
  rect: ReturnType<typeof selectedRect>,
  index: number,
  copyFromRow: number | undefined,
  state: EditorState,
): Transaction => {
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

export const addRowBeforeIndex = ({ index }: { index: number }): Command => {
  return (state, dispatch) => {
    if (!isInTable(state)) {
      return false;
    }

    const headerSpecialCase = index === 0 && isHeaderEnabled(state, "row");
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
    )(state, dispatch);
  };
};

export const addColumnBeforeIndex = ({ index }: { index: number }): Command => {
  return (state, dispatch) => {
    if (!isInTable(state)) {
      return false;
    }

    const headerSpecialCase = index === 0 && isHeaderEnabled(state, "column");
    const addColumnCommand: Command = (currentState, currentDispatch) => {
      currentDispatch?.(addColumn(currentState.tr, selectedRect(currentState), index));
      return true;
    };

    return chainTransactions(
      headerSpecialCase ? toggleHeader("column") : undefined,
      addColumnCommand,
      headerSpecialCase ? toggleHeader("column") : undefined,
      collapseSelection(),
    )(state, dispatch);
  };
};

const buildAddRowDecoration = (pos: number, index: number): ProseMirrorDecoration => {
  const className = classNames(TABLE_ADD_ROW_CLASS, index === 0 && FIRST_CLASS);
  return Decoration.widget(
    pos + 1,
    () => {
      const plus = document.createElement("a");
      plus.role = "button";
      plus.className = className;
      plus.textContent = "+";
      plus.dataset.index = index.toString();
      plus.dataset.position = pos.toString();
      plus.setAttribute("aria-label", "Insert row");
      plus.setAttribute("contenteditable", "false");
      return plus;
    },
    { key: `${className}-${index}-${pos}` },
  );
};

const buildAddColumnDecoration = (pos: number, index: number): ProseMirrorDecoration => {
  const className = classNames(TABLE_ADD_COLUMN_CLASS, index === 0 && FIRST_CLASS);
  return Decoration.widget(
    pos + 1,
    () => {
      const plus = document.createElement("a");
      plus.role = "button";
      plus.className = className;
      plus.textContent = "+";
      plus.dataset.index = index.toString();
      plus.dataset.position = pos.toString();
      plus.setAttribute("aria-label", "Insert column");
      plus.setAttribute("contenteditable", "false");
      return plus;
    },
    { key: `${className}-${index}-${pos}` },
  );
};

const createTableControlDecorations = (state: EditorState, editable: boolean): DecorationSet => {
  if (!editable) {
    return DecorationSet.empty;
  }

  const { doc } = state;
  const decorations: ProseMirrorDecoration[] = [];

  doc.descendants((node, tablePos) => {
    if (node.type.spec.tableRole !== "table") {
      return true;
    }

    const map = TableMap.get(node);
    const tableStart = tablePos + 1;
    const firstColumnCells = new Map<number, number>();
    const seenRows = new Set<number>();

    for (let row = 0; row < map.height; row += 1) {
      const currentFirstCellPos = tableStart + map.map[row * map.width];
      firstColumnCells.set(row, currentFirstCellPos);

      if (seenRows.has(currentFirstCellPos)) {
        continue;
      }
      seenRows.add(currentFirstCellPos);

      if (row === 0) {
        decorations.push(buildAddRowDecoration(currentFirstCellPos, 0));
      }

      const firstCellNode = doc.nodeAt(currentFirstCellPos);
      const rowspan = Number(firstCellNode?.attrs.rowspan ?? 1);
      decorations.push(buildAddRowDecoration(currentFirstCellPos, row + rowspan));
    }

    const seenColumns = new Set<number>();
    for (let col = 0; col < map.width; col += 1) {
      const cellPos = tableStart + map.map[col];
      if (seenColumns.has(cellPos)) {
        continue;
      }
      seenColumns.add(cellPos);

      if (col === 0) {
        decorations.push(buildAddColumnDecoration(cellPos, 0));
      }
      decorations.push(buildAddColumnDecoration(cellPos, col + 1));
    }

    return false;
  });

  return DecorationSet.create(doc, decorations);
};

const handleTableControlMouseDown = (view: EditorView, event: MouseEvent): boolean => {
  if (!(event.target instanceof HTMLElement)) {
    return false;
  }

  const targetAddRow = event.target.closest(`.${TABLE_ADD_ROW_CLASS}`);
  if (targetAddRow instanceof HTMLElement) {
    event.preventDefault();
    event.stopImmediatePropagation();
    const index = Number(targetAddRow.getAttribute("data-index"));
    const position = Number(targetAddRow.getAttribute("data-position"));
    view.dispatch(view.state.tr.setSelection(TextSelection.near(view.state.doc.resolve(position))));
    addRowBeforeIndex({ index })(view.state, view.dispatch);
    return true;
  }

  const targetAddColumn = event.target.closest(`.${TABLE_ADD_COLUMN_CLASS}`);
  if (targetAddColumn instanceof HTMLElement) {
    event.preventDefault();
    event.stopImmediatePropagation();
    const index = Number(targetAddColumn.getAttribute("data-index"));
    const position = Number(targetAddColumn.getAttribute("data-position"));
    view.dispatch(view.state.tr.setSelection(TextSelection.near(view.state.doc.resolve(position))));
    addColumnBeforeIndex({ index })(view.state, view.dispatch);
    return true;
  }

  return false;
};

export const createTableControlDecorationsForTest = createTableControlDecorations;

const tableControlsPluginKey = new PluginKey<DecorationSet>("tableControls");

export const createTableControlsPlugin = (options: { isEditable: () => boolean }) => {
  return new Plugin<DecorationSet>({
    key: tableControlsPluginKey,
    state: {
      init: (_, state) => createTableControlDecorations(state, options.isEditable()),
      apply(tr, decorations, _oldState, newState) {
        if (isCompositionTransaction(tr)) {
          return decorations.map(tr.mapping, tr.doc);
        }

        if (!tr.docChanged && !tr.selectionSet) {
          return decorations;
        }

        return createTableControlDecorations(newState, options.isEditable());
      },
    },
    props: {
      decorations: (state) => tableControlsPluginKey.getState(state) ?? null,
      handleDOMEvents: {
        mousedown(view, event) {
          if (isViewComposing(view)) {
            return false;
          }
          return handleTableControlMouseDown(view, event);
        },
      },
    },
  });
};

export const createTablePlugins = (options: { isEditable: () => boolean }) => [
  createTableControlsPlugin(options),
  columnResizing(),
  tableEditing(),
];

export const tableKeymap: Record<string, Command> = {
  Tab: goToNextCell(1),
  "Shift-Tab": goToNextCell(-1),
};

export const getCellAttrs = (dom: HTMLElement | string): Attrs => {
  if (typeof dom === "string") {
    return {};
  }

  const widthAttr = dom.getAttribute("data-colwidth");
  const widths = widthAttr && /^\d+(,\d+)*$/.test(widthAttr) ? widthAttr.split(",").map(Number) : null;
  const colspan = Number(dom.getAttribute("colspan") || 1);

  return {
    colspan,
    rowspan: Number(dom.getAttribute("rowspan") || 1),
    colwidth: widths && widths.length === colspan ? widths : null,
    alignment: dom.style.textAlign === "center" ? "center" : dom.style.textAlign === "right" ? "right" : null,
  };
};

export const setCellAttrs = (node: ProseMirrorNode): Attrs => {
  const attrs: MutableAttrs = {};
  if (node.attrs.colspan !== 1) {
    attrs.colspan = node.attrs.colspan;
  }
  if (node.attrs.rowspan !== 1) {
    attrs.rowspan = node.attrs.rowspan;
  }
  if (node.attrs.alignment) {
    attrs.style = `text-align: ${node.attrs.alignment};`;
  }
  if (node.attrs.colwidth) {
    attrs["data-colwidth"] = node.attrs.colwidth.map(Number).join(",");
  }
  return attrs;
};
