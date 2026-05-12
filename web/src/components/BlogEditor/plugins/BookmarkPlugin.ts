import type { Node } from "prosemirror-model";
import type { EditorState, Transaction } from "prosemirror-state";
import { NodeSelection, Plugin, PluginKey } from "prosemirror-state";
import type { EditorView, NodeView } from "prosemirror-view";
import { sanitizeUrl } from "@/lib/sanitize-url";

export const bookmarkPluginKey = new PluginKey<BookmarkState>("bookmark");

export type BookmarkState = {
  editingPos: number | null;
};

interface URLMetadata {
  title: string;
  description: string;
  image: string;
  favicon: string;
}

const metadataCache = new Map<string, URLMetadata | null>();
const pendingFetches = new Map<string, Promise<URLMetadata | null>>();

async function fetchURLMetadata(url: string): Promise<URLMetadata | null> {
  const cached = metadataCache.get(url);
  if (cached !== undefined) return cached;

  const pending = pendingFetches.get(url);
  if (pending) return pending;

  const promise = (async () => {
    try {
      const res = await fetch(`/api/v1/url-metadata?url=${encodeURIComponent(url)}`);
      if (!res.ok) {
        metadataCache.set(url, null);
        return null;
      }
      const data: URLMetadata = await res.json();
      if (!data.title && !data.description) {
        metadataCache.set(url, null);
        return null;
      }
      metadataCache.set(url, data);
      return data;
    } catch {
      metadataCache.set(url, null);
      return null;
    } finally {
      pendingFetches.delete(url);
    }
  })();

  pendingFetches.set(url, promise);
  return promise;
}

function extractDomain(url: string): string {
  try {
    return new URL(url).hostname;
  } catch {
    return url;
  }
}

class BookmarkNodeView implements NodeView {
  dom: HTMLElement;
  private inputContainer: HTMLElement;
  private inputElement: HTMLInputElement;
  private cardElement: HTMLElement;
  private editButton: HTMLButtonElement;
  private view: EditorView;
  private getPos: () => number | undefined;
  private lastUrl: string;
  private isEditing = false;

  constructor(node: Node, view: EditorView, getPos: () => number | undefined) {
    this.view = view;
    this.getPos = getPos;
    this.lastUrl = (node.attrs.url as string) || "";

    this.dom = document.createElement("div");
    this.dom.className = "bookmark-node-wrapper";

    const widget = document.createElement("div");
    widget.className = "bookmark-widget";
    widget.setAttribute("contenteditable", "false");

    this.inputContainer = document.createElement("div");
    this.inputContainer.className = "bookmark-input-container";

    this.inputElement = document.createElement("input");
    this.inputElement.type = "url";
    this.inputElement.className = "bookmark-url-input";
    this.inputElement.placeholder = "输入链接地址，回车确认…";
    this.inputElement.spellcheck = false;

    this.inputContainer.appendChild(this.inputElement);

    this.cardElement = document.createElement("div");
    this.cardElement.className = "bookmark-card";

    this.editButton = document.createElement("button");
    this.editButton.type = "button";
    this.editButton.className = "bookmark-edit-btn";
    this.editButton.textContent = "编辑链接";
    this.editButton.setAttribute("contenteditable", "false");
    this.editButton.addEventListener("click", (e) => {
      e.preventDefault();
      e.stopPropagation();
      this.enterEditing();
    });

    widget.append(this.inputContainer, this.cardElement, this.editButton);
    this.dom.appendChild(widget);

    this.inputElement.addEventListener("keydown", this.handleInputKeydown);
    this.inputElement.addEventListener("blur", this.handleInputBlur);
    this.cardElement.addEventListener("click", this.handleCardClick);

    activeNodeViews.add(this);

    const ps = bookmarkPluginKey.getState(view.state);
    const editing = ps?.editingPos === this.getPos() || !this.lastUrl;
    this.render(this.lastUrl, editing);
  }

  syncEditingState() {
    const ps = bookmarkPluginKey.getState(this.view.state);
    const editing = ps?.editingPos === this.getPos() || (!this.lastUrl && this.isEditing);
    if (editing !== this.isEditing) {
      this.render(this.lastUrl, editing);
    }
  }

  private handleInputKeydown = (e: KeyboardEvent) => {
    if (e.key === "Enter") {
      e.preventDefault();
      e.stopPropagation();
      const url = this.inputElement.value.trim();
      if (url) {
        this.commitUrl(url);
      }
    }
    if (e.key === "Escape") {
      e.preventDefault();
      e.stopPropagation();
      if (!this.lastUrl) {
        this.deleteNode();
      } else {
        this.exitEditing();
      }
    }
    if (e.key === "Backspace" && !this.inputElement.value && !this.lastUrl) {
      e.preventDefault();
      this.deleteNode();
    }
  };

