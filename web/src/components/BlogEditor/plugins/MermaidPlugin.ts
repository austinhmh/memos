import type { Node } from "prosemirror-model";
import type { Transaction } from "prosemirror-state";
import { Plugin, PluginKey, TextSelection } from "prosemirror-state";
import type { EditorView } from "prosemirror-view";
import { Decoration, DecorationSet } from "prosemirror-view";
import { getRenderLimitMessage, MERMAID_RENDER_LIMIT } from "@/lib/markdown/renderLimits";
import { normalizeMermaidCode } from "@/lib/mermaid/normalizeMermaidCode";
import { sanitizeSvg } from "@/lib/sanitize-svg";
import { isCompositionTransaction, isViewComposing } from "./CompositionGuardPlugin";

export const mermaidPluginKey = new PluginKey<MermaidState>("mermaid");

export type MermaidState = {
  decorationSet: DecorationSet;
  isDark: boolean;
  initialized: boolean;
  editingId?: string;
};

type NodeWithPos = { node: Node; pos: number };
type PendingRender = { block: NodeWithPos; isDark: boolean };
type IdleTaskWindow = Window &
  typeof globalThis & {
    requestIdleCallback?: (callback: (deadline: IdleDeadline) => void, options?: IdleRequestOptions) => number;
    cancelIdleCallback?: (handle: number) => void;
  };

const MERMAID_RENDER_DEBOUNCE = 450;
const MERMAID_RENDER_IDLE_TIMEOUT = 1500;

const scheduleMermaidIdleTask = (callback: (deadline: IdleDeadline) => void, timeout = MERMAID_RENDER_IDLE_TIMEOUT) => {
  if (typeof window === "undefined") {
    return globalThis.setTimeout(() => callback({ didTimeout: false, timeRemaining: () => 0 } as IdleDeadline), 0);
  }

  const idleWindow = window as IdleTaskWindow;
  if (idleWindow.requestIdleCallback) {
    return idleWindow.requestIdleCallback(callback, { timeout });
  }

  return window.setTimeout(() => callback({ didTimeout: false, timeRemaining: () => 0 } as IdleDeadline), 0);
};

const cancelMermaidIdleTask = (handle?: number) => {
  if (handle === undefined) return;

  if (typeof window === "undefined") {
    globalThis.clearTimeout(handle);
    return;
  }

  const idleWindow = window as IdleTaskWindow;
  if (idleWindow.cancelIdleCallback) {
    idleWindow.cancelIdleCallback(handle);
    return;
  }

  window.clearTimeout(handle);
};

class Cache {
  static get(key: string) {
    return this.data.get(key);
  }

  static set(key: string, value: string) {
    this.data.set(key, value);
    if (this.data.size > this.maxSize) {
      const first = this.data.keys().next().value;
      if (first != null) this.data.delete(first);
    }
  }

  private static maxSize = 20;
  private static data: Map<string, string> = new Map();
}

let mermaidLib: typeof import("mermaid").default;

class MermaidRenderer {
  readonly diagramId: string;
  readonly element: HTMLElement;
  readonly elementId: string;
  readonly diagramElement: HTMLElement;
  readonly toggleButton: HTMLButtonElement;
  readonly retryButton: HTMLButtonElement;
  private lastRenderedKey = "";
  private pendingRender: PendingRender | null = null;
  private isVisible = false;
  private static observer: IntersectionObserver | null = null;
  private static observedRenderers = new WeakMap<Element, MermaidRenderer>();

  constructor() {
    this.diagramId = crypto.randomUUID?.() ?? Math.random().toString(36).slice(2);
    this.elementId = `mermaid-diagram-wrapper-${this.diagramId}`;

    this.element = document.createElement("div");
    this.element.id = this.elementId;
    this.element.classList.add("mermaid-block-container");
    this.element.dataset.diagramId = this.diagramId;

    this.toggleButton = document.createElement("button");
    this.toggleButton.type = "button";
    this.toggleButton.className = "mermaid-toggle-code";
    this.toggleButton.textContent = "显示代码";
    this.toggleButton.setAttribute("contenteditable", "false");

    this.retryButton = document.createElement("button");
    this.retryButton.type = "button";
    this.retryButton.className = "mermaid-retry";
    this.retryButton.textContent = "重新渲染";
    this.retryButton.hidden = true;
    this.retryButton.setAttribute("contenteditable", "false");

    this.diagramElement = document.createElement("div");
    this.diagramElement.classList.add("mermaid-diagram-wrapper");
    this.diagramElement.dataset.diagramId = this.diagramId;

    this.element.append(this.toggleButton, this.retryButton, this.diagramElement);
    this.observe();
  }

