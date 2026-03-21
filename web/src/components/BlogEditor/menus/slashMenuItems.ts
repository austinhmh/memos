import { setBlockType } from "prosemirror-commands";
import type { EditorView } from "prosemirror-view";
import type { Schema } from "prosemirror-model";
import toggleBlockType from "@/outline-vendor/shared/editor/commands/toggleBlockType";
import toggleList from "@/outline-vendor/shared/editor/commands/toggleList";
import toggleWrap from "@/outline-vendor/shared/editor/commands/toggleWrap";
import type { SlashMenuItem } from "../plugins/SlashMenuPlugin";

export function buildSlashMenuItems(schema: Schema): SlashMenuItem[] {
  const items: SlashMenuItem[] = [];

  const run = (fn: (view: EditorView) => boolean): ((view: EditorView) => void) => {
    return (view) => {
      fn(view);
      view.focus();
    };
  };

  items.push({
    id: "paragraph",
    label: "文本",
    icon: "T",
    keywords: "text paragraph plain",
    group: "基础",
    action: run((view) => setBlockType(schema.nodes.paragraph)(view.state, view.dispatch)),
  });

  for (let level = 1; level <= 5; level++) {
    items.push({
      id: `heading${level}`,
      label: `${level}级标题`,
      icon: `H${level}`,
      keywords: `h${level} heading${level} title`,
      group: "基础",
      action: run((view) =>
        toggleBlockType(schema.nodes.heading, schema.nodes.paragraph, { level })(view.state, view.dispatch)
      ),
    });
  }

  if (schema.nodes.ordered_list) {
    items.push({
      id: "ordered_list",
      label: "有序列表",
      icon: "≡",
      keywords: "ordered list numbered",
      group: "基础",
      action: run((view) =>
        toggleList(schema.nodes.ordered_list, schema.nodes.list_item)(view.state, view.dispatch)
      ),
    });
  }

  if (schema.nodes.bullet_list) {
    items.push({
      id: "bullet_list",
      label: "无序列表",
      icon: "≡",
      keywords: "unordered list bullet",
      group: "基础",
      action: run((view) =>
        toggleList(schema.nodes.bullet_list, schema.nodes.list_item)(view.state, view.dispatch)
      ),
    });
  }

  if (schema.nodes.code_block) {
    items.push({
      id: "code_block",
      label: "代码块",
      icon: "{}",
      keywords: "code block script fence",
      group: "基础",
      action: run((view) =>
        toggleBlockType(schema.nodes.code_block, schema.nodes.paragraph, { language: "" })(view.state, view.dispatch)
      ),
    });
  }

  if (schema.nodes.blockquote) {
    items.push({
      id: "blockquote",
      label: "引用",
      icon: "❝",
      keywords: "quote blockquote",
      group: "基础",
      action: run((view) => toggleWrap(schema.nodes.blockquote)(view.state, view.dispatch)),
    });
  }

  if (schema.nodes.horizontal_rule) {
    items.push({
      id: "horizontal_rule",
      label: "分隔线",
      icon: "─",
      keywords: "horizontal rule divider hr",
      group: "基础",
      action: (view) => {
        const { state, dispatch } = view;
        dispatch(state.tr.replaceSelectionWith(schema.nodes.horizontal_rule.create()).scrollIntoView());
        view.focus();
      },
    });
  }

  if (schema.nodes.checkbox_list) {
    items.push({
      id: "checkbox_list",
      label: "任务列表",
      icon: "☑",
      keywords: "task todo checkbox checklist",
      group: "常用",
      action: run((view) =>
        toggleList(schema.nodes.checkbox_list, schema.nodes.checkbox_item)(view.state, view.dispatch)
      ),
    });
  }

  if (schema.nodes.table) {
    items.push({
      id: "table",
      label: "表格",
      icon: "▦",
      keywords: "table grid",
      group: "常用",
      action: (view) => {
        const { state, dispatch } = view;
        const cell = schema.nodes.table_cell.createAndFill()!;
        const headerCell = schema.nodes.table_header.createAndFill()!;
        const headerRow = schema.nodes.table_row.create(null, [headerCell, headerCell.copy(headerCell.content), headerCell.copy(headerCell.content)]);
        const row = schema.nodes.table_row.create(null, [cell, cell.copy(cell.content), cell.copy(cell.content)]);
        const table = schema.nodes.table.create(null, [headerRow, row, row.copy(row.content)]);
        dispatch(state.tr.replaceSelectionWith(table).scrollIntoView());
        view.focus();
      },
    });
  }

  if (schema.nodes.code_block) {
    items.push({
      id: "mermaid",
      label: "Mermaid 图表",
      icon: "◇",
      keywords: "mermaid diagram flowchart",
      group: "常用",
      action: run((view) =>
        toggleBlockType(schema.nodes.code_block, schema.nodes.paragraph, { language: "mermaid" })(view.state, view.dispatch)
      ),
    });
  }

  return items;
}