  private handleInputBlur = () => {
    const url = this.inputElement.value.trim();
    if (url && url !== this.lastUrl) {
      this.commitUrl(url);
    } else if (!url && !this.lastUrl) {
      setTimeout(() => this.deleteNode(), 0);
    } else {
      this.exitEditing();
    }
  };

  private handleCardClick = (e: MouseEvent) => {
    const url = sanitizeUrl(this.lastUrl);
    if (url) {
      window.open(url, "_blank", "noopener,noreferrer");
    }
  };

  private normalizeUrl(url: string): string {
    return sanitizeUrl(url) || "";
  }

  private commitUrl(rawUrl: string) {
    const url = this.normalizeUrl(rawUrl);
    if (!url) return;
    const pos = this.getPos();
    if (pos === undefined) return;
    const node = this.view.state.doc.nodeAt(pos);
    if (!node || node.type.name !== "bookmark") return;

    const tr = this.view.state.tr.setNodeMarkup(pos, undefined, { url });
    tr.setMeta(bookmarkPluginKey, { editingPos: null });
    this.view.dispatch(tr);
    this.view.focus();
  }

  private deleteNode() {
    const pos = this.getPos();
    if (pos === undefined) return;
    const node = this.view.state.doc.nodeAt(pos);
    if (!node || node.type.name !== "bookmark") return;

    const tr = this.view.state.tr.delete(pos, pos + node.nodeSize);
    tr.setMeta(bookmarkPluginKey, { editingPos: null });
    this.view.dispatch(tr);
    this.view.focus();
  }

  private enterEditing() {
    const pos = this.getPos();
    if (pos === undefined) return;
    const tr = this.view.state.tr.setMeta(bookmarkPluginKey, { editingPos: pos });
    this.view.dispatch(tr);
  }

  private exitEditing() {
    const tr = this.view.state.tr.setMeta(bookmarkPluginKey, { editingPos: null });
    this.view.dispatch(tr);
    this.view.focus();
  }

  private render(url: string, editing: boolean) {
    this.isEditing = editing;

    if (editing) {
      this.inputContainer.style.display = "";
      this.cardElement.style.display = "none";
      this.editButton.style.display = "none";
      this.inputElement.value = url;
      setTimeout(() => {
        this.inputElement.focus();
        if (url) this.inputElement.select();
      }, 50);
    } else {
      this.inputContainer.style.display = "none";
      this.editButton.style.display = "";
      if (url) {
        this.renderCard(url);
        this.cardElement.style.display = "";
      } else {
        this.cardElement.style.display = "none";
        this.editButton.style.display = "none";
      }
    }
  }

  private renderCard(url: string) {
    const cached = metadataCache.get(url);
    if (cached !== undefined) {
      if (cached) {
        this.renderCardWithData(url, cached);
      } else {
        this.renderFallbackCard(url);
      }
      return;
    }

    this.renderSkeletonCard();
    void fetchURLMetadata(url).then((data) => {
      if (this.lastUrl !== url) return;
      if (data) {
        this.renderCardWithData(url, data);
      } else {
        this.renderFallbackCard(url);
      }
    });
  }

  private renderSkeletonCard() {
    this.cardElement.innerHTML = "";
    this.cardElement.className = "bookmark-card bookmark-card-telegram bookmark-card-loading";

    const inner = document.createElement("div");
    inner.className = "bookmark-tg-link";

    const body = document.createElement("div");
    body.className = "bookmark-tg-body";

    const s1 = document.createElement("div");
    s1.className = "bookmark-tg-skel bookmark-tg-skel-site";
    const s2 = document.createElement("div");
    s2.className = "bookmark-tg-skel bookmark-tg-skel-title";
    const s3 = document.createElement("div");
    s3.className = "bookmark-tg-skel bookmark-tg-skel-desc";

    body.append(s1, s2, s3);
    inner.appendChild(body);

    const thumbSkel = document.createElement("div");
    thumbSkel.className = "bookmark-tg-thumb bookmark-tg-skel";
    inner.appendChild(thumbSkel);

    this.cardElement.appendChild(inner);
  }

