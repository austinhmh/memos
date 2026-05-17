import type { EditorView } from "prosemirror-view";
import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { isViewComposing, runAfterCompositionSettled } from "../plugins/CompositionGuardPlugin";
import { matchSlashMenuText, type SlashMenuItem, type SlashMenuState } from "../plugins/SlashMenuPlugin";

interface SlashMenuProps {
  view: EditorView | null;
  items: SlashMenuItem[];
  menuState: SlashMenuState;
}

export const SlashMenu = ({ view, items, menuState }: SlashMenuProps) => {
  const [selectedIndex, setSelectedIndex] = useState(0);
  const menuRef = useRef<HTMLDivElement>(null);
  const [liveQuery, setLiveQuery] = useState("");

  useEffect(() => {
    if (!menuState.open || !view) {
      setLiveQuery("");
      return;
    }
    let raf: number;
    const poll = () => {
      try {
        if (isViewComposing(view)) {
          raf = requestAnimationFrame(poll);
          return;
        }

        const { $from } = view.state.selection;
        const tb = $from.parent.textBetween(Math.max(0, $from.parentOffset - 100), $from.parentOffset, undefined, "\ufffc");
        const match = matchSlashMenuText(tb);
        setLiveQuery(match?.query ?? "");
      } catch {
        /* ignore */
      }
      raf = requestAnimationFrame(poll);
    };
    raf = requestAnimationFrame(poll);
    return () => cancelAnimationFrame(raf);
  }, [menuState.open, view]);

  const filtered = useMemo(() => {
    return items.filter((item) => {
      if (!liveQuery) return true;
      const q = liveQuery.toLowerCase();
      const tokens = [item.id.toLowerCase(), item.label.toLowerCase(), ...(item.keywords ? item.keywords.toLowerCase().split(/\s+/) : [])];
      return tokens.some((token) => token.startsWith(q));
    });
  }, [items, liveQuery]);

  useEffect(() => {
    setSelectedIndex(0);
  }, [liveQuery]);

  const executeItem = useCallback(
    (item: SlashMenuItem) => {
      if (!view) return;
      const { state } = view;
      const { from } = menuState;
      const to = state.selection.$from.pos;
      const deleteFrom = Math.max(from, 0);
      const deleteTo = Math.min(to, state.doc.content.size);

      if (deleteFrom >= deleteTo) {
        if (isViewComposing(view)) {
          void runAfterCompositionSettled(view, () => item.action(view));
          return;
        }
        item.action(view);
        return;
      }

      if (isViewComposing(view)) {
        void runAfterCompositionSettled(view, () => executeItem(item));
        return;
      }

      const $from = state.doc.resolve(deleteFrom);
      const parentStart = $from.start($from.depth);
      const textBeforeSlash = state.doc.textBetween(parentStart, deleteFrom).trim();

      if (textBeforeSlash.length > 0) {
        let tr = state.tr;
        tr = tr.delete(deleteFrom, deleteTo);
        tr = tr.split(deleteFrom);
        view.dispatch(tr);
        setTimeout(() => {
          if (isViewComposing(view)) {
            void runAfterCompositionSettled(view, () => executeItem(item));
            return;
          }

          const newState = view.state;
          const cursorPos = newState.selection.$from.pos;
          const $cur = newState.doc.resolve(cursorPos);
          const blockStart = $cur.start($cur.depth);
          const blockEnd = $cur.end($cur.depth);
          if (blockEnd > blockStart) {
            view.dispatch(newState.tr.delete(blockStart, blockEnd));
          }
          setTimeout(() => {
            if (isViewComposing(view)) {
              void runAfterCompositionSettled(view, () => item.action(view));
              return;
            }
            item.action(view);
          }, 0);
        }, 0);
      } else {
        view.dispatch(state.tr.delete(deleteFrom, deleteTo));
        setTimeout(() => {
          if (isViewComposing(view)) {
            void runAfterCompositionSettled(view, () => item.action(view));
            return;
          }
          item.action(view);
        }, 0);
      }
    },
    [view, menuState],
  );

  useEffect(() => {
    if (!menuState.open || !view) return;

    const handler = (e: KeyboardEvent) => {
      if (e.isComposing || isViewComposing(view)) {
        return;
      }

      if (e.key === "ArrowDown") {
        e.preventDefault();
        setSelectedIndex((i) => (i + 1) % Math.max(filtered.length, 1));
      } else if (e.key === "ArrowUp") {
        e.preventDefault();
        setSelectedIndex((i) => (i - 1 + filtered.length) % Math.max(filtered.length, 1));
      } else if (e.key === "Enter" || e.key === "Tab") {
        e.preventDefault();
        if (filtered[selectedIndex]) {
          executeItem(filtered[selectedIndex]);
        }
      }
    };

    window.addEventListener("keydown", handler, true);
    return () => window.removeEventListener("keydown", handler, true);
  }, [menuState.open, view, filtered, selectedIndex, executeItem]);

  useEffect(() => {
    const el = menuRef.current?.children[selectedIndex] as HTMLElement | undefined;
    el?.scrollIntoView({ block: "nearest" });
  }, [selectedIndex]);

  if (!menuState.open || !view || filtered.length === 0 || isViewComposing(view)) return null;

  let left = 0;
  let top = 0;
  try {
    const pos = Math.min(menuState.from, view.state.doc.content.size);
    const coords = view.coordsAtPos(pos);
    left = coords.left;
    top = coords.bottom + 4;
  } catch {
    return null;
  }

  let currentGroup = "";

  const menuWidth = Math.min(240, Math.max(0, window.innerWidth - 16));
  const menuHeight = Math.min(320, Math.max(0, window.innerHeight - 16));
  const maxLeft = Math.max(8, window.innerWidth - menuWidth - 8);
  const maxTop = Math.max(8, window.innerHeight - menuHeight - 8);
  const limitedLeft = Math.max(8, Math.min(maxLeft, left));
  const limitedTop = Math.max(8, Math.min(maxTop, top));

  return createPortal(
    <div
      ref={menuRef}
      className="slash-menu"
      style={{
        position: "fixed",
        left: `${limitedLeft}px`,
        top: `${limitedTop}px`,
        zIndex: 9999,
      }}
    >
      {filtered.map((item, i) => {
        const showGroup = item.group && item.group !== currentGroup;
        if (item.group) currentGroup = item.group;

        return (
          <div key={item.id}>
            {showGroup && <div className="slash-menu-group">{item.group}</div>}
            <button
              type="button"
              className={`slash-menu-item ${i === selectedIndex ? "selected" : ""}`}
              onMouseEnter={() => setSelectedIndex(i)}
              onMouseDown={(e) => {
                e.preventDefault();
                executeItem(item);
              }}
            >
              <span
                className="slash-menu-icon"
                style={{
                  backgroundColor: item.iconBg || undefined,
                }}
              >
                {item.icon && item.iconColor && React.isValidElement(item.icon)
                  ? React.cloneElement(item.icon as React.ReactElement<{ color?: string }>, { color: item.iconColor })
                  : item.icon}
              </span>
              <span className="slash-menu-text">
                <span className="slash-menu-label">{item.label}</span>
                {item.subtitle && <span className="slash-menu-subtitle">{item.subtitle}</span>}
              </span>
            </button>
          </div>
        );
      })}
    </div>,
    document.body,
  );
};