  private static getObserver() {
    if (!this.observer) {
      this.observer = new IntersectionObserver(
        (entries) => {
          for (const entry of entries) {
            const renderer = this.observedRenderers.get(entry.target);
            renderer?.handleIntersection(entry.isIntersecting);
          }
        },
        { rootMargin: "600px 0px" },
      );
    }
    return this.observer;
  }

  private observe() {
    MermaidRenderer.observedRenderers.set(this.element, this);
    MermaidRenderer.getObserver().observe(this.element);
  }

  private handleIntersection(isIntersecting: boolean) {
    this.isVisible = isIntersecting;
    if (isIntersecting) {
      void this.flushPendingRender();
    }
  }

  setEditing = (editing: boolean) => {
    this.toggleButton.textContent = editing ? "隐藏代码" : "显示代码";
    this.toggleButton.setAttribute("aria-pressed", editing ? "true" : "false");
  };

  private setRetryVisible = (visible: boolean) => {
    this.retryButton.hidden = !visible;
  };

  mount = (block: NodeWithPos, isDark: boolean, editing: boolean) => {
    const renderKey = `${isDark ? "dark" : "light"}-${block.node.textContent}`;
    this.setEditing(editing);

    if (renderKey === this.lastRenderedKey) {
      return this.element;
    }

    this.pendingRender = { block, isDark };
    this.diagramElement.dataset.renderState = "pending";
    this.diagramElement.setAttribute("aria-busy", "true");
    this.setRetryVisible(false);

    if (this.isVisible) {
      void this.flushPendingRender();
    }

    return this.element;
  };

  retry = (block: NodeWithPos, isDark: boolean) => {
    this.lastRenderedKey = "";
    this.pendingRender = { block, isDark };
    this.diagramElement.dataset.renderState = "pending";
    this.diagramElement.setAttribute("aria-busy", "true");
    this.setRetryVisible(false);
    if (this.isVisible) {
      void this.flushPendingRender();
    }
  };

  private flushPendingRender = async () => {
    const pending = this.pendingRender;
    if (!pending) return;

    await this.render(pending.block, pending.isDark);

    if (this.pendingRender === pending) {
      this.pendingRender = null;
    }
  };

  render = async (block: { node: Node; pos: number }, isDark: boolean) => {
    const element = this.diagramElement;
    const text = block.node.textContent;
    const renderKey = `${isDark ? "dark" : "light"}-${text}`;

    if (renderKey === this.lastRenderedKey) return;

    const limitMessage = getRenderLimitMessage(text, MERMAID_RENDER_LIMIT);
    if (limitMessage) {
      this.lastRenderedKey = renderKey;
      element.classList.add("parse-error");
      element.classList.remove("empty");
      element.innerText = limitMessage;
      element.dataset.renderState = "error";
      element.setAttribute("aria-busy", "false");
      this.setRetryVisible(false);
      return;
    }

    const cache = Cache.get(renderKey);
    if (cache) {
      this.lastRenderedKey = renderKey;
      element.classList.remove("parse-error", "empty");
      element.innerHTML = cache;
      delete element.dataset.renderState;
      element.setAttribute("aria-busy", "false");
      this.setRetryVisible(false);
      return;
    }

    const renderElement = document.createElement("div");
    const tempId = "offscreen-mermaid-" + Math.random().toString(36).substr(2, 9);
    renderElement.id = tempId;
    renderElement.style.position = "absolute";
    renderElement.style.left = "-9999px";
    renderElement.style.top = "-9999px";
    document.body.appendChild(renderElement);

    try {
      mermaidLib ??= (await import("mermaid")).default;
      const elkLayouts = (await import("@mermaid-js/layout-elk")).default;
      mermaidLib.registerLayoutLoaders(elkLayouts);
      mermaidLib.initialize({
        startOnLoad: true,
        suppressErrorRendering: true,
        fontFamily: getComputedStyle(this.diagramElement).fontFamily || "inherit",
        theme: isDark ? "dark" : "default",
        securityLevel: "strict",
        layout: "elk",
        flowchart: {
          padding: 20,
          nodeSpacing: 80,
          rankSpacing: 60,
          useMaxWidth: true,
          htmlLabels: true,
          curve: "basis",
          defaultRenderer: "elk",
        },
      });

      const normalized = normalizeMermaidCode(text);
      const { svg } = await mermaidLib.render(tempId, normalized);
      const safeSvg = sanitizeSvg(svg);
      if (!safeSvg) {
        throw new Error("Unsafe Mermaid SVG output");
      }

      if (text) {
        Cache.set(renderKey, safeSvg);
      }
      this.lastRenderedKey = renderKey;
      element.classList.remove("parse-error", "empty");
      element.innerHTML = safeSvg;
      delete element.dataset.renderState;
      element.setAttribute("aria-busy", "false");
      this.setRetryVisible(false);
    } catch (error) {
      const isEmpty = block.node.textContent.trim().length === 0;
      if (isEmpty) {
        element.innerText = "Empty diagram";
        element.classList.add("empty");
        element.dataset.renderState = "empty";
        this.setRetryVisible(false);
      } else {
        element.innerText = String(error);
        element.classList.add("parse-error");
        element.dataset.renderState = "error";
        this.setRetryVisible(true);
      }
      element.setAttribute("aria-busy", "false");
    } finally {
      renderElement.remove();
    }
  };
}

