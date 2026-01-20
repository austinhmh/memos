import { createContext, type ReactNode, useContext, useState } from "react";

export type LayoutMode = "LIST" | "MASONRY";
export type CompactMode = "auto" | "always" | "never";

interface ViewContextValue {
  orderByTimeAsc: boolean;
  layout: LayoutMode;
  compactMode: CompactMode;
  compactLines: number;
  toggleSortOrder: () => void;
  setLayout: (layout: LayoutMode) => void;
  setCompactMode: (mode: CompactMode) => void;
  setCompactLines: (lines: number) => void;
}

const ViewContext = createContext<ViewContextValue | null>(null);

const LOCAL_STORAGE_KEY = "memos-view-setting";

export function ViewProvider({ children }: { children: ReactNode }) {
  // Load initial state from localStorage
  const getInitialState = () => {
    try {
      const cached = localStorage.getItem(LOCAL_STORAGE_KEY);
      if (cached) {
        const data = JSON.parse(cached);
        return {
          orderByTimeAsc: Boolean(data.orderByTimeAsc ?? false),
          layout: (["LIST", "MASONRY"].includes(data.layout) ? data.layout : "LIST") as LayoutMode,
          compactMode: (["auto", "always", "never"].includes(data.compactMode) ? data.compactMode : "auto") as CompactMode,
          compactLines: typeof data.compactLines === "number" && data.compactLines >= 3 && data.compactLines <= 10 
            ? data.compactLines 
            : 6,
        };
      }
    } catch (error) {
      console.warn("Failed to load view settings from localStorage:", error);
    }
    return { 
      orderByTimeAsc: false, 
      layout: "LIST" as LayoutMode,
      compactMode: "auto" as CompactMode,
      compactLines: 6,
    };
  };

  const [viewState, setViewState] = useState(getInitialState);

  const persistToStorage = (newState: typeof viewState) => {
    try {
      localStorage.setItem(LOCAL_STORAGE_KEY, JSON.stringify(newState));
    } catch (error) {
      console.warn("Failed to persist view settings:", error);
    }
  };

  const toggleSortOrder = () => {
    setViewState((prev) => {
      const newState = { ...prev, orderByTimeAsc: !prev.orderByTimeAsc };
      persistToStorage(newState);
      return newState;
    });
  };

  const setLayout = (layout: LayoutMode) => {
    setViewState((prev) => {
      const newState = { ...prev, layout };
      persistToStorage(newState);
      return newState;
    });
  };

  const setCompactMode = (compactMode: CompactMode) => {
    setViewState((prev) => {
      const newState = { ...prev, compactMode };
      persistToStorage(newState);
      return newState;
    });
  };

  const setCompactLines = (compactLines: number) => {
    setViewState((prev) => {
      const newState = { ...prev, compactLines };
      persistToStorage(newState);
      return newState;
    });
  };

  return (
    <ViewContext.Provider
      value={{
        ...viewState,
        toggleSortOrder,
        setLayout,
        setCompactMode,
        setCompactLines,
      }}
    >
      {children}
    </ViewContext.Provider>
  );
}

export function useView() {
  const context = useContext(ViewContext);
  if (!context) {
    throw new Error("useView must be used within ViewProvider");
  }
  return context;
}
