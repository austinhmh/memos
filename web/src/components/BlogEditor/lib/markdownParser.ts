import { MarkdownParser } from "prosemirror-markdown";
import MarkdownIt from "markdown-it";
import markdownItContainer from "markdown-it-container";
import { full as emojiPlugin } from "markdown-it-emoji";
import type { Schema } from "prosemirror-model";
import { markdownMath } from "@/lib/markdown/rules/math";
import { markdownCheckboxes } from "@/lib/markdown/rules/checkboxes";
import { markdownTag } from "@/lib/markdown/rules/tag";
import { markdownHighlight } from "@/lib/markdown/rules/highlight";
import { markdownUnderlines } from "@/lib/markdown/rules/underlines";

function listIsTight(tokens: { type: string; hidden?: boolean }[], i: number): boolean {
  while (++i < tokens.length) {
    if (tokens[i].type !== "list_item_open" && tokens[i].type !== "checkbox_item_open") {
      return !!tokens[i].hidden;
    }
  }
  return false;
}

let cachedTokenizer: MarkdownIt | null = null;

/**
 * Separate markdown-it instance for ProseMirror.
 * Uses the same plugins as the shared parser, but adds a core rule
 * to normalize custom tokens (tag, emoji, checkbox, math, notice)
 * into standard markdown-it tokens that ProseMirror can handle.
 */
function getProseMirrorTokenizer(): MarkdownIt {
  if (cachedTokenizer) return cachedTokenizer;

  const md = new MarkdownIt("default", { html: true, breaks: false, linkify: false });
  md.use(emojiPlugin);
  md.use(markdownMath);
  md.use(markdownCheckboxes);
  md.use(markdownTag);
  md.use(markdownHighlight);
  md.use(markdownUnderlines);
  md.use(markdownItContainer, "notice", { marker: ":", validate: () => true });

  md.core.ruler.push("prosemirror_compat", (state) => {
    for (const blockToken of state.tokens) {
      switch (blockToken.type) {
        case "container_notice_open": blockToken.type = "blockquote_open"; break;
        case "container_notice_close": blockToken.type = "blockquote_close"; break;
        case "math_block":
          blockToken.type = "fence";
          blockToken.info = "math";
          break;
        case "html_block":
          blockToken.type = "fence";
          blockToken.info = "html";
          break;
      }

      if (blockToken.type === "inline" && blockToken.children) {
        for (const tok of blockToken.children) {
          switch (tok.type) {
            case "tag":
              tok.type = "text";
              tok.content = "#" + tok.content;
              break;
            case "emoji":
              tok.type = "text";
              break;
            case "math_inline":
              tok.type = "code_inline";
              break;
            case "html_inline":
              tok.type = "text";
              break;
          }
        }
      }
    }
  });

  cachedTokenizer = md;
  return md;
}

export function createMdParser(schema: Schema): MarkdownParser {
  const tokenizer = getProseMirrorTokenizer();

  const tokens: Record<string, { block?: string; node?: string; mark?: string; ignore?: boolean; getAttrs?: (tok: any, tokens: any[], i: number) => Record<string, unknown>; noCloseToken?: boolean }> = {
    blockquote: { block: "blockquote" },
    paragraph: { block: "paragraph" },
    list_item: { block: "list_item" },
    checkbox_item: {
      block: "checkbox_item",
      getAttrs: (tok: { attrGet: (name: string) => string | null }) => ({
        checked: tok.attrGet("checked") === "true",
      }),
    },
    bullet_list: {
      block: "bullet_list",
      getAttrs: (_tok: unknown, toks: { type: string; hidden?: boolean }[], i: number) => ({ tight: listIsTight(toks, i) }),
    },
    checkbox_list: {
      block: "checkbox_list",
      getAttrs: (_tok: unknown, toks: { type: string; hidden?: boolean }[], i: number) => ({ tight: listIsTight(toks, i) }),
    },
    ordered_list: {
      block: "ordered_list",
      getAttrs: (tok: { attrGet: (name: string) => string | null }, toks: { type: string; hidden?: boolean }[], i: number) => ({
        order: +(tok.attrGet("start") || 1),
        tight: listIsTight(toks, i),
      }),
    },
    heading: {
      block: "heading",
      getAttrs: (tok: { tag: string }) => ({ level: Number(tok.tag.slice(1)) }),
    },
    code_block: {
      block: "code_block",
      getAttrs: () => ({ language: "" }),
      noCloseToken: true,
    },
    fence: {
      block: "code_block",
      getAttrs: (tok: { info?: string }) => ({ language: (tok.info || "").trim() }),
      noCloseToken: true,
    },
    hr: { node: "horizontal_rule" },
    image: {
      node: "image",
      getAttrs: (tok: { attrGet: (n: string) => string | null; children?: { content?: string }[] }) => ({
        src: tok.attrGet("src"),
        title: tok.attrGet("title") || null,
        alt: (tok.children?.[0] as { content?: string } | undefined)?.content ?? null,
      }),
    },
    hardbreak: { node: "hard_break" },
    softbreak: { node: "hard_break" },
    table: { block: "table" },
    thead: { block: "table" },
    tbody: { block: "table" },
    tr: { block: "table_row" },
    th: {
      block: "table_header",
      getAttrs: (tok: { attrGet?: (n: string) => string | null; attrs?: [string, string][] }) => {
        const style = typeof tok.attrGet === "function" ? tok.attrGet("style") : null;
        const match = style?.match(/text-align:\s*(left|center|right)/);
        return { alignment: match ? match[1] : null };
      },
    },
    td: {
      block: "table_cell",
      getAttrs: (tok: { attrGet?: (n: string) => string | null; attrs?: [string, string][] }) => {
        const style = typeof tok.attrGet === "function" ? tok.attrGet("style") : null;
        const match = style?.match(/text-align:\s*(left|center|right)/);
        return { alignment: match ? match[1] : null };
      },
    },
    em: { mark: "em" },
    strong: { mark: "strong" },
    s: { mark: "s" },
    highlight: { mark: "highlight" },
    underline: { mark: "underline" },
    link: {
      mark: "link",
      getAttrs: (tok: { attrGet: (n: string) => string | null }) => ({
        href: tok.attrGet("href"),
        title: tok.attrGet("title") || null,
      }),
    },
    code_inline: { mark: "code", noCloseToken: true },
  };

  return new MarkdownParser(schema, tokenizer, tokens);
}
