import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";
import type { EditorView } from "prosemirror-view";
import type { SlashMenuItem, SlashMenuState } from "../plugins/SlashMenuPlugin";

interface SlashMenuProps {
  view: EditorView | null;
  items: SlashMenuItem[];
  menuState: SlashMenuState;
}

export const SlashMenu = ({ view, items, menuState }: SlashMenuProps) => {
  const [selectedIndex, setSelectedIndex] = useState(0);
  const menuRef = useRef<HTMLDivElement>(null);

  const filtered = useMemo(() => {
    return items.filter((item) => {
      if (!menuState.query) return true;
      const q = menuState.query.toLowerCase();
      const tokens = [
        item.id.toLowerCase(),
        item.label.toLowerCase(),
        ...(item.keywords ? item.keywords.toLowerCase().split(/\s+/) : []),
      ];
      return tokens.some((token) => token.startsWith(q));
    });
  }, [items, menuState.query]);

  useEffect(() => {
    setSelectedIndex(0);
  }, [menuState.query]);

  const executeItem = useCallback(
    (item: SlashMenuItem) => {
      if (!view) return;
      const { from } = menuState;
      const to = view.state.selection.$from.pos;
      const deleteTo = Math.min(to, view.state.doc.content.size);
      const deleteFrom = Math.min(from, deleteTo);
      view.dispatch(view.state.tr.delete(deleteFrom, deleteTo));
      setTimeout(() => {
        item.action(view);
      }, 0);
    },
    [view, menuState],
  );

  useEffect(() => {
    if (!menuState.open || !view) return;

    const handler = (e: KeyboardEvent) => {
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

  if (!menuState.open || !view || filtered.length === 0) return null;

  const coords = view.coordsAtPos(menuState.from);
  const left = coords.left;
  const top = coords.bottom + 4;

  let currentGroup = "";

  return createPortal(
    <div
      ref={menuRef}
      className="slash-menu"
      style={{
        position: "fixed",
        left: `${left}px`,
        top: `${top}px`,
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
              <span className="slash-menu-icon">{item.icon}</span>
              <span className="slash-menu-label">{item.label}</span>
            </button>
          </div>
        );
      })}
    </div>,
    document.body,
  );
};
