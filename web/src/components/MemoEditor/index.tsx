import { useQueryClient } from "@tanstack/react-query";
import { useRef } from "react";
import { toast } from "react-hot-toast";
import { useAuth } from "@/contexts/AuthContext";
import useCurrentUser from "@/hooks/useCurrentUser";
import { memoKeys } from "@/hooks/useMemoQueries";
import { userKeys } from "@/hooks/useUserQueries";
import { handleError } from "@/lib/error";
import { cn } from "@/lib/utils";
import { useTranslate } from "@/utils/i18n";
import { convertVisibilityFromString } from "@/utils/memo";
import { EditorContent, EditorMetadata, EditorPreview, EditorToolbar, FocusModeExitButton, FocusModeOverlay } from "./components";
import { FOCUS_MODE_STYLES } from "./constants";
import type { EditorRefActions } from "./Editor";
import { useAutoSave, useFocusMode, useKeyboard, useMemoInit, useResizable } from "./hooks";
import { cacheService, errorService, memoService, validationService } from "./services";
import { EditorProvider, useEditorContext } from "./state";
import type { MemoEditorProps } from "./types";

const MemoEditor = (props: MemoEditorProps) => {
  const { className, cacheKey, memoName, parentMemoName, autoFocus, compact, noPreview, placeholder, onConfirm, onCancel } = props;

  return (
    <EditorProvider>
      <MemoEditorImpl
        className={className}
        cacheKey={cacheKey}
        memoName={memoName}
        parentMemoName={parentMemoName}
        autoFocus={autoFocus}
        compact={compact}
        noPreview={noPreview}
        placeholder={placeholder}
        onConfirm={onConfirm}
        onCancel={onCancel}
      />
    </EditorProvider>
  );
};

