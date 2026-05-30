import { create } from "@bufbuild/protobuf";
import { FieldMaskSchema } from "@bufbuild/protobuf/wkt";
import { useQueryClient } from "@tanstack/react-query";
import { baseKeymap, chainCommands, createParagraphNear, toggleMark as pmToggleMark, setBlockType } from "prosemirror-commands";
import { gapCursor } from "prosemirror-gapcursor";
import { history, redo, undo } from "prosemirror-history";
import { keymap } from "prosemirror-keymap";
import { Node, Slice } from "prosemirror-model";
import { liftListItem, sinkListItem, splitListItem } from "prosemirror-schema-list";
import { type Command, EditorState, Plugin, PluginKey, TextSelection } from "prosemirror-state";
import { EditorView } from "prosemirror-view";
import { useCallback, useEffect, useRef, useState } from "react";
import { toast } from "react-hot-toast";
import { attachmentServiceClient, memoServiceClient } from "@/connect";
import { useAuth } from "@/contexts/AuthContext";
import { memoKeys, syncMemoToDetailCache, syncMemoToListCaches } from "@/hooks/useMemoQueries";
import { userKeys } from "@/hooks/useUserQueries";
import useDictionary from "@/outline-shims/app/hooks/useDictionary";
import { isMac } from "@/outline-shims/shared/utils/browser";
import { dataUrlToFile, getDataTransferFiles } from "@/outline-shims/shared/utils/files";
import { fileNameFromUrl } from "@/outline-shims/shared/utils/urls";
import backspaceToParagraph from "@/outline-vendor/shared/editor/commands/backspaceToParagraph";
import {
  enterInCode,
  indentInCode,
  moveToNextNewline,
  moveToPreviousNewline,
  newlineInCode,
  outdentInCode,
} from "@/outline-vendor/shared/editor/commands/codeFence";
import { openLink } from "@/outline-vendor/shared/editor/commands/link";
import { selectAll } from "@/outline-vendor/shared/editor/commands/selectAll";
import splitHeading from "@/outline-vendor/shared/editor/commands/splitHeading";
import toggleBlockType from "@/outline-vendor/shared/editor/commands/toggleBlockType";
import { toggleCheckboxItems } from "@/outline-vendor/shared/editor/commands/toggleCheckboxItems";
import toggleList from "@/outline-vendor/shared/editor/commands/toggleList";
import toggleWrap from "@/outline-vendor/shared/editor/commands/toggleWrap";
import uploadPlaceholderPlugin from "@/outline-vendor/shared/editor/lib/uploadPlaceholder";
import { UploadPlugin } from "@/outline-vendor/shared/editor/plugins/UploadPlugin";
import { getCurrentBlock } from "@/outline-vendor/shared/editor/queries/getCurrentBlock";
import { isInCode } from "@/outline-vendor/shared/editor/queries/isInCode";
import type { Attachment } from "@/types/proto/api/v1/attachment_service_pb";
import { AttachmentSchema } from "@/types/proto/api/v1/attachment_service_pb";
import type { Memo } from "@/types/proto/api/v1/memo_service_pb";
import { MemoSchema } from "@/types/proto/api/v1/memo_service_pb";
import { getAttachmentUrl } from "@/utils/attachment";
import { getThemeWithFallback, resolveTheme } from "@/utils/theme";
import { SelectionToolbar } from "./components/SelectionToolbar";
import { SlashMenu } from "./components/SlashMenu";
import { TableControlsOverlay } from "./components/TableControlsOverlay";
import { loadDoc, parseInWorker } from "./lib/docCache";
import { buildMarkdownInputRules, codeBlockOnEnter } from "./lib/inputRules";
import isMarkdown from "./lib/isMarkdown";
import { createMdParser } from "./lib/markdownParser";
import { createMdSerializer } from "./lib/markdownSerializer";
import normalizePastedMarkdown from "./lib/normalizePastedMarkdown";
import { blogEditorSchema } from "./lib/schema";
import { buildSlashMenuItems } from "./menus/slashMenuItems";
import { createBookmarkPlugin } from "./plugins/BookmarkPlugin";
import { createCodeBlockExpandPlugin } from "./plugins/CodeBlockExpandPlugin";
import { createCodeFenceActivePlugin } from "./plugins/CodeFenceActivePlugin";
import { createCodeHighlightPlugin } from "./plugins/CodeHighlightPlugin";
import { createCompositionGuardPlugin, isViewComposing, runAfterCompositionSettled } from "./plugins/CompositionGuardPlugin";
import { createHeadingIdPlugin } from "./plugins/HeadingIdPlugin";
import { createMermaidPlugin } from "./plugins/MermaidPlugin";
import { createSlashMenuPlugin, type SlashMenuState } from "./plugins/SlashMenuPlugin";
import { createTablePlugins, tableKeymap } from "./plugins/TableControlsPlugin";

export type BlogEditorSaveStatus = "saved" | "unsaved";

interface BlogEditorProps {
  memo: Memo;
  readonly?: boolean;
  onReady?: () => void;
  onSaveStatusChange?: (status: BlogEditorSaveStatus) => void;
  normalizeBeforeSave?: (content: string) => string;
}

const AUTOSAVE_DELAY = 1000;
const PASTED_IMAGE_FILENAME = "pasted-image.png";
const SERIALIZE_IDLE_TIMEOUT = 1200;

