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
  const { className, cacheKey, memoName, parentMemoName, autoFocus, placeholder, onConfirm, onCancel } = props;

  return (
    <EditorProvider>
      <MemoEditorImpl
        className={className}
        cacheKey={cacheKey}
        memoName={memoName}
        parentMemoName={parentMemoName}
        autoFocus={autoFocus}
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

  // Get default visibility from user settings
  const defaultVisibility = userGeneralSetting?.memoVisibility ? convertVisibilityFromString(userGeneralSetting.memoVisibility) : undefined;

  useMemoInit(editorRef, memoName, cacheKey, currentUser?.name ?? "", autoFocus, defaultVisibility);

  // Auto-save content to localStorage
  useAutoSave(state.content, currentUser?.name ?? "", cacheKey);

  // Focus mode management with body scroll lock
  useFocusMode(state.ui.isFocusMode);

  // Resizable split view
  const { containerRef, leftWidth, rightWidth, handleMouseDown } = useResizable({
    initialWidth: 50,
    minWidth: 30,
    maxWidth: 70,
    storageKey: "memo-editor-split-width",
  });

  const handleToggleFocusMode = () => {
    dispatch(actions.toggleFocusMode());
  };

  useKeyboard(editorRef, { onSave: handleSave });

  async function handleSave() {
    // Validate before saving
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

      // Clear localStorage cache on successful save
      cacheService.clear(cacheService.key(currentUser?.name ?? "", cacheKey));

      // Invalidate React Query cache to refresh memo lists across the app
      const invalidationPromises = [
        queryClient.invalidateQueries({ queryKey: memoKeys.lists() }),
        queryClient.invalidateQueries({ queryKey: userKeys.stats() }),
      ];

      // If this was a comment, also invalidate the comments query for the parent memo
      if (parentMemoName) {
        invalidationPromises.push(queryClient.invalidateQueries({ queryKey: memoKeys.comments(parentMemoName) }));
      }

      await Promise.all(invalidationPromises);

      // Reset editor state to initial values
      dispatch(actions.reset());

      // Notify parent component of successful save
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

  return (
    <>
      <FocusModeOverlay isActive={state.ui.isFocusMode} onToggle={handleToggleFocusMode} />

      {/*
        Layout structure:
        - Split view: left side for editor, right side for preview
        - In focus mode: becomes fixed with specific spacing, both sides grow to fill space
        - In normal mode: adaptive height based on content, minimum 60vh
        - Responsive: stacks vertically on mobile (< md breakpoint)
      */}
      <div
        className={cn(
          "group relative w-full flex flex-col bg-card px-4 pt-3 pb-1 rounded-lg border border-border gap-2",
          FOCUS_MODE_STYLES.transition,
          state.ui.isFocusMode ? cn(FOCUS_MODE_STYLES.container.base, FOCUS_MODE_STYLES.container.spacing) : "min-h-[60vh]",
          className,
        )}
      >
        {/* Exit button is absolutely positioned in top-right corner when active */}
        <FocusModeExitButton isActive={state.ui.isFocusMode} onToggle={handleToggleFocusMode} title={t("editor.exit-focus-mode")} />

        {/* Split view container: horizontal on desktop, vertical on mobile */}
        <div ref={containerRef} className="w-full flex flex-col md:flex-row gap-4 flex-1 min-h-0">
          {/* Left side: Editor */}
          <div
            className="flex flex-col justify-between gap-2 min-w-0 min-h-0"
            style={state.ui.isFocusMode ? { flex: 1 } : { width: `${leftWidth}%`, flexShrink: 0 }}
          >
            {/* Editor content grows to fill available space */}
            <EditorContent ref={editorRef} placeholder={placeholder} autoFocus={autoFocus} />

            {/* Metadata and toolbar grouped together at bottom */}
            <div className="w-full flex flex-col gap-2 flex-shrink-0">
              <EditorMetadata memoName={memoName} />
              <EditorToolbar onSave={handleSave} onCancel={onCancel} memoName={memoName} />
            </div>
          </div>

          {/* Resizable divider (hidden on mobile and in focus mode) */}
          {!state.ui.isFocusMode && (
            <div
              className="hidden md:block w-1 bg-border hover:bg-primary/50 cursor-col-resize transition-colors flex-shrink-0"
              onMouseDown={handleMouseDown}
              title="拖动调整宽度"
            />
          )}

          {/* Right side: Preview (hidden on mobile, shown on md+ screens) */}
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
