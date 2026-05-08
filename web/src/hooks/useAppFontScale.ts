import { useEffect } from "react";

export const APP_FONT_SCALE_CHANGE_EVENT = "memos:app-font-scale-change";

const STORAGE_KEY = "memos.appFontScale";
const DEFAULT_FONT_SCALE = 1;
const MIN_FONT_SCALE = 0.8;
const MAX_FONT_SCALE = 1.6;
const FONT_SCALE_STEP = 0.1;

const normalizeFontScale = (scale: number) => Math.min(MAX_FONT_SCALE, Math.max(MIN_FONT_SCALE, Number(scale.toFixed(2))));

const readStoredFontScale = () => {
  try {
    const stored = localStorage.getItem(STORAGE_KEY);
    const parsed = Number.parseFloat(stored ?? "");
    return Number.isFinite(parsed) ? normalizeFontScale(parsed) : DEFAULT_FONT_SCALE;
  } catch {
    return DEFAULT_FONT_SCALE;
  }
};

const writeStoredFontScale = (scale: number) => {
  try {
    localStorage.setItem(STORAGE_KEY, scale.toFixed(2));
  } catch {
    // Ignore storage failures in private browsing or restricted environments.
  }
};

const applyFontScale = (scale: number) => {
  document.documentElement.style.setProperty("--app-font-scale", scale.toFixed(2));
  window.dispatchEvent(new CustomEvent(APP_FONT_SCALE_CHANGE_EVENT, { detail: { scale } }));
};

const isZoomShortcut = (event: KeyboardEvent) => {
  if (!(event.metaKey || event.ctrlKey) || event.altKey) {
    return false;
  }

  const key = event.key.toLowerCase();
  return (
    ["+", "=", "-", "_", "0"].includes(key) ||
    ["Equal", "Minus", "Digit0", "NumpadAdd", "NumpadEqual", "NumpadSubtract", "Numpad0"].includes(event.code)
  );
};

const getNextFontScale = (event: KeyboardEvent, currentScale: number) => {
  const key = event.key.toLowerCase();

  if (key === "0" || event.code === "Digit0" || event.code === "Numpad0") {
    return DEFAULT_FONT_SCALE;
  }

  if (key === "-" || key === "_" || event.code === "Minus" || event.code === "NumpadSubtract") {
    return normalizeFontScale(currentScale - FONT_SCALE_STEP);
  }

  return normalizeFontScale(currentScale + FONT_SCALE_STEP);
};

export const useAppFontScale = () => {
  useEffect(() => {
    let fontScale = readStoredFontScale();
    applyFontScale(fontScale);

    const handleKeyDown = (event: KeyboardEvent) => {
      if (!isZoomShortcut(event)) {
        return;
      }

      event.preventDefault();
      event.stopPropagation();

      fontScale = getNextFontScale(event, fontScale);
      applyFontScale(fontScale);
      writeStoredFontScale(fontScale);
    };

    window.addEventListener("keydown", handleKeyDown, true);
    return () => window.removeEventListener("keydown", handleKeyDown, true);
  }, []);
};