type IdleTaskWindow = Window &
  typeof globalThis & {
    requestIdleCallback?: (callback: IdleRequestCallback, options?: IdleRequestOptions) => number;
    cancelIdleCallback?: (handle: number) => void;
  };

type PendingSave = {
  doc: Node;
  version: number;
};

const scheduleIdleTask = (callback: () => void, timeout = SERIALIZE_IDLE_TIMEOUT) => {
  if (typeof window === "undefined") {
    return globalThis.setTimeout(callback, 0);
  }

  const idleWindow = window as IdleTaskWindow;
  if (idleWindow.requestIdleCallback) {
    return idleWindow.requestIdleCallback(() => callback(), { timeout });
  }

  return window.setTimeout(callback, 0);
};

const cancelIdleTask = (handle?: number) => {
  if (handle === undefined) return;

  if (typeof window === "undefined") {
    globalThis.clearTimeout(handle);
    return;
  }

  const idleWindow = window as IdleTaskWindow;
  if (idleWindow.cancelIdleCallback) {
    idleWindow.cancelIdleCallback(handle);
    return;
  }

  window.clearTimeout(handle);
};

const schema = blogEditorSchema;
const parser = createMdParser(schema);
const serializer = createMdSerializer();
const selectionToolbarUpdatePluginKey = new PluginKey("selection-toolbar-update");

const createSelectionToolbarUpdatePlugin = (onUpdate: () => void) =>
  new Plugin({
    key: selectionToolbarUpdatePluginKey,
    view: (view) => {
      const handleSelectionChange = () => {
        const selection = window.getSelection();
        if (!selection?.anchorNode || !view.dom.contains(selection.anchorNode)) {
          return;
        }
        onUpdate();
      };

      document.addEventListener("selectionchange", handleSelectionChange);

      return {
        update: (view, prevState) => {
          if (!prevState.selection.eq(view.state.selection) || prevState.doc !== view.state.doc) {
            onUpdate();
          }
        },
        destroy: () => {
          document.removeEventListener("selectionchange", handleSelectionChange);
        },
      };
    },
  });

const toUploadableFile = async (file: File | string) => {
  if (file instanceof File) {
    return file;
  }

  if (file.startsWith("data:")) {
    return dataUrlToFile(file, PASTED_IMAGE_FILENAME);
  }

  const response = await fetch(file);
  const blob = await response.blob();
  return new File([blob], fileNameFromUrl(file) || PASTED_IMAGE_FILENAME, { type: blob.type || "image/png" });
};

const createBlogEditorAttachment = async (file: File, memoName: string): Promise<Attachment> => {
  const buffer = new Uint8Array(await file.arrayBuffer());
  const attachment = await attachmentServiceClient.createAttachment({
    attachment: create(AttachmentSchema, {
      filename: file.name || PASTED_IMAGE_FILENAME,
      size: BigInt(file.size),
      type: file.type || "image/png",
      content: buffer,
      memo: memoName,
    }),
  });

  return attachment;
};

const areTagsEqual = (a: string[], b: string[]) => {
  if (a.length !== b.length) {
    return false;
  }

  const aSorted = [...a].sort();
  const bSorted = [...b].sort();
  return aSorted.every((tag, index) => tag === bSorted[index]);
};

const LINK_DICTIONARY = { openLinkError: "打开链接失败" };

const openLinkInNewTab = (href: string, event: KeyboardEvent) => {
  event.preventDefault();
  window.open(href, "_blank", "noopener,noreferrer");
};

const moveCurrentBlock =
  (direction: "up" | "down"): Command =>
  (state, dispatch) => {
    if (!state.selection.empty) {
      return false;
    }

    const result = getCurrentBlock(state);
    if (!result) {
      return false;
    }

    const [currentBlock, currentPos] = result;

    if (direction === "up") {
      const $pos = state.doc.resolve(currentPos);
      if (!$pos.nodeBefore || !$pos.nodeBefore.isBlock) {
        return false;
      }

      const previousBlock = $pos.nodeBefore;
      const previousBlockPos = currentPos - previousBlock.nodeSize;
      if (!dispatch) {
        return true;
      }

      const tr = state.tr;
      tr.delete(currentPos, currentPos + currentBlock.nodeSize);
      tr.insert(previousBlockPos, currentBlock);
      tr.setSelection(TextSelection.near(tr.doc.resolve(previousBlockPos + 1)));
      dispatch(tr);
      return true;
    }

    const $pos = state.doc.resolve(currentPos + currentBlock.nodeSize);
    if (!$pos.nodeAfter || !$pos.nodeAfter.isBlock) {
      return false;
    }

    const nextBlock = $pos.nodeAfter;
    const nextBlockEndPos = currentPos + currentBlock.nodeSize + nextBlock.nodeSize;
    if (!dispatch) {
      return true;
    }

    const tr = state.tr;
    tr.insert(nextBlockEndPos, currentBlock);
    tr.delete(currentPos, currentPos + currentBlock.nodeSize);
    tr.setSelection(TextSelection.near(tr.doc.resolve(nextBlockEndPos - currentBlock.nodeSize + 1)));
    dispatch(tr);
    return true;
  };

const blurEditor: Command = (_state, _dispatch, view) => {
  if (!view) {
    return false;
  }

  (view.dom as HTMLElement).blur();
  return true;
};

