import type { EditorState } from "prosemirror-state";
import { CellSelection, selectedRect, TableMap } from "prosemirror-tables";
import type { EditorView } from "prosemirror-view";
import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import {
  addColumnBeforeIndex,
  addRowBeforeIndex,
  deleteColSelection,
  deleteColumnRange,
  deleteRowRange,
  deleteRowSelection,
  deleteSelectedTablePart,
  deleteTableAtPosition,
  getTableCellPosition,
  isTableSelected,
  selectColumnAtIndex,
  selectRowAtIndex,
  selectTable,
} from "../plugins/tableCommands";
import { TableControlButton } from "./TableControlButton";

type RelativeRect = {
  left: number;
  top: number;
  width: number;
  height: number;
};

type RelativePoint = {
  left: number;
  top: number;
};

type RowControl = RelativeRect & {
  index: number;
  cellPosition: number;
  selected: boolean;
};

type ColumnControl = RelativeRect & {
  index: number;
  cellPosition: number;
  selected: boolean;
};

type AddRowControl = {
  index: number;
  cellPosition: number;
  left: number;
  top: number;
  width: number;
};

type AddColumnControl = {
  index: number;
  cellPosition: number;
  left: number;
  top: number;
  height: number;
};

type SelectionAction = {
  type: "row" | "column" | "table";
  label: string;
  left: number;
  top: number;
  tablePos: number;
  fromIndex?: number;
  toIndex?: number;
  cellPosition?: number;
};

type PinnedSelectionAction = SelectionAction & {
  expiresAt: number;
};

type TableOverlayModel = {
  key: string;
  tablePos: number;
  tableRect: RelativeRect;
  tableCellPosition: number;
  rowControls: RowControl[];
  columnControls: ColumnControl[];
  addRowControls: AddRowControl[];
  addColumnControls: AddColumnControl[];
  tableSelected: boolean;
  active: boolean;
  selectionAction: SelectionAction | null;
};

type Props = {
  view: EditorView | null;
  rootRef: React.RefObject<HTMLElement>;
  readonly?: boolean;
  updateVersion: number;
};

const rowActionLabel = (count: number) => (count > 1 ? "删除所选行" : "删除行");
const columnActionLabel = (count: number) => (count > 1 ? "删除所选列" : "删除列");

const toRelativeRect = (rect: DOMRect, rootRect: DOMRect): RelativeRect => ({
  left: rect.left - rootRect.left,
  top: rect.top - rootRect.top,
  width: rect.width,
  height: rect.height,
});

const selectedRectForSelection = (state: EditorState, selection: CellSelection) =>
  selectedRect({ ...state, selection } as unknown as EditorState);

const getSelectedStateForTable = (state: EditorState, tableStart: number, tableEnd: number) => {
  const selection = state.selection;
  if (!(selection instanceof CellSelection) || selection.$anchorCell.pos < tableStart || selection.$anchorCell.pos > tableEnd) {
    return null;
  }

  const rect = selectedRectForSelection(state, selection);
  const isCompleteTableSelection = rect.top === 0 && rect.left === 0 && rect.bottom === rect.map.height && rect.right === rect.map.width;
  const isFullRowSelection = rect.left === 0 && rect.right === rect.map.width;
  const isFullColumnSelection = rect.top === 0 && rect.bottom === rect.map.height;
  return {
    rect,
    isTable: isCompleteTableSelection,
    isRow: isFullRowSelection && !isCompleteTableSelection,
    isColumn: isFullColumnSelection && !isCompleteTableSelection,
  };
};

const getTableNodeDom = (view: EditorView, tablePos: number): HTMLTableElement | null => {
  const dom = view.nodeDOM(tablePos);
  if (dom instanceof HTMLTableElement) {
    return dom;
  }

  if (dom instanceof HTMLElement) {
    return dom.querySelector("table");
  }

  return null;
};

const getNodeRect = (view: EditorView, pos: number, rootRect: DOMRect): RelativeRect | null => {
  const dom = view.nodeDOM(pos);
  if (!(dom instanceof HTMLElement)) {
    return null;
  }
  return toRelativeRect(dom.getBoundingClientRect(), rootRect);
};

