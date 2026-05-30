import type { Attrs, Node as ProseMirrorNode } from "prosemirror-model";
import type { Command } from "prosemirror-state";
import { Plugin, PluginKey, TextSelection } from "prosemirror-state";
import { columnResizing, goToNextCell, tableEditing } from "prosemirror-tables";
import { DecorationSet, type EditorView, type ViewMutationRecord } from "prosemirror-view";
import { isCompositionTransaction } from "./CompositionGuardPlugin";
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

const selectTextInsideClickedTableCell = (view: EditorView, event: MouseEvent) => {
  if (event.button !== 0 || event.shiftKey || event.ctrlKey || event.metaKey || event.altKey) {
    return false;
  }

  const target = event.target instanceof Element ? event.target : document.elementFromPoint(event.clientX, event.clientY);
  const cell = target?.closest(".blog-editor-content th, .blog-editor-content td");
  if (!(cell instanceof HTMLElement) || !view.dom.contains(cell)) {
    return false;
  }

  const cellContentStart = view.posAtDOM(cell, 0);
  const cellPosition = cellContentStart - 1;
  const cellNode = view.state.doc.nodeAt(cellPosition);
  const role = cellNode?.type.spec.tableRole;
  if (!cellNode || (role !== "cell" && role !== "header_cell")) {
    return false;
  }

  event.preventDefault();
  event.stopPropagation();
  const posAtPointer = view.posAtCoords({ left: event.clientX, top: event.clientY });
  const rawTextOffset = posAtPointer ? posAtPointer.pos - cellContentStart : 0;
  const textOffset = Math.max(0, Math.min(rawTextOffset, cellNode.content.size));
  const selection = TextSelection.near(view.state.doc.resolve(cellContentStart + textOffset), 1);
  view.dispatch(view.state.tr.setSelection(selection).scrollIntoView());
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
      handleDOMEvents: {
        beforeinput(view, event) {
          const inputEvent = event as InputEvent;
          const text =
            inputEvent.inputType === "insertText" || inputEvent.inputType === "insertCompositionText" ? inputEvent.data || "" : "";
          if (!insertTextNearTableBoundary(text)(view.state, view.dispatch, view)) {
            return false;
          }

          event.preventDefault();
          return true;
        },
        mousedown(view, event) {
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
        const text = event.key.length === 1 && !event.ctrlKey && !event.metaKey && !event.altKey ? event.key : "";
        return insertTextNearTableBoundary(text)(view.state, view.dispatch, view);
      },
      handleTextInput(view, _from, _to, text) {
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

export const createTablePlugins = (_options: { isEditable: () => boolean }) => [
  createTableControlStatePlugin(),
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
  Enter: enterNearTableGapCursor,
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
