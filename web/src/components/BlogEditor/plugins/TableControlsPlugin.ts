import { chainCommands, splitBlock } from "prosemirror-commands";
import type { Attrs, Node as ProseMirrorNode, ResolvedPos } from "prosemirror-model";
import { Slice } from "prosemirror-model";
import type { Command } from "prosemirror-state";
import { EditorState, Plugin, PluginKey, TextSelection } from "prosemirror-state";
import { columnResizing, goToNextCell, tableEditing } from "prosemirror-tables";
import { DecorationSet, type EditorView, type ViewMutationRecord } from "prosemirror-view";
import { isCompositionTransaction, isViewComposing } from "./CompositionGuardPlugin";
import {
  deleteSelectedTablePart,
  enterNearTableGapCursor,
  insertTextNearTableBoundary,
  moveOutOfTable,
  moveToAdjacentSelectedCell,
  typeTextNearTableGapCursor,
} from "./tableCommands";

type MutableAttrs = Record<string, unknown>;

const tableControlStatePluginKey = new PluginKey<DecorationSet>("tableControlsState");

export const isInTableCell = (state: Parameters<Command>[0]) => {
  const { $from } = state.selection;
  for (let depth = $from.depth; depth > 0; depth -= 1) {
    const role = $from.node(depth).type.spec.tableRole;
    if (role === "cell" || role === "header_cell") {
      return true;
    }
    if (role === "table") {
      return false;
    }
  }
  return false;
};

const getTableCellDepth = ($pos: ResolvedPos) => {
  for (let depth = $pos.depth; depth > 0; depth -= 1) {
    const role = $pos.node(depth).type.spec.tableRole;
    if (role === "cell" || role === "header_cell") {
      return depth;
    }
    if (role === "table") {
      return null;
    }
  }
  return null;
};

const selectionIsInsideSingleTableCell = (state: Parameters<Command>[0]) => {
  const { $from, $to } = state.selection;
  const fromCellDepth = getTableCellDepth($from);
  const toCellDepth = getTableCellDepth($to);
  return fromCellDepth !== null && toCellDepth !== null && $from.before(fromCellDepth) === $to.before(toCellDepth);
};

export const pastePlainTextIntoTableCell = (view: EditorView, text: string) => {
  if (!text || !selectionIsInsideSingleTableCell(view.state)) {
    return false;
  }

  view.dispatch(view.state.tr.insertText(text).scrollIntoView().setMeta("paste", true).setMeta("uiEvent", "paste"));
  return true;
};

const splitBlockInTableCell: Command = (state, dispatch) => {
  if (!isInTableCell(state)) {
    return false;
  }
  return splitBlock(state, dispatch);
};

const isCompositionTextInputType = (inputType: string) => inputType === "insertCompositionText" || inputType === "insertFromComposition";

const shouldLetCompositionInputPassThrough = (view: EditorView, event: InputEvent) =>
  event.isComposing || isViewComposing(view) || isCompositionTextInputType(event.inputType);

const getTextFromTextInputEvent = (event: InputEvent) => {
  if (event.inputType === "insertText" || event.inputType === "insertReplacementText") {
    return event.data || "";
  }
  return "";
};

const normalizePlainText = (text: string) => text.replace(/\s+/g, "");

const getEditableDomText = (element: HTMLElement) => {
  const clone = element.cloneNode(true) as HTMLElement;
  clone
    .querySelectorAll("[contenteditable='false'], [contenteditable=false], .ProseMirror-widget, button, input, textarea, select")
    .forEach((node) => node.remove());
  clone.querySelectorAll("*").forEach((node) => {
    if (node instanceof HTMLElement && node.contentEditable === "false") {
      node.remove();
    }
  });
  return clone.textContent || "";
};

const getEditableNodeText = (node: ProseMirrorNode) => {
  let text = "";
  node.descendants((child) => {
    if (child.isText) {
      text += child.text || "";
      return false;
    }
    if (child.isAtom || child.type.spec.tableRole === "table") {
      return false;
    }
    return true;
  });
  return text;
};

const getSelectedTableCell = (state: Parameters<Command>[0]) => {
  if (!selectionIsInsideSingleTableCell(state)) {
    return null;
  }

  const depth = getTableCellDepth(state.selection.$from);
  if (depth === null) {
    return null;
  }

  const position = state.selection.$from.before(depth);
  const node = state.selection.$from.node(depth);
  return { position, node };
};