const buildTableOverlayModels = (
  view: EditorView | null,
  root: HTMLElement | null,
  readonly?: boolean,
  hoverPoint?: RelativePoint | null,
): TableOverlayModel[] => {
  if (!view || !root || readonly) {
    return [];
  }

  const state = view.state;
  const rootRect = root.getBoundingClientRect();
  const models: TableOverlayModel[] = [];

  state.doc.descendants((node, tablePos) => {
    if (node.type.spec.tableRole !== "table") {
      return true;
    }

    const tableDom = getTableNodeDom(view, tablePos);
    if (!tableDom) {
      return false;
    }

    const map = TableMap.get(node);
    if (map.width === 0 || map.height === 0) {
      return false;
    }

    const tableRect = toRelativeRect(tableDom.getBoundingClientRect(), rootRect);
    const hoverPaddingX = 24;
    const hoverPaddingY = 12;
    const hoverActive = Boolean(
      hoverPoint &&
        hoverPoint.left >= tableRect.left - hoverPaddingX &&
        hoverPoint.left <= tableRect.left + tableRect.width + hoverPaddingX &&
        hoverPoint.top >= tableRect.top - hoverPaddingY &&
        hoverPoint.top <= tableRect.top + tableRect.height + hoverPaddingY,
    );
    const tableStart = tablePos + 1;
    const tableEnd = tableStart + node.nodeSize - 2;
    const selectedState = getSelectedStateForTable(state, tableStart, tableEnd);
    const tableCellPosition = tableStart + map.map[0];
    const rowControls: RowControl[] = [];
    const columnControls: ColumnControl[] = [];
    const addRowControls: AddRowControl[] = [];
    const addColumnControls: AddColumnControl[] = [];

    for (let rowIndex = 0; rowIndex < map.height; rowIndex += 1) {
      const cellPosition = getTableCellPosition(state, tablePos, rowIndex, 0);
      const rowElement = tableDom.rows.item(rowIndex);
      if (cellPosition === null || !rowElement) {
        continue;
      }

      const rowRect = toRelativeRect(rowElement.getBoundingClientRect(), rootRect);
      const selected = Boolean(
        selectedState?.isTable || (selectedState?.isRow && selectedState.rect.top <= rowIndex && selectedState.rect.bottom > rowIndex),
      );
      rowControls.push({
        index: rowIndex,
        cellPosition,
        selected,
        left: tableRect.left - 14,
        top: rowRect.top,
        width: 14,
        height: rowRect.height,
      });
    }

    for (let rowBoundary = 0; rowBoundary <= map.height; rowBoundary += 1) {
      const sourceRow = Math.min(rowBoundary, map.height - 1);
      const cellPosition = getTableCellPosition(state, tablePos, sourceRow, 0);
      const boundaryElement = tableDom.rows.item(rowBoundary === 0 ? 0 : rowBoundary - 1);
      if (cellPosition === null || !boundaryElement) {
        continue;
      }

      const boundaryRect = boundaryElement.getBoundingClientRect();
      addRowControls.push({
        index: rowBoundary,
        cellPosition,
        left: tableRect.left,
        top: rowBoundary === 0 ? boundaryRect.top - rootRect.top - 6 : boundaryRect.bottom - rootRect.top - 6,
        width: tableRect.width,
      });
    }

    for (let columnIndex = 0; columnIndex < map.width; columnIndex += 1) {
      const cellPosition = getTableCellPosition(state, tablePos, 0, columnIndex);
      if (cellPosition === null) {
        continue;
      }

      const columnRect = getNodeRect(view, cellPosition, rootRect);
      if (!columnRect) {
        continue;
      }

      const selected = Boolean(
        selectedState?.isTable ||
          (selectedState?.isColumn && selectedState.rect.left <= columnIndex && selectedState.rect.right > columnIndex),
      );
      columnControls.push({
        index: columnIndex,
        cellPosition,
        selected,
        left: columnRect.left,
        top: tableRect.top - 14,
        width: columnRect.width,
        height: 14,
      });
    }

    for (let columnBoundary = 0; columnBoundary <= map.width; columnBoundary += 1) {
      const sourceColumn = Math.min(columnBoundary, map.width - 1);
      const cellPosition = getTableCellPosition(state, tablePos, 0, sourceColumn);
      if (cellPosition === null) {
        continue;
      }

      const columnRect = getNodeRect(view, cellPosition, rootRect);
      if (!columnRect) {
        continue;
      }

      addColumnControls.push({
        index: columnBoundary,
        cellPosition,
        left: columnBoundary === map.width ? columnRect.left + columnRect.width - 10 : columnRect.left - 10,
        top: tableRect.top,
        height: tableRect.height,
      });
    }

    let selectionAction: SelectionAction | null = null;
    const actionTop = Math.max(0, tableRect.top - 38);
    if (selectedState?.isTable || isTableSelected(state)) {
      selectionAction = {
        type: "table",
        label: "删除表格",
        left: tableRect.left,
        top: actionTop,
        tablePos,
      };
    } else if (selectedState?.isColumn) {
      selectionAction = {
        type: "column",
        label: columnActionLabel(selectedState.rect.right - selectedState.rect.left),
        left: tableRect.left,
        top: actionTop,
        tablePos,
        fromIndex: selectedState.rect.left,
        toIndex: selectedState.rect.right - 1,
        cellPosition: tableCellPosition,
      };
    } else if (selectedState?.isRow) {
      selectionAction = {
        type: "row",
        label: rowActionLabel(selectedState.rect.bottom - selectedState.rect.top),
        left: tableRect.left,
        top: actionTop,
        tablePos,
        fromIndex: selectedState.rect.top,
        toIndex: selectedState.rect.bottom - 1,
        cellPosition: tableCellPosition,
      };
    }

    models.push({
      key: `${tablePos}-${node.nodeSize}`,
      tablePos,
      tableRect,
      tableCellPosition,
      rowControls,
      columnControls,
      addRowControls,
      addColumnControls,
      tableSelected: Boolean(selectedState?.isTable),
      active: hoverActive || Boolean(selectedState),
      selectionAction,
    });

    return false;
  });

  return models;
};

