import type { Node as ProsemirrorNode } from "prosemirror-model";
import { Plugin, PluginKey, type Transaction } from "prosemirror-state";
import { Decoration, DecorationSet, type EditorView } from "prosemirror-view";
import { isCompositionTransaction, isViewComposing, runAfterCompositionSettled } from "./CompositionGuardPlugin";

type CodeBlockExpandState = {
  decorations: DecorationSet;
  expandedPositions: Set<number>;
  overflowPositions: Set<number>;
};

type CodeBlockExpandMeta = {
  togglePos?: number;
  overflowPositions?: Set<number>;
};

export const codeBlockExpandPluginKey = new PluginKey<CodeBlockExpandState>("codeBlockExpand");

function isMermaid(node: ProsemirrorNode): boolean {
  if (node.type.name !== "code_block") return false;
  const lang = ((node.attrs.language as string | undefined) ?? "").trim().toLowerCase();
  return lang === "mermaid" || lang === "mermaidjs";
}

function setsEqual(a: Set<number>, b: Set<number>): boolean {
  if (a.size !== b.size) {
    return false;
  }

  for (const value of a) {
    if (!b.has(value)) {
      return false;
    }
  }

  return true;
}

function mapCodeBlockPositions(positions: Set<number>, tr: Transaction): Set<number> {
  if (!tr.docChanged) {
    return positions;
  }

  const nextPositions = new Set<number>();
  positions.forEach((pos) => {
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

function createExpandButton(pos: number, expanded: boolean): HTMLButtonElement {
  const button = document.createElement("button");
  button.type = "button";
  button.className = "code-block-expand-btn blog-editor-code-block-expand-btn";
  button.title = expanded ? "收起代码块" : "展开代码块";
  button.setAttribute("aria-label", expanded ? "收起代码块" : "展开代码块");
  button.setAttribute("contenteditable", "false");
  button.setAttribute("aria-expanded", expanded ? "true" : "false");
  button.dataset.codeBlockPos = String(pos);

  const arrow = document.createElement("span");
  arrow.className = "code-block-expand-icon";
  arrow.setAttribute("aria-hidden", "true");
  arrow.textContent = expanded ? "↑" : "↓";
  button.appendChild(arrow);

  return button;
}

function createDecorations(doc: ProsemirrorNode, expandedPositions: Set<number>, overflowPositions: Set<number>): DecorationSet {
  const decorations: Decoration[] = [];

  doc.descendants((node, pos) => {
    if (node.type.name !== "code_block" || isMermaid(node)) {
      return false;
    }

    const expanded = expandedPositions.has(pos);
    const overflow = overflowPositions.has(pos);
    decorations.push(
      Decoration.node(pos, pos + node.nodeSize, {
        class: expanded ? "code-block-collapsible code-expanded" : "code-block-collapsible",
      }),
    );

    if (!expanded && !overflow) {
      return false;
    }

    decorations.push(
      Decoration.widget(
        pos + node.nodeSize,
        (view) => {
          const button = createExpandButton(pos, expanded);

          const stopEditorEvent = (event: Event) => {
            event.stopPropagation();
          };

          button.addEventListener("mousedown", stopEditorEvent);
          button.addEventListener("mouseup", stopEditorEvent);
          button.addEventListener("click", (event) => {
            event.preventDefault();
            event.stopPropagation();
            if (isViewComposing(view)) {
              return;
            }
            view.dispatch(view.state.tr.setMeta(codeBlockExpandPluginKey, { togglePos: pos } satisfies CodeBlockExpandMeta));
          });

          return button;
        },
        {
          key: `code-block-expand-${pos}-${expanded ? "expanded" : "collapsed"}-${overflow ? "overflow" : "fit"}`,
          side: 1,
          stopEvent(event) {
            return event.type === "mousedown" || event.type === "mouseup" || event.type === "click";
          },
        },
      ),
    );

    return false;
  });

  return DecorationSet.create(doc, decorations);
}

function findCodeBlockElement(view: EditorView, pos: number): HTMLElement | null {
  const dom = view.nodeDOM(pos);
  if (!(dom instanceof HTMLElement)) {
    return null;
  }

  if (dom.classList.contains("code-block")) {
    return dom;
  }

  return dom.querySelector(".code-block");
}

function collectOverflowPositions(view: EditorView, previousOverflowPositions: Set<number>, expandedPositions: Set<number>): Set<number> {
  const overflowPositions = new Set<number>();

  view.state.doc.descendants((node, pos) => {
    if (node.type.name !== "code_block" || isMermaid(node)) {
      return false;
    }

    if (expandedPositions.has(pos) && previousOverflowPositions.has(pos)) {
      overflowPositions.add(pos);
      return false;
    }

    const codeBlock = findCodeBlockElement(view, pos);
    const pre = codeBlock?.querySelector("pre");
    if (pre && pre.scrollHeight > pre.clientHeight + 1) {
      overflowPositions.add(pos);
    }

    return false;
  });

  return overflowPositions;
}

export function createCodeBlockExpandDecorationsForTest(
  doc: ProsemirrorNode,
  expandedPositions: Set<number>,
  overflowPositions: Set<number>,
): DecorationSet {
  return createDecorations(doc, expandedPositions, overflowPositions);
}

export function createCodeBlockExpandPlugin(): Plugin<CodeBlockExpandState> {
  return new Plugin<CodeBlockExpandState>({
    key: codeBlockExpandPluginKey,
    state: {
      init: (_, state) => {
        const expandedPositions = new Set<number>();
        const overflowPositions = new Set<number>();
        return {
          expandedPositions,
          overflowPositions,
          decorations: createDecorations(state.doc, expandedPositions, overflowPositions),
        };
      },
      apply(tr, pluginState) {
        const meta = tr.getMeta(codeBlockExpandPluginKey) as CodeBlockExpandMeta | undefined;
        const expandedPositions = new Set(mapCodeBlockPositions(pluginState.expandedPositions, tr));
        const overflowPositions = meta?.overflowPositions ?? mapCodeBlockPositions(pluginState.overflowPositions, tr);

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

        if (isCompositionTransaction(tr)) {
          const mappedDecorations = pluginState.decorations.map(tr.mapping, tr.doc);
          return {
            expandedPositions,
            overflowPositions,
            decorations: mappedDecorations,
          };
        }

        if (tr.docChanged && !meta) {
          const mappedDecorations = pluginState.decorations.map(tr.mapping, tr.doc);
          return {
            expandedPositions,
            overflowPositions,
            decorations:
              mappedDecorations.find().length > 0 ? mappedDecorations : createDecorations(tr.doc, expandedPositions, overflowPositions),
          };
        }

        return {
          expandedPositions,
          overflowPositions,
          decorations: createDecorations(tr.doc, expandedPositions, overflowPositions),
        };
      },
    },
    view(view) {
      let raf = 0;
      let observer: ResizeObserver | undefined;

      const scheduleMeasure = () => {
        if (isViewComposing(view)) {
          return;
        }

        if (raf) {
          cancelAnimationFrame(raf);
        }

        raf = requestAnimationFrame(() => {
          raf = 0;
          if (isViewComposing(view)) {
            return;
          }

          const pluginState = codeBlockExpandPluginKey.getState(view.state);
          if (!pluginState) {
            return;
          }

          const overflowPositions = collectOverflowPositions(view, pluginState.overflowPositions, pluginState.expandedPositions);
          if (!setsEqual(pluginState.overflowPositions, overflowPositions)) {
            view.dispatch(view.state.tr.setMeta(codeBlockExpandPluginKey, { overflowPositions } satisfies CodeBlockExpandMeta));
          }
        });
      };

      const observeCodeBlocks = () => {
        if (isViewComposing(view)) {
          return;
        }

        observer?.disconnect();
        observer = typeof ResizeObserver === "undefined" ? undefined : new ResizeObserver(scheduleMeasure);
        if (!observer) {
          return;
        }

        view.dom.querySelectorAll(".code-block pre").forEach((pre) => observer?.observe(pre));
      };

      let deferredUpdateCancel: (() => void) | undefined;

      const scheduleDeferredUpdate = () => {
        deferredUpdateCancel?.();
        deferredUpdateCancel = runAfterCompositionSettled(view, () => {
          deferredUpdateCancel = undefined;
          observeCodeBlocks();
          scheduleMeasure();
        });
      };

      const handleResize = () => scheduleMeasure();
      window.addEventListener("resize", handleResize);
      observeCodeBlocks();
      scheduleMeasure();

      return {
        update() {
          if (isViewComposing(view)) {
            scheduleDeferredUpdate();
            return;
          }
          observeCodeBlocks();
          scheduleMeasure();
        },
        destroy() {
          if (raf) {
            cancelAnimationFrame(raf);
          }
          deferredUpdateCancel?.();
          observer?.disconnect();
          window.removeEventListener("resize", handleResize);
        },
      };
    },
    props: {
      decorations(state) {
        return codeBlockExpandPluginKey.getState(state)?.decorations ?? null;
      },
    },
  });
}