const getCellDom = (view: EditorView, position: number, eventTarget?: EventTarget | null) => {
  const targetElement = eventTarget instanceof Element ? eventTarget : null;
  const targetCell = targetElement?.closest("td, th");
  if (targetCell instanceof HTMLElement && view.dom.contains(targetCell)) {
    return targetCell;
  }

  const dom = view.nodeDOM(position);
  if (dom instanceof HTMLElement && (dom.matches("td, th") || dom.closest("td, th"))) {
    const cell = dom.matches("td, th") ? dom : dom.closest<HTMLElement>("td, th");
    return cell && view.dom.contains(cell) ? cell : null;
  }

  const selectionDom = view.domAtPos(view.state.selection.from).node;
  const selectionElement = selectionDom instanceof Element ? selectionDom : selectionDom.parentElement;
  const selectionCell = selectionElement?.closest("td, th");
  return selectionCell instanceof HTMLElement && view.dom.contains(selectionCell) ? selectionCell : null;
};

const inferNativeInsertedText = (previousText: string, currentText: string) => {
  const previous = normalizePlainText(previousText);
  const current = normalizePlainText(currentText);
  if (!current || current === previous) {
    return "";
  }
  if (current.startsWith(previous)) {
    return current.slice(previous.length);
  }

  let start = 0;
  while (start < previous.length && start < current.length && previous[start] === current[start]) {
    start += 1;
  }

  let previousEnd = previous.length;
  let currentEnd = current.length;
  while (previousEnd > start && currentEnd > start && previous[previousEnd - 1] === current[currentEnd - 1]) {
    previousEnd -= 1;
    currentEnd -= 1;
  }

  return current.slice(start, currentEnd);
};

const inferInsertedTextFromNativeInput = (
  view: EditorView,
  selectedCell: { position: number; node: ProseMirrorNode },
  eventTarget?: EventTarget | null,
) => {
  const cellDom = getCellDom(view, selectedCell.position, eventTarget);
  if (cellDom) {
    return inferNativeInsertedText(getEditableNodeText(selectedCell.node), getEditableDomText(cellDom));
  }

  return inferNativeInsertedText(view.state.doc.textContent, view.dom.textContent || "");
};

const handleNativeInputInTableCell = (view: EditorView, event: Event) => {
  const selectedCell = getSelectedTableCell(view.state);
  if (!selectedCell) {
    return false;
  }

  const inputEvent = event as InputEvent;
  if (shouldLetCompositionInputPassThrough(view, inputEvent)) {
    return false;
  }

  const text = inferInsertedTextFromNativeInput(view, selectedCell, event.target);
  if (!text) {
    return false;
  }

  const tr = view.state.tr.insertText(text).scrollIntoView();
  const nextState = view.state.apply(tr);
  const resetState = EditorState.create({
    doc: nextState.doc,
    selection: nextState.selection,
    schema: nextState.schema,
    plugins: nextState.plugins,
  });
  view.updateState(resetState);

  event.stopPropagation();
  event.stopImmediatePropagation();
  return true;
};

const positionIsInTableCell = ($pos: ResolvedPos) => {
  for (let depth = $pos.depth; depth > 0; depth -= 1) {
    const role = $pos.node(depth).type.spec.tableRole;
    if (role === "cell" || role === "header_cell") {
      return true;
    }
    if (role === "table") {
      return false;
    }
  }
  return false;
};

const getTextSelectionInsideClickedCell = (view: EditorView, event: MouseEvent, cell: HTMLElement) => {
  const posAtPointer = view.posAtCoords({ left: event.clientX, top: event.clientY });
  if (posAtPointer) {
    const $pointer = view.state.doc.resolve(posAtPointer.pos);
    if (positionIsInTableCell($pointer)) {
      return TextSelection.near($pointer, posAtPointer.inside === -1 ? 1 : -1);
    }
  }

  const target = event.target instanceof Element ? event.target : document.elementFromPoint(event.clientX, event.clientY);
  const textBlock = target?.closest("p, h1, h2, h3, h4, h5, h6, pre") ?? cell.querySelector("p, h1, h2, h3, h4, h5, h6, pre");
  const positionTarget = textBlock instanceof Element ? textBlock : cell;
  const pos = view.posAtDOM(positionTarget, positionTarget.childNodes.length);
  const $dom = view.state.doc.resolve(pos);
  if (!positionIsInTableCell($dom)) {
    return null;
  }
  return TextSelection.near($dom, -1);
};

