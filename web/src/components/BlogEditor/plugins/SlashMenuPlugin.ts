import { Plugin, PluginKey, type Transaction } from "prosemirror-state";
import type { EditorView } from "prosemirror-view";

import type { ReactNode } from "react";
import { isCompositionTransaction, isViewComposing } from "./CompositionGuardPlugin";

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

export const slashMenuPluginKey = new PluginKey<SlashMenuState>("slashMenu");

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

        const { $from } = newState.selection;
        const textBefore = $from.parent.textBetween(Math.max(0, $from.parentOffset - 100), $from.parentOffset, undefined, "\ufffc");

        const match = /\/([^\s/]*)$/.exec(textBefore);
        if (match) {
          const next: SlashMenuState = {
            open: true,
            query: match[1],
            from: $from.pos - match[0].length,
            to: $from.pos,
          };
          return next;
        }

        return { open: false, query: "", from: 0, to: 0 };
      },
    },
    props: {
      handleKeyDown(view, event) {
        const state = slashMenuPluginKey.getState(view.state);

        if (event.isComposing || isViewComposing(view)) {
          return false;
        }

        if (event.key === "/" && !state?.open) {
          const { $from } = view.state.selection;
          if ($from.parent.type.spec.code) return false;

          const textBefore = $from.parent.textBetween(Math.max(0, $from.parentOffset - 1), $from.parentOffset, undefined, "\ufffc");
          if (textBefore && !/\s$/.test(textBefore) && textBefore.length > 0) {
            return false;
          }

          setTimeout(() => {
            if (isViewComposing(view)) {
              return;
            }

            const { $from: currentFrom } = view.state.selection;
            if (currentFrom.parent.type.spec.code) return;

            const textBeforeSlash = currentFrom.parent.textBetween(
              Math.max(0, currentFrom.parentOffset - 1),
              currentFrom.parentOffset,
              undefined,
              "\ufffc",
            );
            if (textBeforeSlash !== "/") return;

            const next: SlashMenuState = {
              open: true,
              query: "",
              from: currentFrom.pos - 1,
              to: currentFrom.pos,
            };
            view.dispatch(view.state.tr.setMeta(slashMenuPluginKey, next));
          });
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
