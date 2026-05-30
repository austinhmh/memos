import MarkdownIt from "markdown-it";
import type Token from "markdown-it/lib/token.mjs";
import markdownItContainer from "markdown-it-container";
import { full as emojiPlugin } from "markdown-it-emoji";
import type { ParseSpec } from "prosemirror-markdown";
import { MarkdownParser } from "prosemirror-markdown";
import type { Schema } from "prosemirror-model";
import { markdownCheckboxes } from "@/lib/markdown/rules/checkboxes";
import { markdownHighlight } from "@/lib/markdown/rules/highlight";
import { markdownMath } from "@/lib/markdown/rules/math";
import { markdownTag } from "@/lib/markdown/rules/tag";
import { markdownTextColor } from "@/lib/markdown/rules/textColor";
import { markdownUnderlines } from "@/lib/markdown/rules/underlines";
import { sanitizeImageUrl, sanitizeUrl } from "@/lib/sanitize-url";

function listIsTight(tokens: readonly { type: string; hidden?: boolean }[], i: number): boolean {
  while (++i < tokens.length) {
    if (tokens[i].type !== "list_item_open" && tokens[i].type !== "checkbox_item_open") {
      return !!tokens[i].hidden;
    }
  }
  return false;
}

const getAlign = (tok: Token) => {
  const style = tok.attrGet("style");
  const match = style?.match(/text-align:\s*(left|center|right)/);
  return { alignment: match ? match[1] : null };
};

const sanitizeHighlightColor = (color: string | null | undefined) => {
  if (!color) return null;
  const value = color.trim();
  return /^#[0-9a-fA-F]{6}$/.test(value) ? value : null;
};