const selectTextInsideClickedTableCell = (view: EditorView, event: MouseEvent) => {
  if (event.button !== 0 || event.shiftKey || event.ctrlKey || event.metaKey || event.altKey) {
    return false;
  }

  const target = event.target instanceof Element ? event.target : null;
  const pointerTarget = document.elementFromPoint(event.clientX, event.clientY);
  const cell = [pointerTarget, target]
    .map((element) => element?.closest(".blog-editor-content th, .blog-editor-content td"))
    .find((element): element is HTMLElement => element instanceof HTMLElement && view.dom.contains(element));
  if (!cell) {
    return false;
  }

  const selection = getTextSelectionInsideClickedCell(view, event, cell);
  if (!selection) {
    return false;
  }

  event.preventDefault();
  event.stopPropagation();
  view.dispatch(view.state.tr.setSelection(selection));
  view.focus();
  return true;
};

const createTableControlStatePlugin = () =>
  new Plugin<DecorationSet>({
    key: tableControlStatePluginKey,
    state: {
      init: () => DecorationSet.empty,
      apply(tr, decorationSet) {
        if (isCompositionTransaction(tr)) {
          return decorationSet.map(tr.mapping, tr.doc);
        }
        return DecorationSet.empty;
      },
    },
    props: {
      decorations: (state) => tableControlStatePluginKey.getState(state) ?? null,
      handlePaste(view, event) {
        const text = event.clipboardData?.getData("text/plain") ?? "";
        if (!pastePlainTextIntoTableCell(view, text)) {
          return false;
        }
        event.preventDefault();
        return true;
      },
      handleDOMEvents: {
        beforeinput(view, event) {
          const inputEvent = event as InputEvent;
          if ((inputEvent.inputType === "insertParagraph" || inputEvent.inputType === "insertLineBreak") && isInTableCell(view.state)) {
            event.preventDefault();
            if (inputEvent.isComposing || isViewComposing(view)) {
              return true;
            }
            return splitBlockInTableCell(view.state, view.dispatch, view);
          }

          const text = shouldLetCompositionInputPassThrough(view, inputEvent) ? "" : getTextFromTextInputEvent(inputEvent);
          if (insertTextNearTableBoundary(text)(view.state, view.dispatch, view)) {
            event.preventDefault();
            return true;
          }

          return false;
        },
        input(view, event) {
          return handleNativeInputInTableCell(view, event);
        },
        mousedown(view, event) {
          return selectTextInsideClickedTableCell(view, event);
        },
        click(view, event) {
          return selectTextInsideClickedTableCell(view, event);
        },
      },
      handleKeyDown(view, event) {
        if (event.shiftKey || event.ctrlKey || event.metaKey || event.altKey) {
          return false;
        }

        const command =
          event.key === "ArrowDown"
            ? moveToAdjacentSelectedCell("vert", 1)
            : event.key === "ArrowUp"
              ? moveToAdjacentSelectedCell("vert", -1)
              : event.key === "ArrowLeft"
                ? moveToAdjacentSelectedCell("horiz", -1)
                : event.key === "ArrowRight"
                  ? moveToAdjacentSelectedCell("horiz", 1)
                  : null;
        if (!command || !command(view.state, view.dispatch, view)) {
          return false;
        }

        event.preventDefault();
        return true;
      },
      handleKeyPress(view, event) {
        if (event.isComposing || isViewComposing(view)) {
          return false;
        }
        const text = event.key.length === 1 && !event.ctrlKey && !event.metaKey && !event.altKey ? event.key : "";
        return insertTextNearTableBoundary(text)(view.state, view.dispatch, view);
      },
      handleTextInput(view, _from, _to, text) {
        if (isViewComposing(view)) {
          return false;
        }
        return typeTextNearTableGapCursor(text)(view.state, view.dispatch, view);
      },
    },
  });

class BlogEditorTableView {
  dom: HTMLDivElement;
  table: HTMLTableElement;
  colgroup: HTMLTableColElement;
  contentDOM: HTMLTableSectionElement;

