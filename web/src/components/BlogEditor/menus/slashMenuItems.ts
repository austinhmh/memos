import { setBlockType, toggleMark as pmToggleMark } from "prosemirror-commands";
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

  // 链接
  if (schema.marks.link) {
    items.push({
      id: "link",
      label: "链接",
      icon: "🔗",
      keywords: "link url href",
      group: "基础",
      action: (view) => {
        const href = window.prompt("输入链接地址", "https://");
        if (!href) { view.focus(); return; }
        const { state, dispatch } = view;
        if (state.selection.empty) {
          const text = schema.text(href, [schema.marks.link.create({ href })]);
          dispatch(state.tr.replaceSelectionWith(text).scrollIntoView());
        } else {
          pmToggleMark(schema.marks.link, { href })(state, dispatch);
        }
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

  // 图片
  if (schema.nodes.image) {
    items.push({
      id: "image",
      label: "图片",
      icon: "🖼",
      keywords: "image picture photo upload",
      group: "常用",
      action: (view) => {
        const input = document.createElement("input");
        input.type = "file";
        input.accept = "image/*";
        input.onchange = () => {
          const file = input.files?.[0];
          if (!file) return;
          const reader = new FileReader();
          reader.onload = () => {
            const src = reader.result as string;
            const node = schema.nodes.image.create({ src, alt: file.name });
            const { state, dispatch } = view;
            dispatch(state.tr.replaceSelectionWith(node).scrollIntoView());
            view.focus();
          };
          reader.readAsDataURL(file);
        };
        input.click();
      },
    });
  }

  // 视频或文件（上传附件，插入为链接）
  items.push({
    id: "file",
    label: "视频或文件",
    icon: "📎",
    keywords: "video file upload attachment",
    group: "常用",
    action: (view) => {
      const input = document.createElement("input");
      input.type = "file";
      input.onchange = () => {
        const file = input.files?.[0];
        if (!file) return;
        const { state, dispatch } = view;
        const text = schema.text(`[${file.name}]`, []);
        dispatch(state.tr.replaceSelectionWith(text).scrollIntoView());
        view.focus();
      };
      input.click();
    },
  });

  // 高亮块
  if (schema.marks.highlight) {
    items.push({
      id: "highlight",
      label: "高亮块",
      icon: "🅰",
      keywords: "highlight mark color",
      group: "常用",
      action: run((view) => pmToggleMark(schema.marks.highlight)(view.state, view.dispatch)),
    });
  }

  return items;
}
