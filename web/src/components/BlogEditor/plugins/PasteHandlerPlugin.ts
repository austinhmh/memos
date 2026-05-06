import type { MarkdownParser } from "prosemirror-markdown";
import type { Schema } from "prosemirror-model";
import { Fragment, Slice } from "prosemirror-model";
import { Plugin } from "prosemirror-state";
import isMarkdown from "../lib/isMarkdown";
import normalizePastedMarkdown from "../lib/normalizePastedMarkdown";

/**
 * ProseMirror plugin that intercepts paste events and parses pasted
 * Markdown text into structured ProseMirror nodes.
 */
export function createPasteHandlerPlugin(schema: Schema, parser: MarkdownParser) {
  return new Plugin({
    props: {
      handlePaste(view, event) {
        console.log("[PasteHandler] handlePaste called");

        if (!view.editable || !event.clipboardData) {
          console.log("[PasteHandler] skip: not editable or no clipboardData");
          return false;
        }

        const text = event.clipboardData.getData("text/plain");
        const html = event.clipboardData.getData("text/html");

        console.log("[PasteHandler] text length:", text?.length, "html length:", html?.length);

        if (!text) {
          console.log("[PasteHandler] skip: no text");
          return false;
        }

        // Inside a code block → paste as plain text (default behavior).
        const { $from } = view.state.selection;
        for (let d = $from.depth; d >= 0; d--) {
          if ($from.node(d).type.spec.code) {
            console.log("[PasteHandler] skip: inside code block");
            return false;
          }
        }

        // Copied from another ProseMirror editor → default HTML parser.
        if (html?.includes("data-pm-slice")) {
          console.log("[PasteHandler] skip: ProseMirror slice");
          return false;
        }

        const mdDetected = isMarkdown(text);
        console.log("[PasteHandler] isMarkdown:", mdDetected, "hasHtml:", !!html);

        if (!mdDetected && html) {
          console.log("[PasteHandler] skip: not markdown and has html");
          return false;
        }

        event.preventDefault();

        const normalized = normalizePastedMarkdown(text);
        console.log("[PasteHandler] normalized text length:", normalized.length);

        try {
          const parsed = parser.parse(normalized);
          console.log("[PasteHandler] parsed:", parsed ? "ok" : "null", "childCount:", parsed?.content?.childCount);

          if (!parsed) {
            console.log("[PasteHandler] ERROR: parser returned null");
            return false;
          }

          const slice = parsed.slice(0);
          const singleNode =
            slice.openStart === 0 && slice.openEnd === 0 && slice.content.childCount === 1 ? slice.content.firstChild : null;

          const tr = view.state.tr;

          if (singleNode?.type === schema.nodes.paragraph) {
            tr.replaceSelection(new Slice(singleNode.content, 0, 0));
          } else {
            tr.replaceSelection(slice);
          }

          view.dispatch(tr.scrollIntoView().setMeta("paste", true).setMeta("uiEvent", "paste"));
          console.log("[PasteHandler] SUCCESS: dispatched parsed content");
          return true;
        } catch (err) {
          console.error("[PasteHandler] ERROR:", err);
          return false;
        }
      },

      clipboardTextParser(text, _$context, _plain, _view) {
        console.log("[PasteHandler] clipboardTextParser called, text length:", text?.length);

        if (isMarkdown(text)) {
          console.log("[PasteHandler] clipboardTextParser: detected markdown");
          const normalized = normalizePastedMarkdown(text);
          try {
            const parsed = parser.parse(normalized);
            if (parsed) {
              console.log("[PasteHandler] clipboardTextParser: parsed ok");
              return parsed.slice(0);
            }
          } catch (err) {
            console.error("[PasteHandler] clipboardTextParser error:", err);
          }
        }

        // Default: split by double-newline into paragraphs.
        const blocks = text.split(/\n{2,}/);
        const nodes = blocks.map((block) => {
          const trimmed = block.replace(/\n/g, " ").trim();
          if (!trimmed) {
            return schema.nodes.paragraph.create();
          }
          return schema.nodes.paragraph.create(null, trimmed ? schema.text(trimmed) : undefined);
        });
        return new Slice(Fragment.from(nodes), 0, 0);
      },
    },
  });
}