const stopControlEvent = (event: React.MouseEvent | React.PointerEvent) => {
  event.preventDefault();
  event.stopPropagation();
};

const refocusEditor = (view: EditorView) => {
  view.focus();
  window.requestAnimationFrame(() => view.focus());
  window.setTimeout(() => view.focus(), 0);
};

const PINNED_SELECTION_ACTION_TTL = 1200;

export const TableControlsOverlay = ({ view, rootRef, readonly, updateVersion }: Props) => {
  const [models, setModels] = useState<TableOverlayModel[]>([]);
  const [hoverPoint, setHoverPoint] = useState<RelativePoint | null>(null);
  const pinnedSelectionActionRef = useRef<PinnedSelectionAction | null>(null);

  const update = useCallback(() => {
    const nextModels = buildTableOverlayModels(view, rootRef.current, readonly, hoverPoint).map((model) => {
      const pinnedSelectionAction = pinnedSelectionActionRef.current;
      if (
        pinnedSelectionAction &&
        pinnedSelectionAction.tablePos === model.tablePos &&
        pinnedSelectionAction.expiresAt > Date.now() &&
        !model.selectionAction
      ) {
        return { ...model, active: true, selectionAction: pinnedSelectionAction };
      }
      return model;
    });

    const pinnedSelectionAction = pinnedSelectionActionRef.current;
    if (pinnedSelectionAction && pinnedSelectionAction.expiresAt <= Date.now()) {
      pinnedSelectionActionRef.current = null;
    }

    setModels(nextModels);
  }, [hoverPoint, readonly, rootRef, view]);

  useLayoutEffect(() => {
    update();
  }, [update, updateVersion]);

  useEffect(() => {
    if (!view || readonly) {
      setModels([]);
      return;
    }

    let frame = 0;
    const scheduleUpdate = () => {
      window.cancelAnimationFrame(frame);
      frame = window.requestAnimationFrame(update);
    };
    const handleMouseMove = (event: MouseEvent) => {
      const root = rootRef.current;
      if (!root) {
        return;
      }
      const rootRect = root.getBoundingClientRect();
      setHoverPoint({ left: event.clientX - rootRect.left, top: event.clientY - rootRect.top });
      scheduleUpdate();
    };
    const handleMouseLeave = () => {
      setHoverPoint(null);
      scheduleUpdate();
    };

    scheduleUpdate();
    const root = rootRef.current;
    window.addEventListener("resize", scheduleUpdate);
    window.addEventListener("scroll", scheduleUpdate, true);
    root?.addEventListener("mousemove", handleMouseMove);
    root?.addEventListener("mouseleave", handleMouseLeave);

    return () => {
      window.cancelAnimationFrame(frame);
      window.removeEventListener("resize", scheduleUpdate);
      window.removeEventListener("scroll", scheduleUpdate, true);
      root?.removeEventListener("mousemove", handleMouseMove);
      root?.removeEventListener("mouseleave", handleMouseLeave);
    };
  }, [readonly, update, view]);

  const pinSelectionAction = useCallback(
    (action: Omit<SelectionAction, "left" | "top">) => {
      const root = rootRef.current;
      if (!view || !root) {
        return;
      }

      const tableDom = getTableNodeDom(view, action.tablePos);
      if (!tableDom) {
        return;
      }

      const rootRect = root.getBoundingClientRect();
      const tableRect = toRelativeRect(tableDom.getBoundingClientRect(), rootRect);
      pinnedSelectionActionRef.current = {
        ...action,
        left: tableRect.left,
        top: Math.max(0, tableRect.top - 38),
        expiresAt: Date.now() + PINNED_SELECTION_ACTION_TTL,
      };
    },
    [rootRef, view],
  );

  const runCommand = useCallback(
    (
      command: ReturnType<typeof addRowBeforeIndex>,
      event: React.MouseEvent | React.PointerEvent,
      pinnedAction?: Omit<SelectionAction, "left" | "top">,
    ) => {
      stopControlEvent(event);
      if (!view) {
        return;
      }
      command(view.state, view.dispatch, view);
      if (pinnedAction) {
        pinSelectionAction(pinnedAction);
      }
      refocusEditor(view);
      update();
      window.requestAnimationFrame(update);
      window.setTimeout(update, 0);
    },
    [pinSelectionAction, update, view],
  );

  const deleteSelection = useCallback(
    (action: SelectionAction, event: React.MouseEvent | React.PointerEvent) => {
      stopControlEvent(event);
      if (!view) {
        return;
      }

      const command =
        action.type === "row"
          ? action.fromIndex === undefined || action.toIndex === undefined
            ? deleteRowSelection()
            : deleteRowRange({ fromIndex: action.fromIndex, toIndex: action.toIndex, cellPosition: action.cellPosition })
          : action.type === "column"
            ? action.fromIndex === undefined || action.toIndex === undefined
              ? deleteColSelection()
              : deleteColumnRange({ fromIndex: action.fromIndex, toIndex: action.toIndex, cellPosition: action.cellPosition })
            : deleteTableAtPosition(action.tablePos);
      pinnedSelectionActionRef.current = null;
      command(view.state, view.dispatch, view);
      refocusEditor(view);
      update();
      window.requestAnimationFrame(update);
      window.setTimeout(update, 0);
    },
    [update, view],
  );

  useEffect(() => {
    if (!view || readonly) {
      return;
    }

    const root = rootRef.current;
    if (!root) {
      return;
    }

    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.defaultPrevented || (event.key !== "Backspace" && event.key !== "Delete")) {
        return;
      }

      const pinnedSelectionAction = pinnedSelectionActionRef.current;
      const action =
        pinnedSelectionAction && pinnedSelectionAction.expiresAt > Date.now()
          ? pinnedSelectionAction
          : models.find((model) => model.selectionAction)?.selectionAction;
      const command =
        action?.type === "row"
          ? action.fromIndex === undefined || action.toIndex === undefined
            ? deleteRowSelection()
            : deleteRowRange({ fromIndex: action.fromIndex, toIndex: action.toIndex, cellPosition: action.cellPosition })
          : action?.type === "column"
            ? action.fromIndex === undefined || action.toIndex === undefined
              ? deleteColSelection()
              : deleteColumnRange({ fromIndex: action.fromIndex, toIndex: action.toIndex, cellPosition: action.cellPosition })
            : action?.type === "table"
              ? deleteTableAtPosition(action.tablePos)
              : deleteSelectedTablePart;

      if (!command(view.state, view.dispatch, view)) {
        return;
      }

      pinnedSelectionActionRef.current = null;
      event.preventDefault();
      event.stopPropagation();
      refocusEditor(view);
      update();
      window.requestAnimationFrame(update);
      window.setTimeout(update, 0);
    };

    root.addEventListener("keydown", handleKeyDown, true);
    return () => root.removeEventListener("keydown", handleKeyDown, true);
  }, [models, readonly, rootRef, update, view]);

  const renderedModels = useMemo(() => models.filter((model) => model.tableRect.width > 0 && model.tableRect.height > 0), [models]);

  if (readonly || renderedModels.length === 0) {
    return null;
  }

  return (
    <div className="table-controls-overlay" aria-hidden="false">
      {renderedModels.map((model) => (
        <div key={model.key} className={`table-controls-layer${model.active ? " active" : ""}`}>
          <TableControlButton
            className={`table-overlay-handle table-overlay-table-handle${model.tableSelected ? " selected" : ""}`}
            label="选择表格"
            style={{ left: model.tableRect.left - 16, top: model.tableRect.top - 16 }}
            onPointerDown={(event) =>
              runCommand(selectTable(model.tableCellPosition), event, {
                type: "table",
                label: "删除表格",
                tablePos: model.tablePos,
                cellPosition: model.tableCellPosition,
              })
            }
          />

          {model.rowControls.map((row) => (
            <TableControlButton
              key={`row-${model.tablePos}-${row.index}`}
              className={`table-overlay-handle table-overlay-row-handle${row.selected ? " selected" : ""}`}
              label="选择行"
              style={{ left: row.left, top: row.top, width: row.width, height: row.height }}
              onPointerDown={(event) =>
                runCommand(selectRowAtIndex(row.index, event.shiftKey || event.metaKey, row.cellPosition), event, {
                  type: "row",
                  label: rowActionLabel(1),
                  tablePos: model.tablePos,
                  fromIndex: row.index,
                  toIndex: row.index,
                  cellPosition: row.cellPosition,
                })
              }
            />
          ))}

          {model.columnControls.map((column) => (
            <TableControlButton
              key={`column-${model.tablePos}-${column.index}`}
              className={`table-overlay-handle table-overlay-column-handle${column.selected ? " selected" : ""}`}
              label="选择列"
              style={{ left: column.left, top: column.top, width: column.width, height: column.height }}
              onPointerDown={(event) =>
                runCommand(selectColumnAtIndex(column.index, event.shiftKey || event.metaKey, column.cellPosition), event, {
                  type: "column",
                  label: columnActionLabel(1),
                  tablePos: model.tablePos,
                  fromIndex: column.index,
                  toIndex: column.index,
                  cellPosition: column.cellPosition,
                })
              }
            />
          ))}

          {model.addRowControls.map((row) => (
            <TableControlButton
              key={`add-row-${model.tablePos}-${row.index}`}
              className="table-overlay-add table-overlay-add-row"
              label="插入行"
              style={{ left: row.left, top: row.top, width: row.width }}
              onPointerDown={(event) => runCommand(addRowBeforeIndex({ index: row.index, cellPosition: row.cellPosition }), event)}
            />
          ))}

          {model.addColumnControls.map((column) => (
            <TableControlButton
              key={`add-column-${model.tablePos}-${column.index}`}
              className="table-overlay-add table-overlay-add-column"
              label="插入列"
              style={{ left: column.left, top: column.top, height: column.height }}
              onPointerDown={(event) => runCommand(addColumnBeforeIndex({ index: column.index, cellPosition: column.cellPosition }), event)}
            />
          ))}

          {model.selectionAction && (
            <TableControlButton
              className={`table-overlay-delete table-overlay-delete-${model.selectionAction.type}`}
              label={model.selectionAction.label}
              style={{ left: model.selectionAction.left, top: model.selectionAction.top }}
              onPointerDown={(event) => deleteSelection(model.selectionAction!, event)}
            >
              {model.selectionAction.label}
            </TableControlButton>
          )}
        </div>
      ))}
    </div>
  );
};
