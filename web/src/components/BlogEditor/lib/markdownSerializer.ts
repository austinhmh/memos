import { MarkdownSerializer, type MarkdownSerializerState } from "prosemirror-markdown";
import type { Mark, Node } from "prosemirror-model";
import { sanitizeImageUrl, sanitizeUrl } from "@/lib/sanitize-url";

type NodeSerializer = (state: MarkdownSerializerState, node: Node, parent: Node, index: number) => void;
type MarkSpec = {
  open: string | ((state: MarkdownSerializerState, mark: Mark, parent: Node, index: number) => string);
  close: string | ((state: MarkdownSerializerState, mark: Mark, parent: Node, index: number) => string);
  mixable?: boolean;
  expelEnclosingWhitespace?: boolean;
  escape?: boolean;
};

const sanitizeHighlightColor = (color: unknown) => {
  if (typeof color !== "string") return null;
  const value = color.trim();
  return /^#[0-9a-fA-F]{6}$/.test(value) ? value : null;
};

const colorToMarkdownValue = (color: string) => color.slice(1).toUpperCase();

/**
 * Create a Markdown serializer for the blog editor schema.
 * code_block uses `language` attr (outputs ```language\n...\n```).
 */
export function createMdSerializer(): MarkdownSerializer {
  const escapeTableCellText = (text: string) => text.replace(/\\/g, "\\\\").replace(/\|/g, "\\|").replace(/\r?\n/g, "<br>");

  const createEmptyHeaderRow = (node: Node, colCount: number) => {
    const headerType = node.type.schema.nodes.table_header;
    const rowType = node.type.schema.nodes.table_row;
    return rowType.create(
      null,
      Array.from({ length: colCount }, () => headerType.create(null)),
    );
  };

  const nodes: Record<string, NodeSerializer> = {
    blockquote(state, node) {
      state.wrapBlock("> ", null, node, () => state.renderContent(node));
    },
    code_block(state, node) {
      const lang = (node.attrs.language as string) || "";
      state.write("```" + lang + "\n");
      state.text(node.textContent, false);
      state.ensureNewLine();
      state.write("```");
      state.closeBlock(node);
    },
    heading(state, node) {
      state.write(state.repeat("#", node.attrs.level) + " ");
      state.renderInline(node);
      state.closeBlock(node);
    },
    horizontal_rule(state, node) {
      state.write("\n---");
      state.closeBlock(node);
    },
    bullet_list(state, node) {
      state.renderList(node, "  ", () => (node.attrs.bullet || "*") + " ");
    },
    checkbox_list(state, node) {
      state.renderList(node, "  ", () => "- ");
    },
    ordered_list(state, node) {
      const start = node.attrs.order || 1;
      const maxW = String(start + node.childCount - 1).length;
      const space = state.repeat(" ", maxW + 2);
      state.renderList(node, space, (i) => {
        const nStr = String(start + i);
        return state.repeat(" ", maxW - nStr.length) + nStr + ". ";
      });
    },
    list_item(state, node) {
      state.renderContent(node);
    },
    checkbox_item(state, node) {
      state.write(node.attrs.checked ? "[x] " : "[ ] ");
      state.renderContent(node);
    },
    paragraph(state, node) {
      state.renderInline(node);
      state.closeBlock(node);
    },
    image(state, node) {
      const safeSrc = sanitizeImageUrl(node.attrs.src as string) || "";
      state.write(
        " ![" + state.esc(((node.attrs.alt as string | null) || "").replace("\n", ""), false) + "](" + state.esc(safeSrc, false) + ")",
      );
    },
    hard_break(state, _node, parent, index) {
      for (let i = index + 1; i < parent.childCount; i++) {
        if (parent.child(i).type.name !== "hard_break") {
          state.write("\\\n");
          return;
        }
      }
    },
    table(state, node) {
      const rows: Node[] = [];
      node.forEach((row) => rows.push(row));
      if (rows.length === 0) return;

      const colCount = rows.reduce((max, row) => Math.max(max, row.childCount), 0);
      if (colCount === 0) return;
      const hasHeaderRow = rows[0].childCount > 0 && rows[0].firstChild?.type.name === "table_header";
      const rowsToSerialize = hasHeaderRow ? rows : [createEmptyHeaderRow(node, colCount), ...rows];
      const colWidths: number[] = new Array(colCount).fill(3);
      const alignments: (string | null)[] = new Array(colCount).fill(null);

      for (const row of rowsToSerialize) {
        for (let c = 0; c < colCount; c++) {
          const cell = c < row.childCount ? row.child(c) : null;
          const text = escapeTableCellText(cell?.textContent ?? "");
          if (text.length + 2 > colWidths[c]) colWidths[c] = text.length + 2;
          if (cell?.attrs.alignment) alignments[c] = cell.attrs.alignment as string;
        }
      }

      const renderRow = (row: Node | null) => {
        let line = "|";
        for (let c = 0; c < colCount; c++) {
          const cell = row && c < row.childCount ? row.child(c) : null;
          const text = escapeTableCellText(cell?.textContent ?? "");
          const pad = colWidths[c] - text.length;
          line += " " + text + " ".repeat(pad > 0 ? pad : 0) + " |";
        }
        return line;
      };

      state.write(renderRow(rowsToSerialize[0]));
      state.ensureNewLine();

      let sep = "|";
      for (let c = 0; c < colCount; c++) {
        const w = colWidths[c];
        const a = alignments[c];
        if (a === "center") sep += ":" + "-".repeat(w) + ":|";
        else if (a === "right") sep += "-".repeat(w + 1) + ":|";
        else if (a === "left") sep += ":" + "-".repeat(w) + "-|";
        else sep += "-".repeat(w + 2) + "|";
      }
      state.write(sep);
      state.ensureNewLine();

      for (let r = 1; r < rowsToSerialize.length; r++) {
        state.write(renderRow(rowsToSerialize[r]));
        if (r < rowsToSerialize.length - 1) state.ensureNewLine();
      }
      state.closeBlock(node);
    },
    table_row() {
      // handled by table
    },
    table_header(state, node) {
      state.renderInline(node);
    },
    table_cell(state, node) {
      state.renderInline(node);
    },
    text(state, node) {
      state.text(node.text!, true);
    },
    bookmark(state, node) {
      state.write(sanitizeUrl(node.attrs.url as string) || "");
      state.closeBlock(node);
    },
    attachment(state, node) {
      const safeHref = sanitizeUrl(node.attrs.href as string) || "";
      const title = state.esc(String(node.attrs.title || ""), false);
      const size = Number(node.attrs.size || 0);
      state.ensureNewLine();
      state.write(`[${title} ${size}](${state.esc(safeHref, false)})`);
      state.closeBlock(node);
    },
  };

  const marks: Record<string, MarkSpec> = {
    em: { open: "*", close: "*", mixable: true, expelEnclosingWhitespace: true },
    strong: { open: "**", close: "**", mixable: true, expelEnclosingWhitespace: true },
    link: {
      open: "[",
      close: (state, mark) =>
        "](" +
        (sanitizeUrl(mark.attrs.href as string) || "").replace(/[()]/g, "\\$&").replace(/"/g, '\\"') +
        (mark.attrs.title ? ` "${String(mark.attrs.title).replace(/"/g, '\\"')}"` : "") +
        ")",
      mixable: true,
    },
    code: { open: "`", close: "`", escape: false },
    s: { open: "~~", close: "~~", mixable: true },
    highlight: {
      open: (_state, mark) => {
        const color = sanitizeHighlightColor(mark.attrs.color);
        return color ? `=={color:${colorToMarkdownValue(color)}}` : "==";
      },
      close: "==",
      mixable: true,
    },
    text_color: {
      open: (_state, mark) => {
        const color = sanitizeHighlightColor(mark.attrs.color) || "#111827";
        return `{{color:${colorToMarkdownValue(color)}|`;
      },
      close: "}}",
      mixable: true,
    },
    underline: { open: "__", close: "__", mixable: true, expelEnclosingWhitespace: true },
  };

  return new MarkdownSerializer(nodes, marks);
}