const focusEditorAtDocumentStart = (view: EditorView) => {
  if (!view.editable) {
    view.focus();
    return;
  }

  const { state } = view;
  const firstChild = state.doc.firstChild;
  if (!firstChild || firstChild.isTextblock) {
    view.dispatch(state.tr.setSelection(TextSelection.near(state.doc.resolve(1), 1)).scrollIntoView());
    view.focus();
    return;
  }

  const paragraph = state.schema.nodes.paragraph?.create();
  if (!paragraph) {
    view.focus();
    return;
  }

  const tr = state.tr.insert(0, paragraph);
  tr.setSelection(TextSelection.near(tr.doc.resolve(1), 1)).scrollIntoView();
  view.dispatch(tr);
  view.focus();
};

const focusEditorAtDocumentEnd = (view: EditorView, forceNewTextblock = false) => {
  if (!view.editable) {
    view.focus();
    return;
  }

  const { state } = view;
  const docEnd = state.doc.content.size;
  const lastChild = state.doc.lastChild;
  if (!lastChild) {
    view.dispatch(state.tr.setSelection(TextSelection.near(state.doc.resolve(docEnd), -1)).scrollIntoView());
    view.focus();
    return;
  }

  if (lastChild.isTextblock && (!forceNewTextblock || lastChild.textContent.length === 0)) {
    view.dispatch(state.tr.setSelection(TextSelection.near(state.doc.resolve(docEnd), -1)).scrollIntoView());
    view.focus();
    return;
  }

  const paragraph = state.schema.nodes.paragraph?.create();
  if (!paragraph) {
    view.focus();
    return;
  }

  const tr = state.tr.insert(docEnd, paragraph);
  tr.setSelection(TextSelection.near(tr.doc.resolve(docEnd + 1), 1)).scrollIntoView();
  view.dispatch(tr);
  view.focus();
};

const focusEditorAtPointerEdge = (view: EditorView, clientY: number) => {
  const firstElement = view.dom.firstElementChild;
  const lastElement = view.dom.lastElementChild;
  if (!(firstElement instanceof HTMLElement) || !(lastElement instanceof HTMLElement)) {
    focusEditorAtDocumentEnd(view);
    return;
  }

  const firstRect = firstElement.getBoundingClientRect();
  const lastRect = lastElement.getBoundingClientRect();
  if (clientY < firstRect.top) {
    focusEditorAtDocumentStart(view);
    return;
  }
  if (clientY > lastRect.bottom) {
    focusEditorAtDocumentEnd(view, true);
    return;
  }

  const onlyChild = view.state.doc.childCount === 1 ? view.state.doc.firstChild : null;
  if (onlyChild && !onlyChild.isTextblock) {
    const midpoint = firstRect.top + (lastRect.bottom - firstRect.top) / 2;
    if (clientY < midpoint) {
      focusEditorAtDocumentStart(view);
      return;
    }
    focusEditorAtDocumentEnd(view);
    return;
  }

  view.focus();
};

type PointerEdgeEvent = {
  target: EventTarget | null;
  clientX: number;
  clientY: number;
  defaultPrevented?: boolean;
  preventDefault: () => void;
};

const shouldFocusEditorAtPointerEdge = (view: EditorView, target: Element | null, clientX: number, clientY: number) => {
  if (!target) {
    return false;
  }

  const elementAtPointer = document.elementFromPoint(clientX, clientY);
  if (
    target.closest(".table-controls-overlay") ||
    target.closest("button,a,input,textarea,select,[contenteditable='false']") ||
    target.closest(".blog-editor-content table") ||
    elementAtPointer?.closest(".blog-editor-content table")
  ) {
    return false;
  }

  const isInsideEditorContent = view.dom.contains(target);
  if (!isInsideEditorContent) {
    return true;
  }

  const pos = view.posAtCoords({ left: clientX, top: clientY });
  if (pos) {
    return false;
  }

  const isEditorRootClick = target === view.dom;
  const tableOnlyDocument = view.state.doc.childCount === 1 && !view.state.doc.firstChild?.isTextblock;
  if (clientY > view.dom.getBoundingClientRect().bottom) {
    return true;
  }
  if (isEditorRootClick || tableOnlyDocument) {
    return true;
  }
  return true;
};

const focusEditorAtPointerEdgeFromEvent = (view: EditorView, event: PointerEdgeEvent) => {
  if (event.defaultPrevented) {
    return false;
  }

  const target = event.target instanceof Element ? event.target : null;
  if (!shouldFocusEditorAtPointerEdge(view, target, event.clientX, event.clientY)) {
    return false;
  }

  event.preventDefault();
  focusEditorAtPointerEdge(view, event.clientY);
  return true;
};

const getDocumentTextSelection = (state: EditorState): TextSelection | null => {
  let from: number | null = null;
  let to: number | null = null;

  state.doc.descendants((node, pos) => {
    if (!node.isText || node.textContent.trim().length === 0) {
      return true;
    }

    from = from === null ? pos : Math.min(from, pos);
    to = to === null ? pos + node.nodeSize : Math.max(to, pos + node.nodeSize);
    return true;
  });

  if (from === null || to === null || from === to) return null;
  return TextSelection.create(state.doc, from, to);
};