const MemoEditorImpl: React.FC<MemoEditorProps> = ({
  className,
  cacheKey,
  memoName,
  parentMemoName,
  autoFocus,
  compact,
  noPreview,
  placeholder,
  onConfirm,
  onCancel,
}) => {
  const t = useTranslate();
  const queryClient = useQueryClient();
  const currentUser = useCurrentUser();
  const editorRef = useRef<EditorRefActions>(null);
  const { state, actions, dispatch } = useEditorContext();
  const { userGeneralSetting } = useAuth();

  const defaultVisibility = userGeneralSetting?.memoVisibility ? convertVisibilityFromString(userGeneralSetting.memoVisibility) : undefined;

  useMemoInit(editorRef, memoName, cacheKey, currentUser?.name ?? "", autoFocus, defaultVisibility);
  useAutoSave(state.content, currentUser?.name ?? "", cacheKey);
  useFocusMode(state.ui.isFocusMode);

  const { containerRef, leftWidth, rightWidth, handleMouseDown } = useResizable({
    initialWidth: 50,
    minWidth: 30,
    maxWidth: 70,
    storageKey: "memo-editor-split-width",
  });

  const handleToggleFocusMode = () => {
    dispatch(actions.toggleFocusMode());
  };

  useKeyboard(editorRef, {
    onSave: handleSave,
    onToggleFocusMode: handleToggleFocusMode,
  });

  async function handleSave() {
    const { valid, reason } = validationService.canSave(state);
    if (!valid) {
      toast.error(reason || "Cannot save");
      return;
    }

    dispatch(actions.setLoading("saving", true));

    try {
      const result = await memoService.save(state, { memoName, parentMemoName });

      if (!result.hasChanges) {
        toast.error(t("editor.no-changes-detected"));
        onCancel?.();
        return;
      }

      cacheService.clear(cacheService.key(currentUser?.name ?? "", cacheKey));

      const invalidationPromises = [
        queryClient.invalidateQueries({ queryKey: memoKeys.lists() }),
        queryClient.invalidateQueries({ queryKey: userKeys.stats() }),
      ];

      if (parentMemoName) {
        invalidationPromises.push(queryClient.invalidateQueries({ queryKey: memoKeys.comments(parentMemoName) }));
      }

      await Promise.all(invalidationPromises);
      dispatch(actions.reset());
      onConfirm?.(result.memoName);
    } catch (error) {
      handleError(error, toast.error, {
        context: "Failed to save memo",
        fallbackMessage: errorService.getErrorMessage(error),
      });
    } finally {
      dispatch(actions.setLoading("saving", false));
    }
  }

  if (compact) {
    return (
      <div className={cn("group relative w-full flex flex-col bg-card px-4 pt-3 pb-1 rounded-lg border border-border gap-2", className)}>
        <EditorContent ref={editorRef} placeholder={placeholder} autoFocus={autoFocus} compact />
        <div className="w-full flex flex-col gap-2 flex-shrink-0">
          <EditorMetadata memoName={memoName} />
          <EditorToolbar onSave={handleSave} onCancel={onCancel} memoName={memoName} />
        </div>
      </div>
    );
  }

  if (noPreview) {
    return (
      <>
        <FocusModeOverlay isActive={state.ui.isFocusMode} onToggle={handleToggleFocusMode} />
        <div
          className={cn(
            "group relative w-full flex flex-col bg-card px-4 pt-3 rounded-lg border border-border gap-2",
            FOCUS_MODE_STYLES.transition,
            state.ui.isFocusMode ? cn(FOCUS_MODE_STYLES.container.base, FOCUS_MODE_STYLES.container.spacing) : "",
            className,
          )}
        >
          <FocusModeExitButton isActive={state.ui.isFocusMode} onToggle={handleToggleFocusMode} title={t("editor.exit-focus-mode")} />
          <EditorContent ref={editorRef} placeholder={placeholder} autoFocus={autoFocus} />
        </div>

        <div className="fixed bottom-0 left-0 right-0 z-10 bg-background/95 backdrop-blur border-t border-border px-4 py-2">
          <div className="max-w-4xl mx-auto">
            <EditorMetadata memoName={memoName} />
            <EditorToolbar onSave={handleSave} onCancel={onCancel} memoName={memoName} />
          </div>
        </div>
      </>
    );
  }

  return (
    <>
      <FocusModeOverlay isActive={state.ui.isFocusMode} onToggle={handleToggleFocusMode} />

      <div
        className={cn(
          "group relative w-full flex flex-col bg-card px-4 pt-3 pb-1 rounded-lg border border-border gap-2",
          FOCUS_MODE_STYLES.transition,
          state.ui.isFocusMode ? cn(FOCUS_MODE_STYLES.container.base, FOCUS_MODE_STYLES.container.spacing) : "min-h-[60vh]",
          className,
        )}
      >
        <FocusModeExitButton isActive={state.ui.isFocusMode} onToggle={handleToggleFocusMode} title={t("editor.exit-focus-mode")} />

        <div ref={containerRef} className="w-full flex flex-col md:flex-row gap-4 flex-1 min-h-0">
          <div
            className="flex flex-col justify-between gap-2 min-w-0 min-h-0"
            style={state.ui.isFocusMode ? { flex: 1 } : { width: `${leftWidth}%`, flexShrink: 0 }}
          >
            <EditorContent ref={editorRef} placeholder={placeholder} autoFocus={autoFocus} />

            <div className="w-full flex flex-col gap-2 flex-shrink-0">
              <EditorMetadata memoName={memoName} />
              <EditorToolbar onSave={handleSave} onCancel={onCancel} memoName={memoName} />
            </div>
          </div>

          {!state.ui.isFocusMode && (
            <div
              className="hidden md:block w-1 bg-border hover:bg-primary/50 cursor-col-resize transition-colors flex-shrink-0"
              onMouseDown={handleMouseDown}
            />
          )}

          <div
            className="hidden md:flex min-w-0 min-h-0"
            style={state.ui.isFocusMode ? { flex: 1 } : { width: `${rightWidth}%`, flexShrink: 0 }}
          >
            <EditorPreview content={state.content} />
          </div>
        </div>
      </div>
    </>
  );
};

export default MemoEditor;
