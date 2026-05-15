import { Plugin, PluginKey, type Transaction } from "prosemirror-state";
import type { EditorView } from "prosemirror-view";

type CompositionViewState = {
  domComposing: boolean;
  settling: boolean;
  settleTimer?: ReturnType<typeof setTimeout>;
};

const COMPOSITION_SETTLE_DELAY = 50;
const compositionViewStates = new WeakMap<EditorView, CompositionViewState>();
const compositionGuardPluginKey = new PluginKey("blogEditorCompositionGuard");

const hasOwn = (value: object, key: PropertyKey) => Object.hasOwn(value, key);

function getCompositionViewState(view: EditorView): CompositionViewState {
  let state = compositionViewStates.get(view);
  if (!state) {
    state = { domComposing: false, settling: false };
    compositionViewStates.set(view, state);
  }
  return state;
}

export function isCompositionTransaction(tr: Transaction): boolean {
  const meta = (tr as unknown as { meta?: Record<string, unknown> }).meta;
  return !!meta && hasOwn(meta, "composition");
}

export function isViewComposing(view: EditorView): boolean {
  const state = compositionViewStates.get(view);
  return view.composing || !!state?.domComposing || !!state?.settling;
}

export function runAfterCompositionSettled(view: EditorView, callback: () => void): () => void {
  let cancelled = false;
  let timer: ReturnType<typeof setTimeout> | undefined;

  const run = () => {
    if (cancelled) return;
    if (!isViewComposing(view)) {
      callback();
      return;
    }
    timer = setTimeout(run, COMPOSITION_SETTLE_DELAY);
  };

  timer = setTimeout(run, COMPOSITION_SETTLE_DELAY);

  return () => {
    cancelled = true;
    if (timer !== undefined) {
      clearTimeout(timer);
    }
  };
}

export function createCompositionGuardPlugin(): Plugin {
  return new Plugin({
    key: compositionGuardPluginKey,
    view(view) {
      const state = getCompositionViewState(view);

      const clearSettleTimer = () => {
        if (state.settleTimer !== undefined) {
          clearTimeout(state.settleTimer);
          state.settleTimer = undefined;
        }
      };

      const handleCompositionStart = () => {
        clearSettleTimer();
        state.domComposing = true;
        state.settling = false;
      };

      const handleCompositionEnd = () => {
        state.domComposing = false;
        state.settling = true;
        clearSettleTimer();
        state.settleTimer = setTimeout(() => {
          state.settling = false;
          state.settleTimer = undefined;
        }, COMPOSITION_SETTLE_DELAY);
      };

      view.dom.addEventListener("compositionstart", handleCompositionStart);
      view.dom.addEventListener("compositionend", handleCompositionEnd);
      view.dom.addEventListener("compositioncancel", handleCompositionEnd);

      return {
        destroy() {
          view.dom.removeEventListener("compositionstart", handleCompositionStart);
          view.dom.removeEventListener("compositionend", handleCompositionEnd);
          view.dom.removeEventListener("compositioncancel", handleCompositionEnd);
          clearSettleTimer();
          compositionViewStates.delete(view);
        },
      };
    },
  });
}
