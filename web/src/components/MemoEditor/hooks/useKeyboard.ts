import { useEffect } from "react";
import type { EditorRefActions } from "../Editor";

interface UseKeyboardOptions {
  onSave: () => void;
  onToggleFocusMode?: () => void;
}

export const useKeyboard = (editorRef: React.RefObject<EditorRefActions | null>, options: UseKeyboardOptions) => {
  useEffect(() => {
    const handleKeyDown = (event: KeyboardEvent) => {
      const editor = editorRef.current?.getEditor();
      if (!editor || document.activeElement !== editor) {
        return;
      }

      if ((event.metaKey || event.ctrlKey) && event.key === "Enter") {
        event.preventDefault();
        options.onSave();
        return;
      }

      if ((event.metaKey || event.ctrlKey) && event.shiftKey && event.key.toLowerCase() === "f") {
        event.preventDefault();
        options.onToggleFocusMode?.();
      }
    };

    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [editorRef, options]);
};
