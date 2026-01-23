import { useEffect, useRef } from "react";

interface UseIntelligentScrollSyncOptions {
  editorTextAreaRef: React.RefObject<HTMLTextAreaElement>;
  previewScrollRef: React.RefObject<HTMLDivElement>;
  content: string;
}

/**
 * Intelligent scroll synchronization between editor and preview
 * Maps editor line numbers to preview elements using data-source-line attributes
 * 
 * Key improvements:
 * - Directly monitors textarea scroll events (not wrapper container)
 * - Implements hybrid synchronization: progress-based + line-based
 * - Handles bidirectional synchronization with proper debouncing
 * - Accounts for content length differences between Markdown and rendered HTML
 */
export const useIntelligentScrollSync = ({
  editorTextAreaRef,
  previewScrollRef,
  content,
}: UseIntelligentScrollSyncOptions) => {
  const isSyncingRef = useRef(false);
  const lastSyncTimeRef = useRef(0);
  const lastScrollSourceRef = useRef<"editor" | "preview" | null>(null);

  useEffect(() => {
    const editor = editorTextAreaRef.current;
    const previewScroll = previewScrollRef.current;

    if (!editor || !previewScroll) {
      return;
    }

    /**
     * Get all elements with source line information in the preview
     * Returns sorted array for efficient lookup
     */
    const getPreviewElementsWithLines = (): Array<{ element: HTMLElement; line: number; top: number }> => {
      const elements = previewScroll.querySelectorAll<HTMLElement>("[data-source-line]");
      return Array.from(elements)
        .map((element) => ({
          element,
          line: parseInt(element.getAttribute("data-source-line") || "0", 10),
          top: element.offsetTop,
        }))
        .filter((item) => item.line > 0)
        .sort((a, b) => a.line - b.line);
    };

    /**
     * Calculate the current line number at the editor's scroll position
     * Uses the center of the visible viewport for better UX
     */
    const getEditorLineAtScroll = (): number => {
      const lineHeight = parseFloat(getComputedStyle(editor).lineHeight) || 24;
      const centerScrollTop = editor.scrollTop + editor.clientHeight / 2;
      const line = Math.floor(centerScrollTop / lineHeight) + 1;
      const totalLines = editor.value.split("\n").length;
      return Math.max(1, Math.min(line, totalLines));
    };

    /**
     * Find the preview element that best corresponds to a given editor line
     * Uses intelligent matching to handle multi-line Markdown blocks
     */
    const findPreviewElementForLine = (targetLine: number): { element: HTMLElement; line: number; top: number } | null => {
      const elementsWithLines = getPreviewElementsWithLines();
      if (elementsWithLines.length === 0) return null;

      // Find the element at or before the target line
      let bestMatch = elementsWithLines[0];
      for (const item of elementsWithLines) {
        if (item.line <= targetLine) {
          bestMatch = item;
        } else {
          break;
        }
      }

      return bestMatch;
    };

    /**
     * Get the editor line number for the current preview scroll position
     * Looks at elements in the visible viewport center
     */
    const getEditorLineForPreviewScroll = (): number => {
      const elementsWithLines = getPreviewElementsWithLines();
      if (elementsWithLines.length === 0) return 1;

      // Find element at the center of the visible area
      const centerScrollTop = previewScroll.scrollTop + previewScroll.clientHeight / 2;
      
      let bestMatch = elementsWithLines[0];
      for (const item of elementsWithLines) {
        if (item.top <= centerScrollTop) {
          bestMatch = item;
        } else {
          break;
        }
      }

      return bestMatch.line;
    };

    /**
     * Scroll editor to a specific line, keeping it centered
     */
    const scrollEditorToLine = (line: number) => {
      const lineHeight = parseFloat(getComputedStyle(editor).lineHeight) || 24;
      // Center the target line in the viewport
      const targetScrollTop = (line - 1) * lineHeight - editor.clientHeight / 2 + lineHeight / 2;
      editor.scrollTop = Math.max(0, targetScrollTop);
    };

    /**
     * Scroll preview to show a specific element, keeping it centered
     */
    const scrollPreviewToElement = (elementTop: number) => {
      // Center the element in the viewport
      const targetScrollTop = elementTop - previewScroll.clientHeight / 2;
      previewScroll.scrollTop = Math.max(0, targetScrollTop);
    };

    /**
     * Hybrid synchronization: progress-based with line-based refinement
     * This handles cases where Markdown and rendered HTML have different heights
     */
    const syncEditorToPreview = () => {
      const elementsWithLines = getPreviewElementsWithLines();
      if (elementsWithLines.length === 0) {
        // Fallback to simple progress-based sync
        const progress = editor.scrollTop / (editor.scrollHeight - editor.clientHeight || 1);
        previewScroll.scrollTop = progress * (previewScroll.scrollHeight - previewScroll.clientHeight);
        return;
      }

      // Line-based sync for better accuracy
      const currentLine = getEditorLineAtScroll();
      const previewElement = findPreviewElementForLine(currentLine);

      if (previewElement) {
        scrollPreviewToElement(previewElement.top);
      }
    };

    /**
     * Sync preview scroll to editor
     * Uses line mapping to find corresponding editor position
     */
    const syncPreviewToEditor = () => {
      const elementsWithLines = getPreviewElementsWithLines();
      if (elementsWithLines.length === 0) {
        // Fallback to simple progress-based sync
        const progress = previewScroll.scrollTop / (previewScroll.scrollHeight - previewScroll.clientHeight || 1);
        editor.scrollTop = progress * (editor.scrollHeight - editor.clientHeight);
        return;
      }

      // Line-based sync for better accuracy
      const targetLine = getEditorLineForPreviewScroll();
      scrollEditorToLine(targetLine);
    };

    /**
     * Handle editor scroll - sync to preview
     */
    const handleEditorScroll = () => {
      const now = Date.now();
      
      // Prevent sync loops and rate limit
      if (isSyncingRef.current || now - lastSyncTimeRef.current < 50) {
        return;
      }

      // If preview was the last scroll source, don't sync back immediately
      if (lastScrollSourceRef.current === "preview" && now - lastSyncTimeRef.current < 150) {
        return;
      }

      isSyncingRef.current = true;
      lastSyncTimeRef.current = now;
      lastScrollSourceRef.current = "editor";

      requestAnimationFrame(() => {
        try {
          syncEditorToPreview();
        } finally {
          setTimeout(() => {
            isSyncingRef.current = false;
          }, 100);
        }
      });
    };

    /**
     * Handle preview scroll - sync to editor
     */
    const handlePreviewScroll = () => {
      const now = Date.now();
      
      // Prevent sync loops and rate limit
      if (isSyncingRef.current || now - lastSyncTimeRef.current < 50) {
        return;
      }

      // If editor was the last scroll source, don't sync back immediately
      if (lastScrollSourceRef.current === "editor" && now - lastSyncTimeRef.current < 150) {
        return;
      }

      isSyncingRef.current = true;
      lastSyncTimeRef.current = now;
      lastScrollSourceRef.current = "preview";

      requestAnimationFrame(() => {
        try {
          syncPreviewToEditor();
        } finally {
          setTimeout(() => {
            isSyncingRef.current = false;
          }, 100);
        }
      });
    };

    // Attach event listeners directly to textarea and preview scroll container
    editor.addEventListener("scroll", handleEditorScroll, { passive: true });
    previewScroll.addEventListener("scroll", handlePreviewScroll, { passive: true });

    return () => {
      editor.removeEventListener("scroll", handleEditorScroll);
      previewScroll.removeEventListener("scroll", handlePreviewScroll);
    };
  }, [editorTextAreaRef, previewScrollRef, content]); // Re-sync when content changes
};
