import { create } from "@bufbuild/protobuf";
import { FieldMaskSchema } from "@bufbuild/protobuf/wkt";
import { useQueryClient } from "@tanstack/react-query";
import { baseKeymap, chainCommands, toggleMark as pmToggleMark, setBlockType } from "prosemirror-commands";
import { history, redo, undo } from "prosemirror-history";
import { keymap } from "prosemirror-keymap";
import { Node, Slice } from "prosemirror-model";
import { liftListItem, sinkListItem, splitListItem } from "prosemirror-schema-list";
import { type Command, EditorState, type Plugin, TextSelection } from "prosemirror-state";
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
import { SlashMenu } from "./components/SlashMenu";
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
import { createHeadingIdPlugin } from "./plugins/HeadingIdPlugin";
import { createMermaidPlugin } from "./plugins/MermaidPlugin";
import { createSlashMenuPlugin, type SlashMenuState } from "./plugins/SlashMenuPlugin";

interface BlogEditorProps {
  memo: Memo;
  readonly?: boolean;
  onReady?: () => void;
  normalizeBeforeSave?: (content: string) => string;
}

const AUTOSAVE_DELAY = 2000;
const PASTED_IMAGE_FILENAME = "pasted-image.png";
const SERIALIZE_IDLE_TIMEOUT = 1200;