function overlap(start1: number, end1: number, start2: number, end2: number): number {
  return Math.max(0, Math.min(end1, end2) - Math.max(start1, start2));
}

function findBestOverlapDecoration(decorations: Decoration[], block: NodeWithPos): Decoration | undefined {
  if (decorations.length === 0) return undefined;
  let best: Decoration | undefined;
  let bestScore = -1;
  for (const d of decorations) {
    const score = overlap(d.from, d.to, block.pos, block.pos + block.node.nodeSize);
    if (score > bestScore) {
      bestScore = score;
      best = d;
    }
  }
  return best;
}

function isMermaid(node: Node): boolean {
  if (node.type.name !== "code_block") return false;
  const lang = (node.attrs.language as string) || "";
  return lang === "mermaid" || lang === "mermaidjs";
}

function findBlockNodes(doc: Node): NodeWithPos[] {
  const result: NodeWithPos[] = [];
  doc.descendants((child, pos) => {
    if (child.isBlock) result.push({ node: child, pos });
    return false;
  });
  return result;
}

function getNewState({ doc, pluginState, view }: { doc: Node; pluginState: MermaidState; view?: EditorView }): MermaidState {
  const decorations: Decoration[] = [];
  const blocks = findBlockNodes(doc).filter((item) => isMermaid(item.node));

  blocks.forEach((block) => {
    const existingDecorations = pluginState.decorationSet.find(
      block.pos,
      block.pos + block.node.nodeSize,
      (spec: Record<string, unknown>) => !!spec.diagramId,
    );

    const bestDecoration = findBestOverlapDecoration(existingDecorations, block);
    const renderer: MermaidRenderer =
      (bestDecoration?.spec as { renderer?: MermaidRenderer } | undefined)?.renderer ?? new MermaidRenderer();
    const editing =
      pluginState.editingId !== undefined &&
      ((bestDecoration?.spec as { diagramId?: string } | undefined)?.diagramId === pluginState.editingId ||
        renderer.diagramId === pluginState.editingId);

    renderer.setEditing(editing);

    renderer.toggleButton.onclick = (event) => {
      event.preventDefault();
      event.stopPropagation();
      if (!view) return;

      const nextEditing = editing ? undefined : renderer.diagramId;
      const tr = view.state.tr.setMeta(mermaidPluginKey, { editingId: nextEditing });
      const selectionPos = editing ? block.pos + block.node.nodeSize : block.pos + 1;
      tr.setSelection(TextSelection.near(view.state.doc.resolve(selectionPos))).scrollIntoView();
      view.dispatch(tr);
      view.focus();
    };

    renderer.retryButton.onclick = (event) => {
      event.preventDefault();
      event.stopPropagation();
      renderer.retry(block, pluginState.isDark);
    };

    const diagramDecoration = Decoration.widget(block.pos + block.node.nodeSize, () => renderer.mount(block, pluginState.isDark, editing), {
      diagramId: renderer.diagramId,
      renderer,
      side: -10,
      key: renderer.diagramId,
    });

    const diagramIdDecoration = Decoration.node(block.pos, block.pos + block.node.nodeSize, editing ? { class: "code-active" } : {}, {
      diagramId: renderer.diagramId,
      renderer,
    });

    decorations.push(diagramDecoration);
    decorations.push(diagramIdDecoration);
  });

  return {
    ...pluginState,
    decorationSet: DecorationSet.create(doc, decorations),
  };
}