const sanitizeTextColor = sanitizeHighlightColor;

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
  md.use(markdownTextColor);
  md.use(markdownHighlight);
  md.use(markdownUnderlines);
  md.use(markdownItContainer, "notice", { marker: ":", validate: () => true });

  md.core.ruler.push("prosemirror_compat", (state) => {
    for (const blockToken of state.tokens) {
      switch (blockToken.type) {
        case "container_notice_open":
          blockToken.type = "blockquote_open";
          break;
        case "container_notice_close":
          blockToken.type = "blockquote_close";
          break;
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

  const bareUrlPattern = /^https?:\/\/\S+$/;
  const isAttachmentUrl = (href: string) => {
    const safeHref = sanitizeUrl(href) || "";
    return /^\/file\/attachments\/[^/]+\/.+/.test(safeHref) || /^https?:\/\/[^/]+\/file\/attachments\/[^/]+\/.+/.test(safeHref);
  };

  md.core.ruler.push("prosemirror_attachments", (state) => {
    const tokens = state.tokens;
    let i = 0;
    while (i < tokens.length) {
      if (
        tokens[i].type === "paragraph_open" &&
        i + 2 < tokens.length &&
        tokens[i + 1].type === "inline" &&
        tokens[i + 2].type === "paragraph_close"
      ) {
        const children = tokens[i + 1].children || [];
        if (children.length === 3 && children[0].type === "link_open" && children[1].type === "text" && children[2].type === "link_close") {
          const href = sanitizeUrl(children[0].attrGet("href")) || "";
          if (href && isAttachmentUrl(href)) {
            const content = children[1].content;
            const parts = content.split(" ");
            const size = Number.parseInt(parts.pop() || "0", 10);
            const title = parts.join(" ") || decodeURIComponent(href.split("/").pop() || "");
            const token = new state.Token("attachment", "a", 0);
            token.attrSet("href", href);
            token.attrSet("title", title);
            token.attrSet("size", String(Number.isFinite(size) ? size : 0));
            tokens.splice(i, 3, token);
            continue;
          }
        }
      }
      i++;
    }
  });

  md.core.ruler.push("prosemirror_bookmark", (state) => {
    const tokens = state.tokens;
    let i = 0;
    while (i < tokens.length) {
      if (
        tokens[i].type === "paragraph_open" &&
        i + 2 < tokens.length &&
        tokens[i + 1].type === "inline" &&
        tokens[i + 2].type === "paragraph_close"
      ) {
        const children = tokens[i + 1].children || [];
        let bookmarkUrl: string | null = null;

        if (children.length === 3 && children[0].type === "link_open" && children[1].type === "text" && children[2].type === "link_close") {
          const href = sanitizeUrl(children[0].attrGet("href")) || "";
          if (href && children[1].content === href && !href.startsWith("#")) {
            bookmarkUrl = href;
          }
        }

        if (!bookmarkUrl && children.length === 1 && children[0].type === "text" && bareUrlPattern.test(children[0].content.trim())) {
          bookmarkUrl = sanitizeUrl(children[0].content.trim()) || null;
        }

        if (bookmarkUrl) {
          const token = new state.Token("bookmark", "", 0);
          token.attrSet("url", bookmarkUrl);
          tokens.splice(i, 3, token);
          continue;
        }
      }
      i++;
    }
  });

  md.core.ruler.push("prosemirror_table_sections", (state) => {
    state.tokens = state.tokens.filter((token) => !["thead_open", "thead_close", "tbody_open", "tbody_close"].includes(token.type));
  });

  cachedTokenizer = md;
  return md;
}

export function createMdParser(schema: Schema): MarkdownParser {
  const tokenizer = getProseMirrorTokenizer();

  const tokens: Record<string, ParseSpec> = {
    blockquote: { block: "blockquote" },
    paragraph: { block: "paragraph" },
    list_item: { block: "list_item" },
    checkbox_item: {
      block: "checkbox_item",
      getAttrs: (tok: Token) => ({
        checked: tok.attrGet("checked") === "true",
      }),
    },
    bullet_list: {
      block: "bullet_list",
      getAttrs: (_tok: Token, toks: Token[], i: number) => ({ tight: listIsTight(toks, i) }),
    },
    checkbox_list: {
      block: "checkbox_list",
      getAttrs: (_tok: Token, toks: Token[], i: number) => ({ tight: listIsTight(toks, i) }),
    },
    ordered_list: {
      block: "ordered_list",
      getAttrs: (tok: Token, toks: Token[], i: number) => ({
        order: +(tok.attrGet("start") || 1),
        tight: listIsTight(toks, i),
      }),
    },
    heading: {
      block: "heading",
      getAttrs: (tok: Token) => ({ level: Number(tok.tag.slice(1)) }),
    },
    code_block: {
      block: "code_block",
      getAttrs: () => ({ language: "" }),
      noCloseToken: true,
    },
    fence: {
      block: "code_block",
      getAttrs: (tok: Token) => ({ language: (tok.info || "").trim() }),
      noCloseToken: true,
    },
    hr: { node: "horizontal_rule" },
    image: {
      node: "image",
      getAttrs: (tok: Token) => ({
        src: sanitizeImageUrl(tok.attrGet("src")) || "",
        title: tok.attrGet("title") || null,
        alt: tok.children?.[0]?.content ?? null,
      }),
    },
    hardbreak: { node: "hard_break" },
    softbreak: { node: "hard_break" },
    table: { block: "table" },
    tr: { block: "table_row" },
    th: {
      block: "table_header",
      getAttrs: getAlign,
    },
    td: {
      block: "table_cell",
      getAttrs: getAlign,
    },
    em: { mark: "em" },
    strong: { mark: "strong" },
    s: { mark: "s" },
    highlight: {
      mark: "highlight",
      getAttrs: (tok: Token) => ({ color: sanitizeHighlightColor(tok.attrGet("data-color")) }),
    },
    text_color: {
      mark: "text_color",
      getAttrs: (tok: Token) => ({ color: sanitizeTextColor(tok.attrGet("data-color")) || "#111827" }),
    },
    underline: { mark: "underline" },
    link: {
      mark: "link",
      getAttrs: (tok: Token) => ({
        href: sanitizeUrl(tok.attrGet("href")) || "",
        title: tok.attrGet("title") || null,
      }),
    },
    code_inline: { mark: "code", noCloseToken: true },
    bookmark: {
      node: "bookmark",
      getAttrs: (tok: Token) => ({
        url: sanitizeUrl(tok.attrGet("url")) || "",
      }),
    },
    attachment: {
      node: "attachment",
      getAttrs: (tok: Token) => ({
        href: sanitizeUrl(tok.attrGet("href")) || "",
        title: tok.attrGet("title") || "",
        size: Number.parseInt(tok.attrGet("size") || "0", 10),
      }),
    },
  };

  return new MarkdownParser(schema, tokenizer, tokens);
}