const selectEntireDocument: Command = (state, dispatch) => {
  const selection = getDocumentTextSelection(state);
  if (!selection || state.selection.eq(selection)) {
    return false;
  }

  dispatch?.(state.tr.setSelection(selection));
  return true;
};

const selectEditorContent = chainCommands(selectAll(schema.nodes.code_block), selectAll(schema.nodes.blockquote), selectEntireDocument);

const buildBlogEditorKeymap = (manualSave: Command): Record<string, Command> => ({
  "Mod-a": selectEditorContent,
  "Mod-s": manualSave,
  "Mod-z": undo,
  "Mod-y": redo,
  "Shift-Mod-z": redo,
  "Mod-Alt-ArrowUp": moveCurrentBlock("up"),
  "Mod-Alt-ArrowDown": moveCurrentBlock("down"),
  Escape: blurEditor,
  "Mod-Escape": blurEditor,
  "Shift-Escape": blurEditor,
  ...(schema.nodes.checkbox_item
    ? {
        "Mod-Enter": chainCommands(
          openLink(openLinkInNewTab, LINK_DICTIONARY),
          toggleCheckboxItems(schema.nodes.checkbox_item),
          (state, dispatch, view) => (!isInCode(state) ? manualSave(state, dispatch, view) : false),
        ),
      }
    : {
        "Mod-Enter": chainCommands(openLink(openLinkInNewTab, LINK_DICTIONARY), (state, dispatch, view) =>
          !isInCode(state) ? manualSave(state, dispatch, view) : false,
        ),
      }),
  "Mod-b": pmToggleMark(schema.marks.strong),
  "Mod-B": pmToggleMark(schema.marks.strong),
  "Mod-i": pmToggleMark(schema.marks.em),
  "Mod-I": pmToggleMark(schema.marks.em),
  "Mod-u": pmToggleMark(schema.marks.underline),
  "Mod-d": pmToggleMark(schema.marks.s),
  "Mod-e": pmToggleMark(schema.marks.code),
  "Mod-Shift-c": pmToggleMark(schema.marks.code),
  "Mod-Shift-h": pmToggleMark(schema.marks.highlight),
  "Shift-Ctrl-0": setBlockType(schema.nodes.paragraph),
  "Shift-Ctrl-1": toggleBlockType(schema.nodes.heading, schema.nodes.paragraph, { level: 1 }),
  "Shift-Ctrl-2": toggleBlockType(schema.nodes.heading, schema.nodes.paragraph, { level: 2 }),
  "Shift-Ctrl-3": toggleBlockType(schema.nodes.heading, schema.nodes.paragraph, { level: 3 }),
  "Shift-Ctrl-4": toggleBlockType(schema.nodes.heading, schema.nodes.paragraph, { level: 4 }),
  "Shift-Ctrl-5": toggleBlockType(schema.nodes.heading, schema.nodes.paragraph, { level: 5 }),
  "Shift-Ctrl-6": toggleBlockType(schema.nodes.heading, schema.nodes.paragraph, { level: 6 }),
  "Shift-Ctrl-7": toggleList(schema.nodes.checkbox_list, schema.nodes.checkbox_item),
  "Shift-Ctrl-8": toggleList(schema.nodes.bullet_list, schema.nodes.list_item),
  "Shift-Ctrl-9": toggleList(schema.nodes.ordered_list, schema.nodes.list_item),
  "Shift-Ctrl-c": toggleBlockType(schema.nodes.code_block, schema.nodes.paragraph, { language: "" }),
  "Shift-Ctrl-\\": toggleBlockType(schema.nodes.code_block, schema.nodes.paragraph, { language: "" }),
  "Ctrl->": toggleWrap(schema.nodes.blockquote),
  Enter: chainCommands(
    codeBlockOnEnter(schema),
    enterInCode,
    createParagraphNear,
    splitListItem(schema.nodes.checkbox_item),
    splitListItem(schema.nodes.list_item),
    splitHeading(schema.nodes.heading),
  ),
  Backspace: chainCommands(backspaceToParagraph(schema.nodes.heading), backspaceToParagraph(schema.nodes.code_block)),
  Tab: chainCommands(indentInCode, sinkListItem(schema.nodes.checkbox_item), sinkListItem(schema.nodes.list_item)),
  "Shift-Tab": chainCommands(outdentInCode, liftListItem(schema.nodes.checkbox_item), liftListItem(schema.nodes.list_item)),
  "Shift-Enter": chainCommands(newlineInCode, toggleWrap(schema.nodes.blockquote)),
  "Mod-]": chainCommands(
    indentInCode,
    sinkListItem(schema.nodes.checkbox_item),
    sinkListItem(schema.nodes.list_item),
    toggleWrap(schema.nodes.blockquote),
  ),
  "Mod-[": chainCommands(outdentInCode, liftListItem(schema.nodes.checkbox_item), liftListItem(schema.nodes.list_item)),
  ...(isMac
    ? {
        "Ctrl-a": moveToPreviousNewline,
        "Ctrl-e": moveToNextNewline,
      }
    : {}),
});

