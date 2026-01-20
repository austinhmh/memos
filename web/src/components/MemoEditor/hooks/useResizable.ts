import { useCallback, useEffect, useRef, useState } from "react";

interface UseResizableOptions {
  initialWidth?: number;
  minWidth?: number;
  maxWidth?: number;
  storageKey?: string;
}

export const useResizable = (options: UseResizableOptions = {}) => {
  const { initialWidth = 50, minWidth = 30, maxWidth = 70, storageKey } = options;

  // Load saved width from localStorage if available
  const getSavedWidth = useCallback(() => {
    if (storageKey) {
      const saved = localStorage.getItem(storageKey);
      if (saved) {
        const parsed = parseFloat(saved);
        if (!isNaN(parsed) && parsed >= minWidth && parsed <= maxWidth) {
          return parsed;
        }
      }
    }
    return initialWidth;
  }, [storageKey, initialWidth, minWidth, maxWidth]);

  const [leftWidth, setLeftWidth] = useState(getSavedWidth);
  const [isDragging, setIsDragging] = useState(false);
  const containerRef = useRef<HTMLDivElement>(null);

  const handleMouseMove = useCallback(
    (e: MouseEvent) => {
      if (!containerRef.current) return;

      const container = containerRef.current;
      const containerRect = container.getBoundingClientRect();

      // Account for gap in flex container (gap-4 = 16px)
      const gap = 16;
      const offsetX = e.clientX - containerRect.left;
      const newLeftWidth = ((offsetX - gap / 2) / (containerRect.width - gap)) * 100;

      // Clamp the width between min and max
      const clampedWidth = Math.max(minWidth, Math.min(maxWidth, newLeftWidth));
      setLeftWidth(clampedWidth);

      // Save to localStorage if storageKey is provided
      if (storageKey) {
        localStorage.setItem(storageKey, clampedWidth.toString());
      }
    },
    [minWidth, maxWidth, storageKey],
  );

  const handleMouseUp = useCallback(() => {
    setIsDragging(false);
    document.body.style.cursor = "";
    document.body.style.userSelect = "";
  }, []);

  const handleMouseDown = useCallback((e: React.MouseEvent) => {
    e.preventDefault();
    setIsDragging(true);
    document.body.style.cursor = "col-resize";
    document.body.style.userSelect = "none";
  }, []);

  // Register/unregister event listeners based on dragging state
  useEffect(() => {
    if (isDragging) {
      document.addEventListener("mousemove", handleMouseMove);
      document.addEventListener("mouseup", handleMouseUp);

      return () => {
        document.removeEventListener("mousemove", handleMouseMove);
        document.removeEventListener("mouseup", handleMouseUp);
      };
    }
  }, [isDragging, handleMouseMove, handleMouseUp]);

  return {
    containerRef,
    leftWidth,
    rightWidth: 100 - leftWidth,
    handleMouseDown,
  };
};
