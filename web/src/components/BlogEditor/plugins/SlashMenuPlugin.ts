import { Plugin, PluginKey } from "prosemirror-state";
import type { EditorView } from "prosemirror-view";

import type { ReactNode } from "react";

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

        if (!prev.open) return prev;

        if (!tr.docChanged && !tr.selectionSet) return prev;

        const { $from } = newState.selection;
        const textBefore = $from.parent.textBetween(
          Math.max(0, $from.parentOffset - 100),
          $from.parentOffset,
          undefined,
          "\ufffc"
        );

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

        if (event.key === "/" && !state?.open) {
          const { $from } = view.state.selection;
          if ($from.parent.type.spec.code) return false;

          const textBefore = $from.parent.textBetween(
            Math.max(0, $from.parentOffset - 1),
            $from.parentOffset,
            undefined,
            "\ufffc"
          );
          if (textBefore && !/\s$/.test(textBefore) && textBefore.length > 0) {
            return false;
          }

          setTimeout(() => {
            const next: SlashMenuState = {
              open: true,
              query: "",
              from: view.state.selection.$from.pos - 1,
              to: view.state.selection.$from.pos,
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
            open: false, query: "", from: 0, to: 0,
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
          const state = slashMenuPluginKey.getState(view.state);
          if (state) onStateChange(state);
        },
      };
    },
  });
}
