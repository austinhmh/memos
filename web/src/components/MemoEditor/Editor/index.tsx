import { forwardRef, useCallback, useEffect, useImperativeHandle, useMemo, useRef } from "react";
import getCaretCoordinates from "textarea-caret";
import { APP_FONT_SCALE_CHANGE_EVENT } from "@/hooks/useAppFontScale";
import { cn } from "@/lib/utils";
import { EDITOR_HEIGHT } from "../constants";
import type { EditorProps } from "../types";
import { editorCommands } from "./commands";
import SlashCommands from "./SlashCommands";
import { handleMarkdownShortcuts } from "./shortcuts";
import TagSuggestions from "./TagSuggestions";
import { useListCompletion } from "./useListCompletion";

export interface EditorRefActions {
  getEditor: () => HTMLTextAreaElement | null;
  focus: () => void;
  scrollToCursor: () => void;
  insertText: (text: string, prefix?: string, suffix?: string) => void;
  removeText: (start: number, length: number) => void;
  setContent: (text: string) => void;
  getContent: () => string;
  getSelectedContent: () => string;
  getCursorPosition: () => number;
  setCursorPosition: (startPos: number, endPos?: number) => void;
  getCursorLineNumber: () => number;
  getLine: (lineNumber: number) => string;
  setLine: (lineNumber: number, text: string) => void;
}