type IdleTaskWindow = Window &
  typeof globalThis & {
    requestIdleCallback?: (callback: IdleRequestCallback, options?: IdleRequestOptions) => number;
    cancelIdleCallback?: (handle: number) => void;
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

const buildBlogEditorKeymap = (manualSave: Command): Record<string, Command> => ({
  "Mod-a": chainCommands(selectAll(schema.nodes.code_block), selectAll(schema.nodes.blockquote)),
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

const BlogEditor = ({ memo, readonly = false, onReady, normalizeBeforeSave }: BlogEditorProps) => {
  const queryClient = useQueryClient();
  const dictionary = useDictionary();
  const containerRef = useRef<HTMLDivElement>(null);
  const viewRef = useRef<EditorView | null>(null);
  const [isSaving, setIsSaving] = useState(false);
  const [loading, setLoading] = useState(true);
  const saveTimerRef = useRef<ReturnType<typeof setTimeout>>();
  const serializeTaskRef = useRef<number>();
  const saveLoopPromiseRef = useRef<Promise<void> | null>(null);
  const pendingDocForSaveRef = useRef<Node | null>(null);
  const mountedRef = useRef(true);
  const lastPersistSucceededRef = useRef(true);
  const skipNextSaveRef = useRef(false);
  const readonlyRef = useRef(readonly);
  readonlyRef.current = readonly;
  const pasteListenerRef = useRef<{ dom: HTMLElement; handler: (e: Event) => void } | null>(null);
  const onReadyRef = useRef(onReady);
  onReadyRef.current = onReady;

  const normalizeContent = useCallback(
    (content: string) => (normalizeBeforeSave ? normalizeBeforeSave(content) : content),
    [normalizeBeforeSave],
  );

  const lastSavedRef = useRef(normalizeContent(memo.content));
  const lastSavedTagsRef = useRef(memo.tags ?? []);
  const contentRef = useRef(normalizeContent(memo.content));
  contentRef.current = normalizeContent(memo.content);

  const [slashMenuState, setSlashMenuState] = useState<SlashMenuState>({ open: false, query: "", from: 0, to: 0 });
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
    lastSavedTagsRef.current = memo.tags ?? [];
  }, [memo.name, memo.tags]);

  const persistContent = useCallback(
    async (normalizedContent: string) => {
      if (normalizedContent.trim() === lastSavedRef.current.trim()) {
        lastPersistSucceededRef.current = true;
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
        lastPersistSucceededRef.current = true;
        return true;
      } catch (err) {
        console.error(err);
        lastPersistSucceededRef.current = false;
        toast.error("保存失败");
        return false;
      }
    },
    [memo.name, queryClient],
  );

  const persistContentRef = useRef(persistContent);
  persistContentRef.current = persistContent;

  const runPendingSaveLoop = useCallback(async () => {
    let saveStarted = false;

    try {
      while (pendingDocForSaveRef.current) {
        const latestDoc = pendingDocForSaveRef.current;
        pendingDocForSaveRef.current = null;

        const md = serializer.serialize(latestDoc);
        const normalizedContent = normalizeContent(md);
        if (normalizedContent.trim() === lastSavedRef.current.trim()) {
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
  }, [normalizeContent]);

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
        void startSaveLoopRef.current?.();
      }
    });

    saveLoopPromiseRef.current = loopPromise;
    return loopPromise;
  }, [runPendingSaveLoop]);
  startSaveLoopRef.current = startSaveLoop;

  const waitForPendingSaves = useCallback(async () => {
    while (saveLoopPromiseRef.current || pendingDocForSaveRef.current) {
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
      pendingDocForSaveRef.current = doc;

      if (serializeTaskRef.current !== undefined) {
        cancelIdleTask(serializeTaskRef.current);
        serializeTaskRef.current = undefined;
      }

      if (immediate) {
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
          history(),
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
          keymap(baseKeymap),
        ],
      });

      const view = new EditorView(el, {
        state,
        editable: () => !readonlyRef.current,
        attributes: { class: "blog-editor-content ProseMirror blog-editor-prosemirror", spellcheck: "false" },
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
        dispatchTransaction(this: EditorView, tr) {
          const nextState = this.state.apply(tr);
          this.updateState(nextState);

          if (!readonlyRef.current && tr.docChanged) {
            if (skipNextSaveRef.current) {
              skipNextSaveRef.current = false;
              return;
            }
            if (saveTimerRef.current) clearTimeout(saveTimerRef.current);
            const latestDoc = nextState.doc;
            saveTimerRef.current = setTimeout(() => {
              flushPendingSave(latestDoc);
            }, AUTOSAVE_DELAY);
          }
        },
      });

      viewRef.current = view;
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

    const normalizedContent = normalizeContent(memo.content);
    if (normalizedContent === lastSavedRef.current) return;

    if (normalizedContent.trim() === lastSavedRef.current.trim()) {
      lastSavedRef.current = normalizedContent;
      return;
    }

    lastSavedRef.current = normalizedContent;
    skipNextSaveRef.current = true;

    parseInWorker(normalizedContent).then((json) => {
      if (!mountedRef.current || !viewRef.current) return;
      try {
        const doc = Node.fromJSON(schema, json);
        const v = viewRef.current;
        const tr = v.state.tr.replaceWith(0, v.state.doc.content.size, doc.content);
        v.dispatch(tr);
      } catch (err) {
        console.error("[BlogEditor] external content sync failed:", err);
      }
    });
  }, [memo.content, normalizeContent]);

  useEffect(() => {
    const view = viewRef.current;
    if (!view) return;

    view.setProps({ editable: () => !readonly });
  }, [readonly]);

  useEffect(() => {
    const view = viewRef.current;
    if (!view) return;

    view.dispatch(view.state.tr.setMeta("theme", { isDark }));
  }, [isDark]);

  useEffect(() => {
    return () => {
      if (saveTimerRef.current) clearTimeout(saveTimerRef.current);
      cancelIdleTask(serializeTaskRef.current);
      serializeTaskRef.current = undefined;
      pendingDocForSaveRef.current = null;
    };
  }, []);

  return (
    <div className="blog-editor" style={{ position: "relative" }}>
      {loading && (
        <div className="blog-editor-content ProseMirror" style={{ padding: "2rem", color: "#888" }}>
          <p>正在加载文档…</p>
        </div>
      )}

      <div ref={containerRef} style={loading ? { height: 0, overflow: "hidden" } : undefined} />

      <SlashMenu view={viewRef.current} items={slashMenuItems} menuState={slashMenuState} />

      {!readonly && (
        <div className="blog-editor-padding" onClick={() => viewRef.current?.focus()} role="button" tabIndex={-1} aria-hidden />
      )}

      {!readonly && <div className="blog-editor-status">{isSaving ? "保存中…" : "自动保存"}</div>}
    </div>
  );
};

export default BlogEditor;