function findParentCodeBlock(state: import("prosemirror-state").EditorState): { node: Node; pos: number } | undefined {
  const { $head } = state.selection;
  for (let d = $head.depth; d > 0; d--) {
    const node = $head.node(d);
    if (node.type.name === "code_block") {
      return { node, pos: $head.before(d) };
    }
  }
  return undefined;
}

export function createMermaidPlugin(options: { isDark: boolean }): Plugin<MermaidState> {
  const { isDark } = options;
  let pendingRender: ReturnType<typeof setTimeout> | undefined;
  let pendingRenderIdleTask: number | undefined;
  let currentView: EditorView | undefined;

  return new Plugin<MermaidState>({
    key: mermaidPluginKey,
    state: {
      init: (_, { doc }) => ({
        decorationSet: DecorationSet.create(doc, []),
        isDark,
        initialized: false,
      }),
      apply: (transaction: Transaction, pluginState: MermaidState, oldState, state) => {
        const mermaidMeta = transaction.getMeta(mermaidPluginKey) as Record<string, unknown> | undefined;
        const themeMeta = transaction.getMeta("theme") as { isDark?: boolean } | undefined;
        const themeToggled = themeMeta?.isDark !== undefined;

        const nextPluginState: MermaidState = {
          ...pluginState,
          isDark: themeToggled ? !!themeMeta!.isDark : pluginState.isDark,
          editingId: mermaidMeta && "editingId" in mermaidMeta ? (mermaidMeta.editingId as string | undefined) : pluginState.editingId,
          decorationSet: pluginState.decorationSet.map(transaction.mapping, transaction.doc),
        };

        if (isCompositionTransaction(transaction)) {
          return nextPluginState;
        }

        if (mermaidMeta?.loaded && !pluginState.initialized) {
          return {
            ...getNewState({ doc: transaction.doc, pluginState: nextPluginState, view: currentView }),
            initialized: true,
          };
        }

        // Auto-exit editing when cursor leaves the mermaid code block
        if (transaction.selectionSet && nextPluginState.editingId && !mermaidMeta) {
          const codeBlock = findParentCodeBlock(state);
          let isEditing = codeBlock && isMermaid(codeBlock.node);

          if (isEditing && codeBlock && !transaction.docChanged) {
            const decorations = nextPluginState.decorationSet.find(codeBlock.pos, codeBlock.pos + codeBlock.node.nodeSize);
            const nodeDecoration = decorations.find((d: Decoration) => d.spec.diagramId && d.from === codeBlock.pos);
            if (nodeDecoration?.spec.diagramId !== nextPluginState.editingId) {
              isEditing = false;
            }
          }

          if (!isEditing) {
            nextPluginState.editingId = undefined;
          }
        }

        // @ts-expect-error accessing private meta field
        const isPaste = transaction.meta?.paste;

        const mermaidBlockCount = findBlockNodes(transaction.doc).filter((item) => isMermaid(item.node)).length;
        const existingMermaidDecorations = nextPluginState.decorationSet
          .find(0, transaction.doc.content.size, (spec: Record<string, unknown>) => !!spec.diagramId)
          .filter((d: Decoration) => d.from !== d.to).length;
        const hasNewMermaidBlock = mermaidBlockCount > existingMermaidDecorations / 2;

        if (isPaste || themeToggled || mermaidMeta || hasNewMermaidBlock) {
          return getNewState({ doc: transaction.doc, pluginState: nextPluginState, view: currentView });
        }

        return nextPluginState;
      },
    },
    view(view: EditorView) {
      currentView = view;
      let timer: ReturnType<typeof setTimeout> | undefined;

      const scheduleInit = (targetView: EditorView) => {
        if (timer) return;
        timer = setTimeout(() => {
          timer = undefined;
          try {
            const pluginState = mermaidPluginKey.getState(targetView.state);
            if (pluginState?.initialized) return;
            targetView.dispatch(targetView.state.tr.setMeta(mermaidPluginKey, { loaded: true }));
          } catch {
            // view destroyed
          }
        }, 50);
      };

      scheduleInit(view);

      return {
        update(view: EditorView) {
          currentView = view;
          const ps = mermaidPluginKey.getState(view.state);
          if (ps && !ps.initialized) {
            scheduleInit(view);
          }

          if (!ps?.initialized) return;
          if (isViewComposing(view)) {
            return;
          }

          // Debounced re-render for the active mermaid diagram only.
          // The expensive render itself is deferred into requestIdleCallback so
          // repeated typing inside a mermaid code block won't immediately steal
          // time from the input path.
          const headParent = view.state.selection.$head.parent;
          if (isMermaid(headParent)) {
            if (pendingRender) clearTimeout(pendingRender);
            if (pendingRenderIdleTask !== undefined) {
              cancelMermaidIdleTask(pendingRenderIdleTask);
              pendingRenderIdleTask = undefined;
            }
            pendingRender = setTimeout(() => {
              pendingRenderIdleTask = scheduleMermaidIdleTask(() => {
                pendingRenderIdleTask = undefined;
                try {
                  const latestState = mermaidPluginKey.getState(view.state);
                  if (!latestState) return;
                  const codeBlock = findParentCodeBlock(view.state);
                  if (!codeBlock || !isMermaid(codeBlock.node)) return;

                  const decorations = latestState.decorationSet.find(
                    codeBlock.pos,
                    codeBlock.pos + codeBlock.node.nodeSize,
                    (spec: Record<string, unknown>) => !!spec.renderer,
                  );
                  for (const d of decorations) {
                    const renderer = d.spec.renderer as MermaidRenderer | undefined;
                    if (renderer) {
                      void renderer.render(codeBlock, latestState.isDark);
                    }
                  }
                } catch {
                  // view may be destroyed
                }
              }) as number;
            }, MERMAID_RENDER_DEBOUNCE);
          }
        },
        destroy() {
          currentView = undefined;
          if (timer) clearTimeout(timer);
          if (pendingRender) clearTimeout(pendingRender);
          if (pendingRenderIdleTask !== undefined) {
            cancelMermaidIdleTask(pendingRenderIdleTask);
            pendingRenderIdleTask = undefined;
          }
        },
      };
    },
    props: {
      decorations(state) {
        return this.getState(state)?.decorationSet;
      },
      handleDOMEvents: {
        mouseup(view, event) {
          const target = event.target as HTMLElement;
          const diagram = target?.closest(".mermaid-diagram-wrapper");
          if (!diagram) return false;

          if (isViewComposing(view)) {
            return false;
          }

          const codeBlock = diagram.previousElementSibling;
          if (!codeBlock) return false;

          const pos = view.posAtDOM(codeBlock, 0);
          if (!pos) return false;

          if (event.detail === 1) {
            const $pos = view.state.doc.resolve(pos);
            const parentPos = $pos.before($pos.depth);
            const parentNode = $pos.node($pos.depth);

            const mermaidState = mermaidPluginKey.getState(view.state) as MermaidState | undefined;
            const decorations =
              mermaidState?.decorationSet.find(
                parentPos,
                parentPos + parentNode.nodeSize,
                (spec: Record<string, unknown>) => !!spec.diagramId,
              ) ?? [];
            const nodeDecoration = decorations.find((d: Decoration) => d.spec.diagramId && d.from === parentPos);
            const diagramId = nodeDecoration?.spec.diagramId as string | undefined;

            const tr = view.state.tr.setSelection(TextSelection.near(view.state.doc.resolve(pos))).scrollIntoView();

            if (diagramId) {
              tr.setMeta(mermaidPluginKey, { editingId: diagramId });
            }

            view.dispatch(tr);
            return true;
          }
          return false;
        },
      },
    },
  });
}
