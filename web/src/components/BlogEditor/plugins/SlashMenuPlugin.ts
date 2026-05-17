import type { EditorState } from "prosemirror-state";
import { Plugin, PluginKey, type Transaction } from "prosemirror-state";
import type { EditorView } from "prosemirror-view";

import type { ReactNode } from "react";
import { isCompositionTransaction, isViewComposing, runAfterCompositionSettled } from "./CompositionGuardPlugin";

export interface SlashMenuItem {
  id: string;
  label: string;
  subtitle?: string;
  icon?: ReactNode;
  iconColor?: string;
  iconBg?: string;
  keywords?: string;
  group?: string;
  action: (view: EditorView) => void;
}

export interface SlashMenuState {
  open: boolean;
  query: string;
  from: number;
  to: number;
}

export type SlashMenuTextMatch = {
  triggerWithQuery: string;
  query: string;
};

const SLASH_MENU_TRIGGERS = new Set(["/", "／", "、"]);
const SLASH_MENU_MATCH_RE = /(?:^|\s)([/／、]([^\s/／、]*))$/;

export const slashMenuPluginKey = new PluginKey<SlashMenuState>("slashMenu");

export function isSlashMenuTrigger(text: string): boolean {
  return Array.from(text).some((char) => SLASH_MENU_TRIGGERS.has(char));
}

export function matchSlashMenuText(textBefore: string): SlashMenuTextMatch | null {
  const match = SLASH_MENU_MATCH_RE.exec(textBefore);
  if (!match) {
    return null;
  }

  return {
    triggerWithQuery: match[1],
    query: match[2] ?? "",
  };
}

function getSlashMenuStateAtSelection(state: EditorState): SlashMenuState | undefined {
  const { $from } = state.selection;
  if ($from.parent.type.spec.code) {
    return undefined;
  }

  const textBefore = $from.parent.textBetween(Math.max(0, $from.parentOffset - 100), $from.parentOffset, undefined, "\ufffc");
  const match = matchSlashMenuText(textBefore);
  if (!match) {
    return undefined;
  }

  return {
    open: true,
    query: match.query,
    from: $from.pos - match.triggerWithQuery.length,
    to: $from.pos,
  };
}

function openSlashMenuAtSelection(view: EditorView) {
  const next = getSlashMenuStateAtSelection(view.state);
  if (!next) {
    return;
  }

  const current = slashMenuPluginKey.getState(view.state);
  if (current?.open && current.from === next.from && current.to === next.to && current.query === next.query) {
    return;
  }

  view.dispatch(view.state.tr.setMeta(slashMenuPluginKey, next));
}

function scheduleOpenSlashMenu(view: EditorView) {
  setTimeout(() => {
    if (isViewComposing(view)) {
      void runAfterCompositionSettled(view, () => openSlashMenuAtSelection(view));
      return;
    }

    openSlashMenuAtSelection(view);
  });
}

export function createSlashMenuPlugin(onStateChange: (state: SlashMenuState) => void): Plugin<SlashMenuState> {
  return new Plugin<SlashMenuState>({
    key: slashMenuPluginKey,
    state: {
      init: () => ({ open: false, query: "", from: 0, to: 0 }),
      apply(tr, prev, _oldState, newState) {
        const meta = tr.getMeta(slashMenuPluginKey);
        if (meta) return meta as SlashMenuState;

        if (isCompositionTransaction(tr)) {
          return prev;
        }

        if (!prev.open) return prev;

        if (!tr.docChanged && !tr.selectionSet) return prev;

        const next = getSlashMenuStateAtSelection(newState);
        if (next) {
          return next;
        }

        return { open: false, query: "", from: 0, to: 0 };
      },
    },
    props: {
      handleTextInput(view, _from, _to, text) {
        const state = slashMenuPluginKey.getState(view.state);
        if (!state?.open && isSlashMenuTrigger(text)) {
          scheduleOpenSlashMenu(view);
        }
        return false;
      },
      handleKeyDown(view, event) {
        const state = slashMenuPluginKey.getState(view.state);

        if (event.isComposing || isViewComposing(view)) {
          return false;
        }

        if (isSlashMenuTrigger(event.key) && !state?.open) {
          scheduleOpenSlashMenu(view);
          return false;
        }

        if (!state?.open) return false;

        if (event.key === "Escape") {
          const pluginState = slashMenuPluginKey.getState(view.state);
          const tr = view.state.tr;
          if (pluginState && pluginState.from < pluginState.to) {
            tr.delete(pluginState.from, pluginState.to);
          }
          tr.setMeta(slashMenuPluginKey, {
            open: false,
            query: "",
            from: 0,
            to: 0,
          });
          view.dispatch(tr);
          return true;
        }

        if (event.key === "ArrowDown" || event.key === "ArrowUp" || event.key === "Enter" || event.key === "Tab") {
          return true;
        }

        return false;
      },
    },
    view() {
      return {
        update(view) {
          if (isViewComposing(view)) {
            return;
          }
          const state = slashMenuPluginKey.getState(view.state);
          if (state) onStateChange(state);
        },
      };
    },
  });
}