  constructor(
    private node: ProseMirrorNode,
    private defaultCellMinWidth: number,
  ) {
    this.dom = document.createElement("div");
    this.dom.className = "tableWrapper";
    this.table = this.dom.appendChild(document.createElement("table"));
    this.table.style.setProperty("--default-cell-min-width", `${defaultCellMinWidth}px`);
    this.colgroup = this.table.appendChild(document.createElement("colgroup"));
    this.updateColumnsOnResize(node);
    this.contentDOM = this.table.appendChild(document.createElement("tbody"));
  }

  update(node: ProseMirrorNode) {
    if (node.type !== this.node.type) {
      return false;
    }

    this.node = node;
    this.updateColumnsOnResize(node);
    return true;
  }

  ignoreMutation(record: ViewMutationRecord) {
    if (record.type === "selection") {
      return true;
    }

    const mutation = record as MutationRecord;
    if (
      mutation.type === "attributes" &&
      mutation.target === this.dom &&
      (mutation.attributeName === "class" || mutation.attributeName === "style")
    ) {
      return true;
    }

    return (
      (mutation.type === "attributes" && (mutation.target === this.table || this.colgroup.contains(mutation.target))) ||
      (mutation.type === "childList" &&
        mutation.target === this.table &&
        Array.from(mutation.addedNodes).every((node) => node === this.colgroup))
    );
  }

  private updateColumnsOnResize(node: ProseMirrorNode) {
    let totalWidth = 0;
    let fixedWidth = true;
    let nextDOM = this.colgroup.firstElementChild as HTMLTableColElement | null;
    const row = node.firstChild;
    if (!row) {
      return;
    }

    for (let i = 0; i < row.childCount; i += 1) {
      const { colspan, colwidth } = row.child(i).attrs;
      for (let j = 0; j < colspan; j += 1) {
        const hasWidth = Array.isArray(colwidth) ? colwidth[j] : undefined;
        const cssWidth = hasWidth ? `${hasWidth}px` : "";
        totalWidth += hasWidth || this.defaultCellMinWidth;
        if (!hasWidth) {
          fixedWidth = false;
        }

        if (!nextDOM) {
          const colElement = document.createElement("col");
          colElement.style.width = cssWidth;
          this.colgroup.appendChild(colElement);
        } else {
          if (nextDOM.style.width !== cssWidth) {
            nextDOM.style.width = cssWidth;
          }
          nextDOM = nextDOM.nextElementSibling as HTMLTableColElement | null;
        }
      }
    }

    while (nextDOM) {
      const after = nextDOM.nextElementSibling as HTMLTableColElement | null;
      nextDOM.parentNode?.removeChild(nextDOM);
      nextDOM = after;
    }

    if (fixedWidth) {
      this.table.style.width = `${totalWidth}px`;
      this.table.style.minWidth = "";
      return;
    }

    this.table.style.width = "";
    this.table.style.minWidth = `${totalWidth}px`;
  }
}

const createTableCellCopyTransformPlugin = () =>
  new Plugin({
    key: new PluginKey("table-cell-copy-transform"),
    props: {
      transformCopied: (slice) => {
        const table = slice.content.childCount === 1 ? slice.content.firstChild : null;
        if (table?.type.spec.tableRole !== "table" || table.childCount !== 1) {
          return slice;
        }

        const row = table.firstChild;
        if (row?.type.spec.tableRole !== "row" || row.childCount !== 1) {
          return slice;
        }

        const cell = row.firstChild;
        if (cell?.type.spec.tableRole !== "cell") {
          return slice;
        }

        return new Slice(cell.content, slice.openStart, slice.openEnd);
      },
    },
  });

export const createTablePlugins = (_options: { isEditable: () => boolean }) => [
  createTableControlStatePlugin(),
  createTableCellCopyTransformPlugin(),
  columnResizing({ View: BlogEditorTableView }),
  tableEditing(),
];

export const tableKeymap: Record<string, Command> = {
  Tab: goToNextCell(1),
  "Shift-Tab": goToNextCell(-1),
  Backspace: deleteSelectedTablePart,
  Delete: deleteSelectedTablePart,
  ArrowDown: moveToAdjacentSelectedCell("vert", 1),
  ArrowUp: moveToAdjacentSelectedCell("vert", -1),
  ArrowLeft: moveToAdjacentSelectedCell("horiz", -1),
  ArrowRight: moveToAdjacentSelectedCell("horiz", 1),
  Enter: chainCommands(enterNearTableGapCursor, splitBlockInTableCell),
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
