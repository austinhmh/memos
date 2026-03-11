import { Plugin, PluginKey } from "prosemirror-state";
import type { EditorState } from "prosemirror-state";
import { Decoration, DecorationSet } from "prosemirror-view";
import { mermaidPluginKey } from "./MermaidPlugin";
import type { MermaidState } from "./MermaidPlugin";

function isMermaid(node: import("prosemirror-model").Node): boolean {
  if (node.type.name !== "code_block") return false;
  const lang = (node.attrs.language as string) || "";
  return lang === "mermaid" || lang === "mermaidjs";
}

function findParentCodeBlock(state: EditorState): { node: import("prosemirror-model").Node; pos: number } | undefined {
  const { $head } = state.selection;
  for (let d = $head.depth; d > 0; d--) {
    const node = $head.node(d);
    if (node.type.name === "code_block") {
      return { node, pos: $head.before(d) };
    }
  }
  return undefined;
}

/**
 * Independent plugin that manages a single `code-active` Decoration.node
 * for the currently focused code block.
 *
 * For Mermaid blocks, it only activates when editingId matches —
 * exactly replicating Outline's CodeFence active plugin architecture.
 *
 * Because this DecorationSet contains at most 1 decoration (the active block),
 * rebuilding it is essentially zero-cost and causes no page-wide DOM churn.
 */
function createActiveCodeBlockDecoration(state: EditorState): DecorationSet {
  const codeBlock = findParentCodeBlock(state);
  if (!codeBlock) {
    return DecorationSet.empty;
  }

  if (isMermaid(codeBlock.node)) {
    const mermaidState = mermaidPluginKey.getState(state) as MermaidState | undefined;
    if (!mermaidState) return DecorationSet.empty;

    // If editingId is set (user explicitly entered edit mode), trust it
    // without requiring diagramId match — the decoration positions may
    // shift during docChanged and the lookup can fail.
    if (!mermaidState.editingId) {
      return DecorationSet.empty;
    }
  }

  const decoration = Decoration.node(
    codeBlock.pos,
    codeBlock.pos + codeBlock.node.nodeSize,
    { class: "code-active" },
  );
  return DecorationSet.create(state.doc, [decoration]);
}

export function createCodeFenceActivePlugin(): Plugin<DecorationSet> {
  return new Plugin<DecorationSet>({
    key: new PluginKey("code-fence-active"),
    state: {
      init: (_, state) => createActiveCodeBlockDecoration(state),
      apply: (tr, pluginState, _oldState, newState) => {
        if (
          !tr.selectionSet &&
          !tr.docChanged &&
          !tr.getMeta(mermaidPluginKey)
        ) {
          return pluginState;
        }
        return createActiveCodeBlockDecoration(newState);
      },
    },
    props: {
      decorations(state) {
        return this.getState(state);
      },
    },
  });
}
