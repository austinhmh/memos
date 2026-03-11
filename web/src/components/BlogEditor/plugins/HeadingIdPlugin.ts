import type { Node as ProsemirrorNode } from "prosemirror-model";
import { Plugin, PluginKey, type Transaction } from "prosemirror-state";
import { Decoration, DecorationSet } from "prosemirror-view";
import headingToSlug from "@/outline-vendor/shared/editor/lib/headingToSlug";
import { EditorStyleHelper } from "@/outline-vendor/shared/editor/styles/EditorStyleHelper";

type HeadingIdState = {
  decorations: DecorationSet;
};

type ChangedRange = {
  from: number;
  to: number;
};

const headingIdPluginKey = new PluginKey<HeadingIdState>("headingId");

function createDecorations(doc: ProsemirrorNode): DecorationSet {
  const seen: Record<string, number> = {};
  const decorations: Decoration[] = [];

  doc.descendants((node, pos) => {
    if (node.type.name !== "heading") {
      return false;
    }

    const slug = headingToSlug(node);
    const index = seen[slug] ?? 0;
    seen[slug] = index + 1;

    const id = index === 0 ? slug : headingToSlug(node, index);
    decorations.push(
      Decoration.widget(
        pos,
        () => {
          const anchor = document.createElement("a");
          anchor.id = id;
          anchor.className = EditorStyleHelper.headingPositionAnchor;
          anchor.setAttribute("contenteditable", "false");
          anchor.setAttribute("aria-hidden", "true");
          return anchor;
        },
        { side: -1, key: id },
      ),
    );

    return false;
  });

  return DecorationSet.create(doc, decorations);
}

function normalizeRange(doc: ProsemirrorNode, range: ChangedRange): ChangedRange | null {
  const maxPos = doc.content.size;
  const from = Math.max(0, Math.min(range.from, maxPos));
  const to = Math.max(0, Math.min(range.to, maxPos));

  if (to < from) {
    return null;
  }

  return { from, to };
}

function hasHeadingInRange(doc: ProsemirrorNode, range: ChangedRange): boolean {
  const normalizedRange = normalizeRange(doc, range);
  if (!normalizedRange) {
    return false;
  }

  let found = false;
  doc.nodesBetween(normalizedRange.from, normalizedRange.to, (node) => {
    if (node.type.name === "heading") {
      found = true;
      return false;
    }
    return !found;
  });

  return found;
}

function transactionTouchesHeadings(
  tr: Transaction,
  oldDoc: ProsemirrorNode,
  newDoc: ProsemirrorNode,
): boolean {
  if (!tr.docChanged) {
    return false;
  }

  const docs = ((tr as Transaction & { docs?: ProsemirrorNode[] }).docs ?? []) as ProsemirrorNode[];

  if (tr.mapping.maps.length === 0) {
    return true;
  }

  for (let index = 0; index < tr.mapping.maps.length; index++) {
    const map = tr.mapping.maps[index];
    const stepOldDoc = docs[index] ?? (index === 0 ? oldDoc : newDoc);
    const stepNewDoc = docs[index + 1] ?? newDoc;
    let touchedHeading = false;

    map.forEach((oldStart, oldEnd, newStart, newEnd) => {
      if (touchedHeading) {
        return;
      }

      if (
        hasHeadingInRange(stepOldDoc, { from: oldStart - 1, to: oldEnd + 1 }) ||
        hasHeadingInRange(stepNewDoc, { from: newStart - 1, to: newEnd + 1 })
      ) {
        touchedHeading = true;
      }
    });

    if (touchedHeading) {
      return true;
    }
  }

  return false;
}

export function createHeadingIdPlugin(): Plugin<HeadingIdState> {
  return new Plugin<HeadingIdState>({
    key: headingIdPluginKey,
    state: {
      init: (_, state) => ({
        decorations: createDecorations(state.doc),
      }),
      apply(tr, pluginState, oldState, newState) {
        if (!tr.docChanged) {
          return pluginState;
        }

        if (!transactionTouchesHeadings(tr, oldState.doc, newState.doc)) {
          return {
            decorations: pluginState.decorations.map(tr.mapping, tr.doc),
          };
        }

        return {
          decorations: createDecorations(newState.doc),
        };
      },
    },
    props: {
      decorations(state) {
        return headingIdPluginKey.getState(state)?.decorations ?? null;
      },
      handleClick(_view, _pos, event) {
        const target = event.target as HTMLElement;
        const link = target.closest("a[href^='#']") as HTMLAnchorElement | null;
        if (!link) return false;

        const href = link.getAttribute("href");
        if (!href || !href.startsWith("#")) return false;

        event.preventDefault();
        const targetId = decodeURIComponent(href.substring(1));
        const targetEl = document.getElementById(targetId);
        if (targetEl) {
          targetEl.scrollIntoView({ behavior: "smooth", block: "start" });
        }
        return true;
      },
    },
  });
}