const BlogEditor = ({ memo, readonly = false, onReady, onSaveStatusChange, normalizeBeforeSave }: BlogEditorProps) => {
  const queryClient = useQueryClient();
  const dictionary = useDictionary();
  const containerRef = useRef<HTMLDivElement>(null);
  const editorRootRef = useRef<HTMLDivElement>(null);
  const viewRef = useRef<EditorView | null>(null);
  const [isSaving, setIsSaving] = useState(false);
  const [loading, setLoading] = useState(true);
  const saveTimerRef = useRef<ReturnType<typeof setTimeout>>();
  const serializeTaskRef = useRef<number>();
  const saveLoopPromiseRef = useRef<Promise<void> | null>(null);
  const pendingDocForSaveRef = useRef<PendingSave | null>(null);
  const saveVersionRef = useRef(0);
  const deferredAutosaveCancelRef = useRef<(() => void) | null>(null);
  const deferredSaveCancelRef = useRef<(() => void) | null>(null);
  const externalSyncSeqRef = useRef(0);
  const deferredExternalSyncCancelRef = useRef<(() => void) | null>(null);
  const mountedRef = useRef(true);
  const lastPersistSucceededRef = useRef(true);
  const skipNextSaveRef = useRef(false);
  const localDirtyRef = useRef(false);
  const readonlyRef = useRef(readonly);
  readonlyRef.current = readonly;
  const pasteListenerRef = useRef<{ dom: HTMLElement; handler: (e: Event) => void } | null>(null);
  const onReadyRef = useRef(onReady);
  onReadyRef.current = onReady;
  const onSaveStatusChangeRef = useRef(onSaveStatusChange);
  onSaveStatusChangeRef.current = onSaveStatusChange;
  const notifySaveStatus = useCallback((status: BlogEditorSaveStatus) => {
    onSaveStatusChangeRef.current?.(status);
  }, []);

  const normalizeContent = useCallback(
    (content: string) => (normalizeBeforeSave ? normalizeBeforeSave(content) : content),
    [normalizeBeforeSave],
  );

  const lastSavedRef = useRef(normalizeContent(memo.content));
  const lastSavedTagsRef = useRef(memo.tags ?? []);
  const contentRef = useRef(normalizeContent(memo.content));
  contentRef.current = normalizeContent(memo.content);

  const [slashMenuState, setSlashMenuState] = useState<SlashMenuState>({ open: false, query: "", from: 0, to: 0 });
  const [editorUpdateVersion, setEditorUpdateVersion] = useState(0);
  const setSlashMenuStateRef = useRef(setSlashMenuState);
  setSlashMenuStateRef.current = setSlashMenuState;
  const slashMenuItems = useRef(buildSlashMenuItems(schema)).current;

  const userTheme = useAuth().userGeneralSetting?.theme;
  const themePreference = getThemeWithFallback(userTheme);
  const resolvedTheme = resolveTheme(themePreference);
  const isDark = resolvedTheme.includes("dark");
  const isDarkRef = useRef(isDark);
  isDarkRef.current = isDark;

  useEffect(() => {
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
    };
  }, []);

  useEffect(() => {
    notifySaveStatus("saved");
  }, [memo.name, notifySaveStatus]);

  useEffect(() => {
    lastSavedTagsRef.current = memo.tags ?? [];
  }, [memo.name, memo.tags]);

  const persistContent = useCallback(
    async (normalizedContent: string) => {
      if (normalizedContent.trim() === lastSavedRef.current.trim()) {
        lastPersistSucceededRef.current = true;
        notifySaveStatus("saved");
        return false;
      }

      try {
        const updatedMemo = await memoServiceClient.updateMemo({
          memo: create(MemoSchema, {
            name: memo.name,
            content: normalizedContent,
          } as Record<string, unknown>),
          updateMask: create(FieldMaskSchema, {
            paths: ["content"],
          }),
        });

        syncMemoToDetailCache(queryClient, updatedMemo);
        syncMemoToListCaches(queryClient, updatedMemo);
        if (!areTagsEqual(lastSavedTagsRef.current, updatedMemo.tags ?? [])) {
          queryClient.invalidateQueries({ queryKey: userKeys.stats() });
          queryClient.invalidateQueries({ queryKey: memoKeys.lists() });
        }
        lastSavedRef.current = normalizedContent;
        lastSavedTagsRef.current = updatedMemo.tags ?? [];
        localDirtyRef.current = false;
        lastPersistSucceededRef.current = true;
        notifySaveStatus("saved");
        return true;
      } catch (err) {
        console.error(err);
        lastPersistSucceededRef.current = false;
        toast.error("保存失败");
        return false;
      }
    },
    [memo.name, notifySaveStatus, queryClient],
  );

  const persistContentRef = useRef(persistContent);
  persistContentRef.current = persistContent;

  const runPendingSaveLoop = useCallback(async () => {
    let saveStarted = false;

    try {
      while (pendingDocForSaveRef.current) {
        const view = viewRef.current;
        if (view && isViewComposing(view)) {
          deferredSaveCancelRef.current?.();
          deferredSaveCancelRef.current = runAfterCompositionSettled(view, () => {
            deferredSaveCancelRef.current = null;
            if (!mountedRef.current || viewRef.current !== view) return;
            const pending = pendingDocForSaveRef.current;
            const nextVersion = Math.max(saveVersionRef.current + 1, (pending?.version ?? 0) + 1);
            saveVersionRef.current = nextVersion;
            pendingDocForSaveRef.current = { doc: view.state.doc, version: nextVersion };
            void startSaveLoopRef.current?.();
          });
          return;
        }

        const pendingSave = pendingDocForSaveRef.current;
        pendingDocForSaveRef.current = null;

        const md = serializer.serialize(pendingSave.doc);
        const normalizedContent = normalizeContent(md);
        const pendingVersion = (pendingDocForSaveRef.current as PendingSave | null)?.version;
        if (pendingVersion !== undefined && pendingVersion > pendingSave.version) {
          continue;
        }
        if (normalizedContent.trim() === lastSavedRef.current.trim()) {
          localDirtyRef.current = false;
          notifySaveStatus("saved");
          continue;
        }

        if (!saveStarted && mountedRef.current) {
          saveStarted = true;
          setIsSaving(true);
        }

        await persistContentRef.current(normalizedContent);
      }
    } finally {
      if (saveStarted && mountedRef.current) {
        setIsSaving(false);
      }
    }
  }, [normalizeContent, notifySaveStatus]);

  const startSaveLoopRef = useRef<() => Promise<void>>();
  const startSaveLoop = useCallback(() => {
    if (saveLoopPromiseRef.current) {
      return saveLoopPromiseRef.current;
    }

    const loopPromise = runPendingSaveLoop().finally(() => {
      if (saveLoopPromiseRef.current === loopPromise) {
        saveLoopPromiseRef.current = null;
      }

      if (pendingDocForSaveRef.current && mountedRef.current) {
        const view = viewRef.current;
        if (view && isViewComposing(view)) {
          deferredSaveCancelRef.current?.();
          deferredSaveCancelRef.current = runAfterCompositionSettled(view, () => {
            deferredSaveCancelRef.current = null;
            if (!mountedRef.current || viewRef.current !== view) return;
            void startSaveLoopRef.current?.();
          });
          return;
        }
        void startSaveLoopRef.current?.();
      }
    });

    saveLoopPromiseRef.current = loopPromise;
    return loopPromise;
  }, [runPendingSaveLoop]);
  startSaveLoopRef.current = startSaveLoop;

  const waitForPendingSaves = useCallback(async () => {
    while (saveLoopPromiseRef.current || pendingDocForSaveRef.current) {
      const view = viewRef.current;
      if (view && isViewComposing(view)) {
        await new Promise<void>((resolve) => runAfterCompositionSettled(view, resolve));
        continue;
      }

      if (saveLoopPromiseRef.current) {
        await saveLoopPromiseRef.current;
        continue;
      }

      if (pendingDocForSaveRef.current && startSaveLoopRef.current) {
        await startSaveLoopRef.current();
      }
    }
  }, []);

  const flushPendingSave = useCallback(
    (doc: Node, immediate = false) => {
      const nextVersion = saveVersionRef.current + 1;
      saveVersionRef.current = nextVersion;
      pendingDocForSaveRef.current = { doc, version: nextVersion };

      if (serializeTaskRef.current !== undefined) {
        cancelIdleTask(serializeTaskRef.current);
        serializeTaskRef.current = undefined;
      }

      if (immediate) {
        const view = viewRef.current;
        if (view && isViewComposing(view)) {
          deferredSaveCancelRef.current?.();
          deferredSaveCancelRef.current = runAfterCompositionSettled(view, () => {
            deferredSaveCancelRef.current = null;
            if (!mountedRef.current || viewRef.current !== view) return;
            flushPendingSave(view.state.doc, true);
          });
          return waitForPendingSaves();
        }

        void startSaveLoopRef.current?.();
        return waitForPendingSaves();
      }

      if (saveLoopPromiseRef.current) {
        return undefined;
      }

      serializeTaskRef.current = scheduleIdleTask(() => {
        serializeTaskRef.current = undefined;
        void startSaveLoopRef.current?.();
      }) as number;

      return undefined;
    },
    [waitForPendingSaves],
  );

  const handleManualSave = useCallback(
    async (doc: Node) => {
      if (saveTimerRef.current) {
        clearTimeout(saveTimerRef.current);
        saveTimerRef.current = undefined;
      }

      const saveNow = flushPendingSave(doc, true);
      if (!saveNow) {
        return false;
      }

      await saveNow;
      if (lastPersistSucceededRef.current) {
        toast.success("已保存");
        return true;
      }

      return false;
    },
    [flushPendingSave],
  );

  const manualSaveCommand = useCallback<Command>(
    (state) => {
      void handleManualSave(state.doc);
      return true;
    },
    [handleManualSave],
  );

  const uploadFile = useCallback(
    async (file: File | string) => {
      const uploadableFile = await toUploadableFile(file);
      const attachment = await createBlogEditorAttachment(uploadableFile, memo.name);
      return getAttachmentUrl(attachment);
    },
    [memo.name],
  );

  useEffect(() => {
    let cancelled = false;

    const mount = async () => {
      setLoading(true);

      const doc = await loadDoc(schema, parser, memo.name, memo.updateTime, contentRef.current);

      if (cancelled || !mountedRef.current) return;

      const el = containerRef.current;
      if (!el || viewRef.current) return;

      const state = EditorState.create({
        doc,
        schema,
        plugins: [
          keymap(buildBlogEditorKeymap(manualSaveCommand)),
          keymap(tableKeymap),
          createCompositionGuardPlugin(),
          createSelectionToolbarUpdatePlugin(() => setEditorUpdateVersion((version) => version + 1)),
          history(),
          gapCursor(),
          uploadPlaceholderPlugin,
          new UploadPlugin({
            dictionary,
            uploadFile,
            onFileUploadStart: () => {
              if (mountedRef.current) {
                setIsSaving(true);
              }
            },
            onFileUploadStop: () => {
              if (mountedRef.current) {
                setIsSaving(false);
              }
            },
          }),
          buildMarkdownInputRules(schema),
          createSlashMenuPlugin(setSlashMenuState),
          createMermaidPlugin({ isDark: isDarkRef.current }),
          createBookmarkPlugin(),
          createCodeFenceActivePlugin(),
          createCodeHighlightPlugin(),
          createCodeBlockExpandPlugin(),
          createHeadingIdPlugin(),
          ...createTablePlugins({ isEditable: () => !readonlyRef.current }),
          keymap(baseKeymap),
        ],
      });

      const view = new EditorView(el, {
        state,
        editable: () => !readonlyRef.current,
        attributes: {
          class: "blog-editor-content ProseMirror blog-editor-prosemirror",
          spellcheck: "false",
          role: "textbox",
          "aria-label": "Blog editor",
          "aria-multiline": "true",
          "data-testid": "blog-editor-content",
        },
        handleKeyDown(view, event) {
          if ((event.ctrlKey || event.metaKey) && !event.altKey && !event.shiftKey && event.key.toLowerCase() === "a") {
            if (selectEditorContent(view.state, view.dispatch, view)) {
              event.preventDefault();
              return true;
            }
          }
          return false;
        },
        handleClickOn(view, _pos, node, nodePos, event) {
          const target = event.target as HTMLElement | null;
          if (!target || node.type !== schema.nodes.checkbox_item) {
            return false;
          }

          const checkbox = target.closest(".checkbox");
          if (!checkbox) {
            return false;
          }

          event.preventDefault();
          if (readonlyRef.current) {
            return true;
          }

          const checked = checkbox.getAttribute("aria-checked") === "true";
          view.dispatch(
            view.state.tr.setNodeMarkup(nodePos, undefined, {
              ...node.attrs,
              checked: !checked,
            }),
          );
          return true;
        },
        handleClick(view, _pos, event) {
          return focusEditorAtPointerEdgeFromEvent(view, event);
        },
        dispatchTransaction(this: EditorView, tr) {
          const nextState = this.state.apply(tr);
          this.updateState(nextState);
          setEditorUpdateVersion((version) => version + 1);

          if (!readonlyRef.current && tr.docChanged) {
            if (skipNextSaveRef.current) {
              skipNextSaveRef.current = false;
              localDirtyRef.current = false;
              notifySaveStatus("saved");
              return;
            }

            localDirtyRef.current = true;
            notifySaveStatus("unsaved");
            if (saveTimerRef.current) {
              clearTimeout(saveTimerRef.current);
              saveTimerRef.current = undefined;
            }
            deferredAutosaveCancelRef.current?.();
            deferredAutosaveCancelRef.current = null;

            const scheduleAutosave = () => {
              if (!mountedRef.current || viewRef.current !== this) return;
              if (saveTimerRef.current) {
                clearTimeout(saveTimerRef.current);
              }
              saveTimerRef.current = setTimeout(() => {
                const currentView = viewRef.current;
                if (!currentView || currentView !== this) return;
                flushPendingSave(currentView.state.doc);
              }, AUTOSAVE_DELAY);
            };
            if (isViewComposing(this)) {
              deferredAutosaveCancelRef.current = runAfterCompositionSettled(this, () => {
                deferredAutosaveCancelRef.current = null;
                scheduleAutosave();
              });
              return;
            }
            scheduleAutosave();
          }
        },
      });

      viewRef.current = view;
      setEditorUpdateVersion((version) => version + 1);
      setLoading(false);
      onReadyRef.current?.();

      const pmDom = view.dom;
      const onCapturePaste = (e: Event) => {
        const event = e as ClipboardEvent;
        const v = viewRef.current;
        if (!v || !v.editable || !event.clipboardData) return;
        if (getDataTransferFiles(event).length > 0) return;

        const text = event.clipboardData.getData("text/plain");
        const html = event.clipboardData.getData("text/html");
        if (!text) return;

        const { $from } = v.state.selection;
        for (let d = $from.depth; d >= 0; d--) {
          if ($from.node(d).type.spec.code) return;
        }

        if (html?.includes("data-pm-slice")) return;
        if (!isMarkdown(text)) return;

        event.preventDefault();
        event.stopImmediatePropagation();

        const normalized = normalizePastedMarkdown(text);
        const parsed = parser.parse(normalized);
        if (!parsed) return;

        const slice = parsed.slice(0);
        const singleNode = slice.openStart === 0 && slice.openEnd === 0 && slice.content.childCount === 1 ? slice.content.firstChild : null;

        const tr = v.state.tr;
        if (singleNode?.type === schema.nodes.paragraph) {
          tr.replaceSelection(new Slice(singleNode.content, 0, 0));
        } else {
          tr.replaceSelection(slice);
        }

        v.dispatch(tr.scrollIntoView().setMeta("paste", true).setMeta("uiEvent", "paste"));
      };

      pmDom.addEventListener("paste", onCapturePaste, true);
      pasteListenerRef.current = { dom: pmDom, handler: onCapturePaste };
    };

    void mount();

    return () => {
      cancelled = true;
      if (pasteListenerRef.current) {
        const { dom, handler } = pasteListenerRef.current;
        dom.removeEventListener("paste", handler, true);
        pasteListenerRef.current = null;
      }
      if (viewRef.current) {
        viewRef.current.destroy();
        viewRef.current = null;
      }
    };
  }, [memo.name, flushPendingSave, manualSaveCommand, dictionary, uploadFile]);

  useEffect(() => {
    const view = viewRef.current;
    if (!view) return;

    const syncExternalContent = () => {
      const currentView = viewRef.current;
      if (!mountedRef.current || currentView !== view) return;
      if (isViewComposing(view)) {
        deferredExternalSyncCancelRef.current?.();
        deferredExternalSyncCancelRef.current = runAfterCompositionSettled(view, () => {
          deferredExternalSyncCancelRef.current = null;
          syncExternalContent();
        });
        return;
      }

      const normalizedContent = normalizeContent(memo.content);
      if (normalizedContent === lastSavedRef.current) return;

      if (normalizedContent.trim() === lastSavedRef.current.trim()) {
        lastSavedRef.current = normalizedContent;
        notifySaveStatus("saved");
        return;
      }

      if (localDirtyRef.current) {
        return;
      }

      const requestSeq = externalSyncSeqRef.current + 1;
      externalSyncSeqRef.current = requestSeq;

      parseInWorker(normalizedContent).then((json) => {
        const latestView = viewRef.current;
        if (!mountedRef.current || !latestView || latestView !== view || requestSeq !== externalSyncSeqRef.current) return;
        if (isViewComposing(latestView)) {
          deferredExternalSyncCancelRef.current?.();
          deferredExternalSyncCancelRef.current = runAfterCompositionSettled(latestView, () => {
            deferredExternalSyncCancelRef.current = null;
            if (requestSeq === externalSyncSeqRef.current) {
              syncExternalContent();
            }
          });
          return;
        }
        if (localDirtyRef.current || normalizeContent(memo.content) !== normalizedContent) return;
        try {
          const doc = Node.fromJSON(schema, json);
          skipNextSaveRef.current = true;
          latestView.dispatch(latestView.state.tr.replaceWith(0, latestView.state.doc.content.size, doc.content));
          lastSavedRef.current = normalizedContent;
          localDirtyRef.current = false;
        } catch (err) {
          skipNextSaveRef.current = false;
          console.error("[BlogEditor] external content sync failed:", err);
        }
      });
    };

    if (isViewComposing(view)) {
      void runAfterCompositionSettled(view, syncExternalContent);
      return;
    }

    syncExternalContent();
  }, [memo.content, normalizeContent]);

  useEffect(() => {
    const view = viewRef.current;
    if (!view) return;

    view.setProps({ editable: () => !readonly });
  }, [readonly]);

  useEffect(() => {
    const view = viewRef.current;
    if (!view) return;

    if (isViewComposing(view)) {
      void runAfterCompositionSettled(view, () => {
        if (!mountedRef.current || viewRef.current !== view || isViewComposing(view)) return;
        view.dispatch(view.state.tr.setMeta("theme", { isDark: isDarkRef.current }));
      });
      return;
    }

    view.dispatch(view.state.tr.setMeta("theme", { isDark }));
  }, [isDark]);

  useEffect(() => {
    return () => {
      if (saveTimerRef.current) clearTimeout(saveTimerRef.current);
      deferredAutosaveCancelRef.current?.();
      deferredAutosaveCancelRef.current = null;
      deferredSaveCancelRef.current?.();
      deferredSaveCancelRef.current = null;
      deferredExternalSyncCancelRef.current?.();
      deferredExternalSyncCancelRef.current = null;
      externalSyncSeqRef.current += 1;
      cancelIdleTask(serializeTaskRef.current);
      serializeTaskRef.current = undefined;
      pendingDocForSaveRef.current = null;
    };
  }, []);

  const handleEditorRootClick = useCallback(
    (event: React.MouseEvent<HTMLDivElement>) => {
      const view = viewRef.current;
      if (!view || readonly || loading) {
        return;
      }

      focusEditorAtPointerEdgeFromEvent(view, event.nativeEvent);
    },
    [loading, readonly],
  );

  return (
    <div ref={editorRootRef} className="blog-editor" style={{ position: "relative" }} onClick={handleEditorRootClick}>
      {loading && (
        <div className="blog-editor-content ProseMirror" style={{ padding: "2rem", color: "#888" }}>
          <p>正在加载文档…</p>
        </div>
      )}

      <div ref={containerRef} style={loading ? { height: 0, overflow: "hidden" } : undefined} />

      <SlashMenu view={viewRef.current} items={slashMenuItems} menuState={slashMenuState} />
      <SelectionToolbar view={viewRef.current} readonly={readonly || loading} updateVersion={editorUpdateVersion} />
      <TableControlsOverlay
        view={viewRef.current}
        rootRef={editorRootRef}
        readonly={readonly || loading}
        updateVersion={editorUpdateVersion}
      />

      {!readonly && (
        <div
          className="blog-editor-padding"
          onClick={(event) => viewRef.current && focusEditorAtPointerEdge(viewRef.current, event.clientY)}
          role="button"
          tabIndex={-1}
          aria-hidden
        />
      )}

      {!readonly && <div className="blog-editor-status">{isSaving ? "保存中…" : "自动保存"}</div>}
    </div>
  );
};

export default BlogEditor;