const Editor = forwardRef(function Editor(props: EditorProps, ref: React.ForwardedRef<EditorRefActions>) {
  const {
    className,
    initialContent,
    placeholder,
    onPaste,
    onContentChange: handleContentChangeCallback,
    isFocusMode,
    compact,
    isInIME = false,
    onCompositionStart,
    onCompositionEnd,
  } = props;
  const editorRef = useRef<HTMLTextAreaElement>(null);

  const updateEditorHeight = useCallback(() => {
    if (editorRef.current) {
      editorRef.current.style.height = "auto";
      editorRef.current.style.height = `${editorRef.current.scrollHeight ?? 0}px`;
    }
  }, []);

  useEffect(() => {
    const handleFontScaleChange = () => {
      window.requestAnimationFrame(updateEditorHeight);
    };
    window.addEventListener(APP_FONT_SCALE_CHANGE_EVENT, handleFontScaleChange);
    return () => window.removeEventListener(APP_FONT_SCALE_CHANGE_EVENT, handleFontScaleChange);
  }, [updateEditorHeight]);

  const updateContent = useCallback(() => {
    if (editorRef.current) {
      handleContentChangeCallback(editorRef.current.value);
      updateEditorHeight();
    }
  }, [handleContentChangeCallback, updateEditorHeight]);

  const scrollToCaret = useCallback((options: { force?: boolean } = {}) => {
    const editor = editorRef.current;
    if (!editor) return;

    const { force = false } = options;
    const caret = getCaretCoordinates(editor, editor.selectionEnd);

    if (force) {
      editor.scrollTop = Math.max(0, caret.top - editor.clientHeight / 2);
      return;
    }

    const lineHeight = parseFloat(getComputedStyle(editor).lineHeight) || 24;
    const viewportBottom = editor.scrollTop + editor.clientHeight;
    // Scroll if cursor is near or beyond bottom edge (within 2 lines)
    if (caret.top + lineHeight * 2 > viewportBottom) {
      editor.scrollTop = Math.max(0, caret.top - editor.clientHeight / 2);
    }
  }, []);

  useEffect(() => {
    if (editorRef.current && initialContent) {
      editorRef.current.value = initialContent;
      handleContentChangeCallback(initialContent);
      updateEditorHeight();
    }
    // Only run once on mount to set initial content
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Update editor when content is externally changed (e.g., reset after save)
  useEffect(() => {
    if (editorRef.current && editorRef.current.value !== initialContent) {
      editorRef.current.value = initialContent;
      updateEditorHeight();
    }
  }, [initialContent, updateEditorHeight]);

  const editorActions: EditorRefActions = useMemo(
    () => ({
      getEditor: () => editorRef.current,
      focus: () => editorRef.current?.focus(),
      scrollToCursor: () => {
        scrollToCaret({ force: true });
      },
      insertText: (content = "", prefix = "", suffix = "") => {
        const editor = editorRef.current;
        if (!editor) return;

        const cursorPos = editor.selectionStart;
        const endPos = editor.selectionEnd;
        const prev = editor.value;
        const actual = content || prev.slice(cursorPos, endPos);
        editor.value = prev.slice(0, cursorPos) + prefix + actual + suffix + prev.slice(endPos);

        editor.focus();
        editor.setSelectionRange(cursorPos + prefix.length + actual.length, cursorPos + prefix.length + actual.length);
        updateContent();
      },
      removeText: (start: number, length: number) => {
        const editor = editorRef.current;
        if (!editor) return;

        editor.value = editor.value.slice(0, start) + editor.value.slice(start + length);
        editor.focus();
        editor.setSelectionRange(start, start);
        updateContent();
      },
      setContent: (text: string) => {
        const editor = editorRef.current;
        if (editor) {
          editor.value = text;
          updateContent();
        }
      },
      getContent: () => editorRef.current?.value ?? "",
      getCursorPosition: () => editorRef.current?.selectionStart ?? 0,
      getSelectedContent: () => {
        const editor = editorRef.current;
        if (!editor) return "";
        return editor.value.slice(editor.selectionStart, editor.selectionEnd);
      },
      setCursorPosition: (startPos: number, endPos?: number) => {
        const editor = editorRef.current;
        if (!editor) return;
        // setSelectionRange requires valid arguments; default to startPos if endPos is undefined
        const endPosition = endPos !== undefined && !Number.isNaN(endPos) ? endPos : startPos;
        editor.setSelectionRange(startPos, endPosition);
      },
      getCursorLineNumber: () => {
        const editor = editorRef.current;
        if (!editor) return 0;
        const lines = editor.value.slice(0, editor.selectionStart).split("\n");
        return lines.length - 1;
      },
      getLine: (lineNumber: number) => editorRef.current?.value.split("\n")[lineNumber] ?? "",
      setLine: (lineNumber: number, text: string) => {
        const editor = editorRef.current;
        if (!editor) return;
        const lines = editor.value.split("\n");
        lines[lineNumber] = text;
        editor.value = lines.join("\n");
        editor.focus();
        updateContent();
      },
    }),
    [updateContent, scrollToCaret],
  );

  useImperativeHandle(ref, () => editorActions, [editorActions]);

  const handleEditorInput = useCallback(() => {
    if (editorRef.current) {
      handleContentChangeCallback(editorRef.current.value);
      updateEditorHeight();

      // Auto-scroll to keep cursor visible when typing
      // See: https://github.com/usememos/memos/issues/5469
      scrollToCaret();
    }
  }, [handleContentChangeCallback, updateEditorHeight, scrollToCaret]);

  const handleEditorKeyDown = useCallback(
    (event: React.KeyboardEvent<HTMLTextAreaElement>) => {
      if (!(event.metaKey || event.ctrlKey) || event.altKey) {
        return;
      }

      const editor = editorActions;
      const key = event.key.toLowerCase();
      if (!["b", "i", "k"].includes(key)) {
        return;
      }

      handleMarkdownShortcuts(event, editor);
    },
    [editorActions],
  );

  // Auto-complete markdown lists when pressing Enter
  useListCompletion({
    editorRef,
    editorActions,
    isInIME,
  });

  return (
    <div
      className={cn(
        "flex flex-col justify-start items-start relative w-full bg-inherit min-h-0",
        // Focus mode: flex-1 to grow and fill space; Normal: h-auto with max-height
        isFocusMode ? "flex-1" : compact ? "h-auto max-h-[min(45svh,22rem)]" : `h-auto ${EDITOR_HEIGHT.normal}`,
        className,
      )}
    >
      <textarea
        className={cn(
          "w-full my-1 resize-none overflow-x-hidden overflow-y-auto bg-transparent outline-none placeholder:opacity-70 whitespace-pre-wrap break-words text-[length:var(--app-content-font-size)] leading-normal",
          // Focus mode: flex-1 h-0 to grow within flex container; Normal: h-full to fill wrapper
          isFocusMode ? "flex-1 h-0" : "h-full",
        )}
        rows={1}
        placeholder={placeholder}
        ref={editorRef}
        onPaste={onPaste}
        onInput={handleEditorInput}
        onKeyDown={handleEditorKeyDown}
        onCompositionStart={onCompositionStart}
        onCompositionEnd={onCompositionEnd}
      ></textarea>
      <TagSuggestions editorRef={editorRef} editorActions={ref} />
      <SlashCommands editorRef={editorRef} editorActions={ref} commands={editorCommands} />
    </div>
  );
});

export default Editor;
