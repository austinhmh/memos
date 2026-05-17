import { toggleMark as pmToggleMark } from "prosemirror-commands";
import type { MarkType } from "prosemirror-model";
import type { EditorState } from "prosemirror-state";
import { TextSelection } from "prosemirror-state";
import type { EditorView } from "prosemirror-view";
import React, { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { cn } from "@/lib/utils";
import { isViewComposing } from "../plugins/CompositionGuardPlugin";

type SelectionToolbarState = {
  visible: boolean;
  top: number;
  left: number;
  bold: boolean;
  italic: boolean;
  underline: boolean;
  strike: boolean;
  highlightColor: string | null;
  textColor: string | null;
};

type SelectionToolbarProps = {
  view: EditorView | null;
  readonly?: boolean;
  updateVersion?: number;
};

const defaultState: SelectionToolbarState = {
  visible: false,
  top: 0,
  left: 0,
  bold: false,
  italic: false,
  underline: false,
  strike: false,
  highlightColor: null,
  textColor: null,
};

const HIGHLIGHT_COLORS = ["#FDEA9B", "#FED46A", "#FA551E", "#B4DC19", "#C8AFF0", "#3CBEFC"];
const TEXT_COLORS = ["#111827", "#DC2626", "#2563EB", "#16A34A", "#9333EA", "#EA580C"];
const TOOLBAR_VERTICAL_OFFSET = 10;
const TOOLBAR_MARGIN = 12;

const hasMark = (state: EditorState, selection: TextSelection, markType: MarkType | undefined) => {
  if (!markType) return false;
  return state.doc.rangeHasMark(selection.from, selection.to, markType);
};

const getDomTextSelection = (view: EditorView): TextSelection | null => {
  const selection = window.getSelection();
  if (!selection || selection.rangeCount === 0 || selection.isCollapsed) return null;
  if (!selection.anchorNode || !selection.focusNode) return null;
  if (!view.dom.contains(selection.anchorNode) || !view.dom.contains(selection.focusNode)) return null;

  try {
    const anchor = view.posAtDOM(selection.anchorNode, selection.anchorOffset);
    const head = view.posAtDOM(selection.focusNode, selection.focusOffset);
    if (anchor === head) return null;
    return TextSelection.create(view.state.doc, anchor, head);
  } catch {
    return null;
  }
};

const getToolbarSelection = (view: EditorView): TextSelection | null => {
  const { selection } = view.state;
  if (selection instanceof TextSelection && !selection.empty) return selection;
  return getDomTextSelection(view);
};

const getSelectionMarkColor = (
  state: EditorState,
  selection: TextSelection,
  markName: "highlight" | "text_color",
  fallbackColor?: string,
): string | null => {
  const markType = state.schema.marks[markName];
  if (!markType || selection.empty) return null;

  let foundColor: string | null = null;
  state.doc.nodesBetween(selection.from, selection.to, (node) => {
    if (!node.isText) return true;
    const mark = node.marks.find((item) => item.type === markType);
    if (mark) {
      foundColor = (mark.attrs.color as string | null) || fallbackColor || null;
      return false;
    }
    return true;
  });

  return foundColor;
};

const getSelectionRect = (view: EditorView, selection: TextSelection): DOMRect | null => {
  const domSelection = window.getSelection();
  if (
    domSelection &&
    domSelection.rangeCount > 0 &&
    !domSelection.isCollapsed &&
    domSelection.anchorNode &&
    view.dom.contains(domSelection.anchorNode)
  ) {
    const rect = domSelection.getRangeAt(0).getBoundingClientRect();
    if (rect.width || rect.height) return rect;
  }

  try {
    const fromPos = view.coordsAtPos(selection.from);
    const toPos = view.coordsAtPos(selection.to, -1);
    return {
      top: Math.min(fromPos.top, toPos.top),
      bottom: Math.max(fromPos.bottom, toPos.bottom),
      left: Math.min(fromPos.left, toPos.left),
      right: Math.max(fromPos.right, toPos.right),
      width: Math.abs(toPos.right - fromPos.left),
      height: Math.abs(toPos.bottom - fromPos.top),
      x: Math.min(fromPos.left, toPos.left),
      y: Math.min(fromPos.top, toPos.top),
      toJSON: () => ({}),
    } as DOMRect;
  } catch {
    return null;
  }
};

const isSelectionInCode = (state: EditorState, selection = state.selection) => {
  for (let depth = selection.$from.depth; depth >= 0; depth--) {
    if (selection.$from.node(depth).type.spec.code) return true;
  }
  const codeMark = state.schema.marks.code;
  return !!codeMark && state.doc.rangeHasMark(selection.from, selection.to, codeMark);
};

const shouldShowToolbar = (view: EditorView, readonly?: boolean) => {
  if (readonly || isViewComposing(view)) return false;
  const selection = getToolbarSelection(view);
  if (!selection) return false;
  if (isSelectionInCode(view.state, selection)) return false;
  return !!view.state.doc.textBetween(selection.from, selection.to).trim();
};

export const SelectionToolbar: React.FC<SelectionToolbarProps> = ({ view, readonly = false, updateVersion = 0 }) => {
  const toolbarRef = useRef<HTMLDivElement>(null);
  const savedSelectionRef = useRef<TextSelection | null>(null);
  const [state, setState] = useState<SelectionToolbarState>(defaultState);
  const [colorMenuOpen, setColorMenuOpen] = useState(false);

  const updatePosition = useCallback(() => {
    if (!view) {
      savedSelectionRef.current = null;
      setColorMenuOpen(false);
      setState((prev) => (prev.visible ? defaultState : prev));
      return;
    }

    const selection = getToolbarSelection(view);
    if (!selection || !shouldShowToolbar(view, readonly)) {
      savedSelectionRef.current = null;
      setColorMenuOpen(false);
      setState((prev) => (prev.visible ? defaultState : prev));
      return;
    }

    const rect = getSelectionRect(view, selection);
    if (!rect) {
      savedSelectionRef.current = null;
      setColorMenuOpen(false);
      setState((prev) => (prev.visible ? defaultState : prev));
      return;
    }

    savedSelectionRef.current = selection;
    const toolbarWidth = toolbarRef.current?.offsetWidth ?? 260;
    const toolbarHeight = toolbarRef.current?.offsetHeight ?? 40;
    const center = rect.left + rect.width / 2;
    const maxLeft = window.innerWidth - toolbarWidth - TOOLBAR_MARGIN;
    const left = Math.max(TOOLBAR_MARGIN, Math.min(maxLeft, center - toolbarWidth / 2));
    const top = Math.max(TOOLBAR_MARGIN, rect.top - toolbarHeight - TOOLBAR_VERTICAL_OFFSET);

    setState({
      visible: true,
      top,
      left,
      bold: hasMark(view.state, selection, view.state.schema.marks.strong),
      italic: hasMark(view.state, selection, view.state.schema.marks.em),
      underline: hasMark(view.state, selection, view.state.schema.marks.underline),
      strike: hasMark(view.state, selection, view.state.schema.marks.s),
      highlightColor: getSelectionMarkColor(view.state, selection, "highlight", HIGHLIGHT_COLORS[0]),
      textColor: getSelectionMarkColor(view.state, selection, "text_color"),
    });
  }, [readonly, view]);

  useLayoutEffect(() => {
    updatePosition();
  }, [updatePosition, updateVersion]);

  useEffect(() => {
    if (!view) return;

    let animationFrame: number | undefined;
    let updateTimeout: number | undefined;
    const scheduleUpdatePosition = () => {
      if (animationFrame !== undefined) {
        window.cancelAnimationFrame(animationFrame);
      }
      if (updateTimeout !== undefined) {
        window.clearTimeout(updateTimeout);
      }
      animationFrame = window.requestAnimationFrame(() => {
        animationFrame = undefined;
        updatePosition();
        updateTimeout = window.setTimeout(() => {
          updateTimeout = undefined;
          updatePosition();
        }, 0);
      });
    };
    const handleSelectionChange = () => scheduleUpdatePosition();
    const handleScrollOrResize = () => scheduleUpdatePosition();

    document.addEventListener("selectionchange", handleSelectionChange);
    view.dom.addEventListener("keydown", handleSelectionChange);
    view.dom.addEventListener("keyup", handleSelectionChange);
    view.dom.addEventListener("mouseup", handleSelectionChange);
    view.dom.addEventListener("pointerup", handleSelectionChange);
    window.addEventListener("mouseup", handleSelectionChange);
    window.addEventListener("pointerup", handleSelectionChange);
    window.addEventListener("resize", handleScrollOrResize);
    window.addEventListener("scroll", handleScrollOrResize, true);

    return () => {
      if (animationFrame !== undefined) {
        window.cancelAnimationFrame(animationFrame);
      }
      if (updateTimeout !== undefined) {
        window.clearTimeout(updateTimeout);
      }
      document.removeEventListener("selectionchange", handleSelectionChange);
      view.dom.removeEventListener("keydown", handleSelectionChange);
      view.dom.removeEventListener("keyup", handleSelectionChange);
      view.dom.removeEventListener("mouseup", handleSelectionChange);
      view.dom.removeEventListener("pointerup", handleSelectionChange);
      window.removeEventListener("mouseup", handleSelectionChange);
      window.removeEventListener("pointerup", handleSelectionChange);
      window.removeEventListener("resize", handleScrollOrResize);
      window.removeEventListener("scroll", handleScrollOrResize, true);
    };
  }, [updatePosition, view]);

  const restoreSelection = useCallback(() => {
    if (!view || !savedSelectionRef.current) return false;
    const selection = savedSelectionRef.current;
    const maxPos = view.state.doc.content.size;
    if (selection.from > maxPos || selection.to > maxPos) return false;
    view.dispatch(view.state.tr.setSelection(TextSelection.create(view.state.doc, selection.from, selection.to)));
    view.focus();
    return true;
  }, [view]);

  const runCommand = useCallback(
    (command: () => void) => {
      command();
      requestAnimationFrame(updatePosition);
    },
    [updatePosition],
  );

  const toggleMark = useCallback(
    (markName: "strong" | "em" | "underline" | "s") => {
      if (!view || !restoreSelection()) return;
      const markType = view.state.schema.marks[markName];
      if (!markType) return;
      runCommand(() => pmToggleMark(markType)(view.state, view.dispatch, view));
    },
    [restoreSelection, runCommand, view],
  );

  const applyMarkColor = useCallback(
    (markName: "highlight" | "text_color", color: string | null) => {
      if (!view || !restoreSelection()) return;
      const markType = view.state.schema.marks[markName];
      if (!markType) return;

      runCommand(() => {
        const { from, to } = view.state.selection;
        let tr = view.state.tr.removeMark(from, to, markType);
        if (color) tr = tr.addMark(from, to, markType.create({ color }));
        view.dispatch(tr.scrollIntoView());
      });
      setColorMenuOpen(false);
    },
    [restoreSelection, runCommand, view],
  );

  const toggleColorMenu = useCallback(() => {
    if (!restoreSelection()) return;
    setColorMenuOpen((open) => !open);
    requestAnimationFrame(updatePosition);
  }, [restoreSelection, updatePosition]);

  const buttons = useMemo(
    () => [
      { label: "B", title: "加粗", active: state.bold, onClick: () => toggleMark("strong"), className: "font-semibold" },
      { label: "I", title: "斜体", active: state.italic, onClick: () => toggleMark("em"), className: "italic" },
      {
        label: "U",
        title: "下划线",
        active: state.underline,
        onClick: () => toggleMark("underline"),
        className: "underline underline-offset-2",
      },
      { label: "S", title: "删除线", active: state.strike, onClick: () => toggleMark("s"), className: "line-through" },
    ],
    [state.bold, state.italic, state.strike, state.underline, toggleMark],
  );

  if (!state.visible) return null;

  return createPortal(
    <div
      ref={toolbarRef}
      className="selection-toolbar"
      style={{ top: state.top, left: state.left }}
      onMouseDown={(event) => event.preventDefault()}
      role="toolbar"
      aria-label="选中文本格式工具栏"
    >
      <div className="selection-toolbar-actions">
        {buttons.map((button) => (
          <button
            key={button.title}
            type="button"
            className={cn("selection-toolbar-button", button.className, button.active && "is-active")}
            title={button.title}
            aria-label={button.title}
            aria-pressed={button.active}
            onClick={button.onClick}
          >
            {button.label}
          </button>
        ))}
        <span className="selection-toolbar-separator" aria-hidden="true" />
        <div className="selection-toolbar-color-menu-wrap">
          <button
            type="button"
            className={cn("selection-toolbar-button", (state.textColor || state.highlightColor) && "is-active")}
            title="颜色"
            aria-label="颜色"
            aria-expanded={colorMenuOpen}
            onClick={toggleColorMenu}
          >
            色
          </button>
          {colorMenuOpen && (
            <div className="selection-toolbar-color-menu" role="menu" aria-label="颜色菜单">
              <div className="selection-toolbar-color-section">
                <div className="selection-toolbar-color-title">文字颜色</div>
                <div className="selection-toolbar-color-grid">
                  <button
                    type="button"
                    className={cn("selection-toolbar-color-clear", !state.textColor && "is-active")}
                    title="清除文字颜色"
                    aria-label="清除文字颜色"
                    onClick={() => applyMarkColor("text_color", null)}
                  >
                    默认
                  </button>
                  {TEXT_COLORS.map((color) => (
                    <button
                      key={color}
                      type="button"
                      className={cn("selection-toolbar-color", state.textColor === color && "is-active")}
                      style={{ backgroundColor: color }}
                      title={`文字颜色 ${color}`}
                      aria-label={`文字颜色 ${color}`}
                      aria-pressed={state.textColor === color}
                      onClick={() => applyMarkColor("text_color", color)}
                    />
                  ))}
                </div>
              </div>
              <div className="selection-toolbar-color-section">
                <div className="selection-toolbar-color-title">高亮颜色</div>
                <div className="selection-toolbar-color-grid">
                  <button
                    type="button"
                    className={cn("selection-toolbar-color-clear", !state.highlightColor && "is-active")}
                    title="清除高亮"
                    aria-label="清除高亮"
                    onClick={() => applyMarkColor("highlight", null)}
                  >
                    无
                  </button>
                  {HIGHLIGHT_COLORS.map((color) => (
                    <button
                      key={color}
                      type="button"
                      className={cn("selection-toolbar-color", state.highlightColor === color && "is-active")}
                      style={{ backgroundColor: color }}
                      title={`高亮 ${color}`}
                      aria-label={`高亮 ${color}`}
                      aria-pressed={state.highlightColor === color}
                      onClick={() => applyMarkColor("highlight", color)}
                    />
                  ))}
                </div>
              </div>
            </div>
          )}
        </div>
      </div>
    </div>,
    document.body,
  );
};

export default SelectionToolbar;
