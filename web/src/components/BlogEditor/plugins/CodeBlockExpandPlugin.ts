import type { Node as ProsemirrorNode } from "prosemirror-model";
import { Plugin, PluginKey, type Transaction } from "prosemirror-state";
import { Decoration, DecorationSet } from "prosemirror-view";

const MAX_CODE_BLOCK_HEIGHT = "50vh";

type CodeBlockExpandState = {
  decorations: DecorationSet;
  expandedPositions: Set<number>;
};

type CodeBlockExpandMeta = {
  togglePos?: number;
};

const codeBlockExpandPluginKey = new PluginKey<CodeBlockExpandState>("codeBlockExpand");

function isMermaid(node: ProsemirrorNode): boolean {
  if (node.type.name !== "code_block") return false;
  const lang = ((node.attrs.language as string | undefined) ?? "").trim().toLowerCase();
  return lang === "mermaid" || lang === "mermaidjs";
}

function mapExpandedPositions(expandedPositions: Set<number>, tr: Transaction): Set<number> {
  if (!tr.docChanged) {
    return expandedPositions;
  }

  const nextPositions = new Set<number>();
  expandedPositions.forEach((pos) => {
    const mapped = tr.mapping.mapResult(pos, -1);
    if (mapped.deleted) {
      return;
    }

    const node = tr.doc.nodeAt(mapped.pos);
    if (node?.type.name === "code_block") {
      nextPositions.add(mapped.pos);
    }
  });
  return nextPositions;
}

function updateButtonVisibility(button: HTMLButtonElement, expanded: boolean) {
  const codeBlock = button.previousElementSibling as HTMLElement | null;
  const pre = codeBlock?.querySelector("pre");
  if (!pre) {
    button.hidden = true;
    return;
  }

  if (expanded) {
    pre.style.maxHeight = "";
    pre.style.overflowY = "";
  } else {
    pre.style.maxHeight = MAX_CODE_BLOCK_HEIGHT;
    pre.style.overflowY = "auto";
  }

  button.hidden = !(expanded || pre.scrollHeight > pre.clientHeight + 2);
}

function createExpandButton(pos: number, expanded: boolean): HTMLButtonElement {
  const button = document.createElement("button");
  button.type = "button";
  button.className = "code-block-expand-btn blog-editor-code-block-expand-btn";
  button.title = expanded ? "收起 Collapse" : "展开全部 Expand All";
  button.textContent = expanded ? "收起 Collapse" : "展开全部 Expand All";
  button.hidden = !expanded;
  button.style.marginTop = "-1em";
  button.style.position = "relative";
  button.style.zIndex = "1";
  button.setAttribute("contenteditable", "false");
  button.setAttribute("aria-expanded", expanded ? "true" : "false");
  button.dataset.codeBlockPos = String(pos);
  return button;
}

function createDecorations(doc: ProsemirrorNode, expandedPositions: Set<number>): DecorationSet {
  const decorations: Decoration[] = [];

  doc.descendants((node, pos) => {
    if (node.type.name !== "code_block" || isMermaid(node)) {
      return false;
    }

    const expanded = expandedPositions.has(pos);
    if (expanded) {
      decorations.push(
        Decoration.node(pos, pos + node.nodeSize, {
          class: "code-expanded",
        }),
      );
    }

    decorations.push(
      Decoration.widget(
        pos + node.nodeSize,
        (view) => {
          const button = createExpandButton(pos, expanded);
          let observer: ResizeObserver | undefined;

          const update = () => updateButtonVisibility(button, expanded);
          requestAnimationFrame(() => {
            update();
            const codeBlock = button.previousElementSibling as HTMLElement | null;
            const pre = codeBlock?.querySelector("pre");
            if (!pre || typeof ResizeObserver === "undefined") {
              return;
            }

            observer = new ResizeObserver(update);
            observer.observe(pre);
          });

          const stopEvent = (event: Event) => {
            event.preventDefault();
            event.stopPropagation();
          };

          button.addEventListener("mousedown", stopEvent);
          button.addEventListener("click", (event) => {
            stopEvent(event);
            view.dispatch(view.state.tr.setMeta(codeBlockExpandPluginKey, { togglePos: pos } satisfies CodeBlockExpandMeta));
          });

          (button as HTMLButtonElement & { destroy?: () => void }).destroy = () => observer?.disconnect();
          return button;
        },
        {
          key: `code-block-expand-${pos}-${expanded ? "expanded" : "collapsed"}`,
          side: 1,
          destroy(node) {
            (node as HTMLButtonElement & { destroy?: () => void }).destroy?.();
          },
        },
      ),
    );

    return false;
  });

  return DecorationSet.create(doc, decorations);
}

export function createCodeBlockExpandPlugin(): Plugin<CodeBlockExpandState> {
  return new Plugin<CodeBlockExpandState>({
    key: codeBlockExpandPluginKey,
    state: {
      init: (_, state) => {
        const expandedPositions = new Set<number>();
        return {
          expandedPositions,
          decorations: createDecorations(state.doc, expandedPositions),
        };
      },
      apply(tr, pluginState) {
        const meta = tr.getMeta(codeBlockExpandPluginKey) as CodeBlockExpandMeta | undefined;
        const expandedPositions = new Set(mapExpandedPositions(pluginState.expandedPositions, tr));

        if (meta?.togglePos !== undefined) {
          if (expandedPositions.has(meta.togglePos)) {
            expandedPositions.delete(meta.togglePos);
          } else {
            expandedPositions.add(meta.togglePos);
          }
        }

        if (!tr.docChanged && !meta) {
          return pluginState;
        }

        return {
          expandedPositions,
          decorations: createDecorations(tr.doc, expandedPositions),
        };
      },
    },
    props: {
      decorations(state) {
        return codeBlockExpandPluginKey.getState(state)?.decorations ?? null;
      },
    },
  });
}
