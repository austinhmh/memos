import { Schema } from "prosemirror-model";
import { sanitizeImageUrl, sanitizeUrl } from "@/lib/sanitize-url";
import { getCellAttrs, setCellAttrs } from "../plugins/TableControlsPlugin";

/**
 * ProseMirror schema for the blog editor (Outline-style).
 * code_block uses `language` attr for fence info (e.g. "mermaid").
 */
export const blogEditorSchema = new Schema({
  nodes: {
    doc: {
      content: "block+",
    },
    paragraph: {
      content: "inline*",
      group: "block",
      parseDOM: [{ tag: "p" }],
      toDOM: () => ["p", { dir: "auto" }, 0],
    },
    blockquote: {
      content: "block+",
      group: "block",
      defining: true,
      parseDOM: [{ tag: "blockquote" }],
      toDOM: () => ["blockquote", 0],
    },
    horizontal_rule: {
      group: "block",
      parseDOM: [{ tag: "hr" }],
      toDOM: () => ["hr"],
    },
    heading: {
      attrs: { level: { default: 1 } },
      content: "inline*",
      group: "block",
      defining: true,
      parseDOM: [1, 2, 3, 4, 5, 6].map((level) => ({
        tag: `h${level}`,
        attrs: { level },
      })),
      toDOM: (node) => [`h${node.attrs.level}`, { dir: "auto" }, 0],
    },
    code_block: {
      attrs: { language: { default: "" } },
      content: "text*",
      marks: "",
      group: "block",
      code: true,
      defining: true,
      parseDOM: [
        {
          tag: ".code-block",
          preserveWhitespace: "full",
          getAttrs: (dom: HTMLElement) => ({
            language: (dom as HTMLElement).dataset?.language ?? "",
          }),
        },
        {
          tag: "pre",
          preserveWhitespace: "full",
          getAttrs: (dom: HTMLElement) => {
            const code = dom.querySelector("code");
            const lang = code?.getAttribute("class")?.replace(/^language-/, "") ?? "";
            return { language: lang };
          },
        },
      ],
      toDOM: (node) => [
        "div",
        {
          class: "code-block",
          "data-language": node.attrs.language || "",
        },
        ["pre", ["code", { spellCheck: "false" }, 0]],
      ],
    },
    ordered_list: {
      content: "list_item+",
      group: "block list",
      attrs: { order: { default: 1 }, tight: { default: false } },
      parseDOM: [
        {
          tag: "ol",
          getAttrs: (dom: HTMLElement) => ({
            order: (dom as HTMLOListElement).hasAttribute("start") ? +(dom as HTMLOListElement).getAttribute("start")! : 1,
            tight: (dom as HTMLElement).hasAttribute("data-tight"),
          }),
        },
      ],
      toDOM: (node) => [
        "ol",
        {
          start: node.attrs.order === 1 ? null : node.attrs.order,
          "data-tight": node.attrs.tight ? "true" : null,
        },
        0,
      ],
    },
    checkbox_list: {
      content: "checkbox_item+",
      group: "block list",
      attrs: { tight: { default: true } },
      parseDOM: [
        {
          tag: "ul.checkbox_list",
          getAttrs: (dom: HTMLElement) => ({
            tight: !(dom as HTMLElement).hasAttribute("data-tight") || (dom as HTMLElement).getAttribute("data-tight") === "true",
          }),
        },
      ],
      toDOM: (node) => ["ul", { class: "checkbox_list", "data-tight": node.attrs.tight ? "true" : "false" }, 0],
    },
    bullet_list: {
      content: "list_item+",
      group: "block list",
      attrs: { tight: { default: false } },
      parseDOM: [
        {
          tag: "ul",
          getAttrs: (dom: HTMLElement) => ({
            tight: (dom as HTMLElement).hasAttribute("data-tight"),
          }),
        },
      ],
      toDOM: (node) => ["ul", { "data-tight": node.attrs.tight ? "true" : null }, 0],
    },
    checkbox_item: {
      attrs: { checked: { default: false } },
      content: "block+",
      defining: true,
      parseDOM: [
        {
          tag: 'li[data-type="checkbox_item"]',
          contentElement: "div",
          getAttrs: (dom: HTMLElement) => ({
            checked: dom.classList.contains("checked") || dom.getAttribute("data-checked") === "true",
          }),
        },
      ],
      toDOM: (node) => [
        "li",
        {
          "data-type": "checkbox_item",
          "data-checked": node.attrs.checked ? "true" : "false",
          class: node.attrs.checked ? "checked" : null,
        },
        ["span", { contentEditable: "false" }, ["span", { class: "checkbox", "aria-checked": node.attrs.checked ? "true" : "false" }]],
        ["div", 0],
      ],
    },
    list_item: {
      content: "block+",
      defining: true,
      parseDOM: [{ tag: "li" }],
      toDOM: () => ["li", 0],
    },
    table: {
      content: "table_row+",
      group: "block",
      tableRole: "table",
      isolating: true,
      parseDOM: [{ tag: "table" }],
      toDOM: () => ["table", ["tbody", 0]],
    },
    table_row: {
      content: "(table_cell | table_header)*",
      tableRole: "row",
      parseDOM: [{ tag: "tr" }],
      toDOM: () => ["tr", 0],
    },
    table_header: {
      content: "inline*",
      attrs: {
        colspan: { default: 1 },
        rowspan: { default: 1 },
        alignment: { default: null },
        colwidth: { default: null },
      },
      tableRole: "header_cell",
      isolating: true,
      parseDOM: [{ tag: "th", getAttrs: getCellAttrs }],
      toDOM: (node) => ["th", setCellAttrs(node), 0],
    },
    table_cell: {
      content: "inline*",
      attrs: {
        colspan: { default: 1 },
        rowspan: { default: 1 },
        alignment: { default: null },
        colwidth: { default: null },
      },
      tableRole: "cell",
      isolating: true,
      parseDOM: [{ tag: "td", getAttrs: getCellAttrs }],
      toDOM: (node) => ["td", setCellAttrs(node), 0],
    },
    bookmark: {
      attrs: { url: { default: "" } },
      group: "block",
      atom: true,
      selectable: true,
      draggable: true,
      parseDOM: [
        {
          tag: "div.bookmark-block",
          getAttrs: (dom: HTMLElement) => ({
            url: sanitizeUrl(dom.dataset.url) || "",
          }),
        },
      ],
      toDOM: (node) => [
        "div",
        {
          class: "bookmark-block",
          "data-url": sanitizeUrl(node.attrs.url) || "",
        },
      ],
    },
    text: {
      group: "inline",
    },
    image: {
      inline: true,
      attrs: {
        src: { default: "" },
        width: { default: undefined },
        height: { default: undefined },
        alt: { default: null },
        source: { default: null },
        layoutClass: { default: null },
        title: { default: null },
        marks: { default: undefined },
      },
      content: "text*",
      marks: "",
      group: "inline",
      selectable: true,
      draggable: false,
      atom: true,
      parseDOM: [
        {
          tag: "div[class~=image]",
          getAttrs: (dom: HTMLElement) => {
            const img = dom.getElementsByTagName("img")[0];
            const className = dom.className;
            const layoutClassMatched = className && className.match(/image-(.*)$/);
            const width = img?.getAttribute("width");
            const height = img?.getAttribute("height");
            return {
              src: sanitizeImageUrl(img?.getAttribute("src")) || "",
              alt: img?.getAttribute("alt"),
              title: img?.getAttribute("title"),
              source: sanitizeImageUrl(img?.getAttribute("source")) || null,
              width: width ? parseInt(width, 10) : undefined,
              height: height ? parseInt(height, 10) : undefined,
              layoutClass: layoutClassMatched ? layoutClassMatched[1] : null,
            };
          },
        },
        {
          tag: "img[src]",
          getAttrs: (dom: HTMLElement) => {
            if (dom.parentElement?.classList.contains("image") || dom.parentElement?.classList.contains("emoji")) {
              return false;
            }

            let width = dom.getAttribute("width");
            let height = dom.getAttribute("height");
            if (!width && dom.style.width?.endsWith("px")) {
              width = dom.style.width.slice(0, -2);
            }
            if (!height && dom.style.height?.endsWith("px")) {
              height = dom.style.height.slice(0, -2);
            }

            return {
              src: sanitizeImageUrl(dom.getAttribute("src")) || "",
              alt: dom.getAttribute("alt"),
              title: dom.getAttribute("title"),
              width: width ? parseInt(width, 10) : undefined,
              height: height ? parseInt(height, 10) : undefined,
            };
          },
        },
      ],
      toDOM: (node) => {
        const className = node.attrs.layoutClass ? `image image-${node.attrs.layoutClass}` : "image";
        const src = sanitizeImageUrl(node.attrs.src) || "";
        const source = sanitizeImageUrl(node.attrs.source) || null;
        return [
          "div",
          { class: className },
          [
            "img",
            {
              ...node.attrs,
              src,
              source,
              width: node.attrs.width,
              height: node.attrs.height,
              contentEditable: "false",
              loading: "lazy",
            },
          ],
        ];
      },
    },
    hard_break: {
      inline: true,
      group: "inline",
      selectable: false,
      parseDOM: [{ tag: "br" }],
      toDOM: () => ["br"],
    },
  },
  marks: {
    link: {
      attrs: {
        href: {},
        title: { default: null },
      },
      inclusive: false,
      parseDOM: [
        {
          tag: "a[href]",
          getAttrs: (dom: HTMLElement) => ({
            href: sanitizeUrl(dom.getAttribute("href")) || "",
            title: dom.getAttribute("title"),
          }),
        },
      ],
      toDOM: (node) => [
        "a",
        {
          title: node.attrs.title,
          href: sanitizeUrl(node.attrs.href) || "",
          rel: "noopener noreferrer nofollow",
        },
        0,
      ],
    },
    em: {
      parseDOM: [{ tag: "i" }, { tag: "em" }, { style: "font-style=italic" }],
      toDOM: () => ["em"],
    },
    strong: {
      parseDOM: [{ tag: "strong" }, { tag: "b", getAttrs: (dom: HTMLElement) => (dom.style.fontWeight !== "normal" ? {} : false) }],
      toDOM: () => ["strong"],
    },
    code: {
      code: true,
      parseDOM: [{ tag: "code" }],
      toDOM: () => ["code"],
    },
    s: {
      parseDOM: [{ tag: "s" }, { tag: "strike" }, { style: "text-decoration=line-through" }],
      toDOM: () => ["s"],
    },
    highlight: {
      parseDOM: [{ tag: "mark" }],
      toDOM: () => ["mark"],
    },
    underline: {
      parseDOM: [{ style: "text-decoration=underline" }],
      toDOM: () => ["u"],
    },
  },
});

export type BlogEditorSchema = typeof blogEditorSchema;