  private renderCardWithData(url: string, data: URLMetadata) {
    const safeUrl = sanitizeUrl(url);
    if (!safeUrl) return;
    this.cardElement.innerHTML = "";
    this.cardElement.className = "bookmark-card bookmark-card-telegram";

    const link = document.createElement("a");
    link.href = safeUrl;
    link.target = "_blank";
    link.rel = "noopener noreferrer";
    link.className = "bookmark-tg-link";

    const body = document.createElement("div");
    body.className = "bookmark-tg-body";

    const site = document.createElement("div");
    site.className = "bookmark-tg-site";
    site.textContent = extractDomain(safeUrl).toUpperCase();
    body.appendChild(site);

    if (data.title) {
      const title = document.createElement("div");
      title.className = "bookmark-tg-title";
      title.textContent = data.title;
      body.appendChild(title);
    }

    if (data.description) {
      const desc = document.createElement("div");
      desc.className = "bookmark-tg-desc";
      desc.textContent = data.description;
      body.appendChild(desc);
    }

    link.appendChild(body);

    const safeImageUrl = sanitizeUrl(data.image);
    if (safeImageUrl) {
      const thumb = document.createElement("div");
      thumb.className = "bookmark-tg-thumb";
      const img = document.createElement("img");
      img.src = safeImageUrl;
      img.alt = "";
      img.onerror = () => {
        thumb.style.display = "none";
      };
      thumb.appendChild(img);
      link.appendChild(thumb);
    }

    this.cardElement.appendChild(link);
  }

  private renderFallbackCard(url: string) {
    const safeUrl = sanitizeUrl(url);
    if (!safeUrl) return;
    this.cardElement.innerHTML = "";
    this.cardElement.className = "bookmark-card bookmark-card-telegram";

    const link = document.createElement("a");
    link.href = safeUrl;
    link.target = "_blank";
    link.rel = "noopener noreferrer";
    link.className = "bookmark-tg-link";

    const body = document.createElement("div");
    body.className = "bookmark-tg-body";

    const site = document.createElement("div");
    site.className = "bookmark-tg-site";
    site.textContent = extractDomain(safeUrl).toUpperCase();
    body.appendChild(site);

    const urlText = document.createElement("div");
    urlText.className = "bookmark-tg-url";
    urlText.textContent = safeUrl;
    body.appendChild(urlText);

    link.appendChild(body);
    this.cardElement.appendChild(link);
  }

  update(node: Node): boolean {
    if (node.type.name !== "bookmark") return false;

    const url = (node.attrs.url as string) || "";
    this.lastUrl = url;

    const ps = bookmarkPluginKey.getState(this.view.state);
    const editing = ps?.editingPos === this.getPos() || (!url && this.isEditing);
    this.render(url, editing);

    return true;
  }

  selectNode() {
    this.dom.classList.add("ProseMirror-selectednode");
  }

  deselectNode() {
    this.dom.classList.remove("ProseMirror-selectednode");
  }

  stopEvent(event: Event): boolean {
    const target = event.target as HTMLElement;
    if (target.closest(".bookmark-url-input")) return true;
    if (target.closest(".bookmark-edit-btn")) return true;
    return false;
  }

  ignoreMutation(): boolean {
    return true;
  }

  destroy() {
    activeNodeViews.delete(this);
  }
}

const activeNodeViews = new Set<BookmarkNodeView>();

export function createBookmarkPlugin(): Plugin<BookmarkState> {
  let lastEditingPos: number | null = null;

  return new Plugin<BookmarkState>({
    key: bookmarkPluginKey,
    state: {
      init: () => ({
        editingPos: null,
      }),
      apply: (transaction: Transaction, pluginState: BookmarkState, _oldState: EditorState, _state: EditorState) => {
        const meta = transaction.getMeta(bookmarkPluginKey) as { editingPos?: number | null } | undefined;

        let nextEditingPos = pluginState.editingPos;
        if (meta && "editingPos" in meta) {
          nextEditingPos = meta.editingPos ?? null;
        } else if (nextEditingPos !== null && transaction.docChanged) {
          nextEditingPos = transaction.mapping.map(nextEditingPos);
        }

        return { editingPos: nextEditingPos };
      },
    },
    view() {
      return {
        update(view: EditorView) {
          const ps = bookmarkPluginKey.getState(view.state);
          const newEditingPos = ps?.editingPos ?? null;
          if (newEditingPos !== lastEditingPos) {
            lastEditingPos = newEditingPos;
            for (const nv of activeNodeViews) {
              nv.syncEditingState();
            }
          }
        },
      };
    },
    props: {
      nodeViews: {
        bookmark(node: Node, view: EditorView, getPos: () => number | undefined) {
          return new BookmarkNodeView(node, view, getPos);
        },
      },
    },
  });
}
