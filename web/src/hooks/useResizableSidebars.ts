import { useCallback, useEffect, useMemo, useRef, useState } from "react";

const DEFAULT_LEFT_WIDTH = 20;
const DEFAULT_RIGHT_WIDTH = 20;
const MIN_PANEL_WIDTH = 10;
const MAX_PANEL_WIDTH = 35;

interface ResizableSidebarsOptions {
  storageKey?: string;
  initialLeftWidth?: number;
  initialRightWidth?: number;
  minWidth?: number;
  maxWidth?: number;
}

type SidebarSide = "left" | "right";

const clampWidth = (value: number, minWidth: number, maxWidth: number) => Math.max(minWidth, Math.min(maxWidth, value));

const readStoredWidth = (key: string | undefined, fallback: number, minWidth: number, maxWidth: number) => {
  if (!key) {
    return fallback;
  }

  try {
    const stored = localStorage.getItem(key);
    if (!stored) {
      return fallback;
    }
    const parsed = Number.parseFloat(stored);
    if (!Number.isFinite(parsed)) {
      return fallback;
    }
    return clampWidth(parsed, minWidth, maxWidth);
  } catch {
    return fallback;
  }
};

const storeWidth = (key: string | undefined, value: number) => {
  if (!key) {
    return;
  }

  try {
    localStorage.setItem(key, value.toString());
  } catch {
    // Ignore storage failures so resizing still works in restricted browsing modes.
  }
};

export const useResizableSidebars = (options: ResizableSidebarsOptions = {}) => {
  const {
    storageKey,
    initialLeftWidth = DEFAULT_LEFT_WIDTH,
    initialRightWidth = DEFAULT_RIGHT_WIDTH,
    minWidth = MIN_PANEL_WIDTH,
    maxWidth = MAX_PANEL_WIDTH,
  } = options;
  const leftStorageKey = storageKey ? `${storageKey}:left` : undefined;
  const rightStorageKey = storageKey ? `${storageKey}:right` : undefined;

  const [leftWidth, setLeftWidth] = useState(() => readStoredWidth(leftStorageKey, initialLeftWidth, minWidth, maxWidth));
  const [rightWidth, setRightWidth] = useState(() => readStoredWidth(rightStorageKey, initialRightWidth, minWidth, maxWidth));
  const containerRef = useRef<HTMLDivElement>(null);
  const draggingRef = useRef<SidebarSide | null>(null);
  const cleanupRef = useRef<(() => void) | null>(null);

  const stopDragging = useCallback(() => {
    draggingRef.current = null;
    cleanupRef.current?.();
    cleanupRef.current = null;
    document.body.style.cursor = "";
    document.body.style.userSelect = "";
  }, []);

  const handleResize = useCallback(
    (side: SidebarSide, clientX: number) => {
      const container = containerRef.current;
      if (!container) {
        return;
      }

      const rect = container.getBoundingClientRect();
      if (rect.width <= 0) {
        return;
      }

      const pct = ((clientX - rect.left) / rect.width) * 100;
      if (side === "left") {
        const nextWidth = clampWidth(pct, minWidth, maxWidth);
        setLeftWidth(nextWidth);
        storeWidth(leftStorageKey, nextWidth);
        return;
      }

      const nextWidth = clampWidth(100 - pct, minWidth, maxWidth);
      setRightWidth(nextWidth);
      storeWidth(rightStorageKey, nextWidth);
    },
    [leftStorageKey, maxWidth, minWidth, rightStorageKey],
  );

  const handlePointerDown = useCallback(
    (side: SidebarSide) => (event: React.PointerEvent<HTMLDivElement>) => {
      if (event.button !== 0) {
        return;
      }

      event.preventDefault();
      draggingRef.current = side;
      document.body.style.cursor = "col-resize";
      document.body.style.userSelect = "none";

      const pointerId = event.pointerId;
      const target = event.currentTarget;
      target.setPointerCapture?.(pointerId);

      const onPointerMove = (moveEvent: PointerEvent) => {
        if (draggingRef.current !== side) {
          return;
        }
        handleResize(side, moveEvent.clientX);
      };
      const onPointerUp = () => {
        target.releasePointerCapture?.(pointerId);
        stopDragging();
      };

      window.addEventListener("pointermove", onPointerMove);
      window.addEventListener("pointerup", onPointerUp, { once: true });
      window.addEventListener("pointercancel", onPointerUp, { once: true });
      cleanupRef.current = () => {
        window.removeEventListener("pointermove", onPointerMove);
        window.removeEventListener("pointerup", onPointerUp);
        window.removeEventListener("pointercancel", onPointerUp);
      };
    },
    [handleResize, stopDragging],
  );

  useEffect(() => stopDragging, [stopDragging]);

  const leftResizeHandleProps = useMemo(
    () => ({
      role: "separator",
      "aria-label": "Resize left sidebar",
      "aria-orientation": "vertical" as const,
      "aria-valuemin": minWidth,
      "aria-valuemax": maxWidth,
      "aria-valuenow": Math.round(leftWidth),
      onPointerDown: handlePointerDown("left"),
    }),
    [handlePointerDown, leftWidth, maxWidth, minWidth],
  );

  const rightResizeHandleProps = useMemo(
    () => ({
      role: "separator",
      "aria-label": "Resize right sidebar",
      "aria-orientation": "vertical" as const,
      "aria-valuemin": minWidth,
      "aria-valuemax": maxWidth,
      "aria-valuenow": Math.round(rightWidth),
      onPointerDown: handlePointerDown("right"),
    }),
    [handlePointerDown, maxWidth, minWidth, rightWidth],
  );

  return {
    containerRef,
    leftWidth,
    rightWidth,
    leftResizeHandleProps,
    rightResizeHandleProps,
  };
};
