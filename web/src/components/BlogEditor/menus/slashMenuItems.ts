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

  // ===== 基础 =====

  items.push({
    id: "paragraph",
    label: "文本",
    subtitle: "Text",
    icon: "T",
    iconColor: "#8b8fa3",
    keywords: "text paragraph plain p wenben wb 正文 zhengwen zw",
    group: "基础",
    action: run((view) => setBlockType(schema.nodes.paragraph)(view.state, view.dispatch)),
  });

  const headingColors = ["#3b82f6", "#6366f1", "#8b5cf6", "#a855f7", "#c084fc"];
  for (let level = 1; level <= 5; level++) {
    items.push({
      id: `heading${level}`,
      label: `${level}级标题`,
      subtitle: `Heading ${level}`,
      icon: `H${level}`,
      iconColor: headingColors[level - 1],
      keywords: `h${level} heading heading${level} title 标题 biaoti bt ${level}ji`,
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
      subtitle: "Numbered List",
      icon: "≡",
      iconColor: "#f59e0b",
      keywords: "ol ordered list numbered num 123 有序 youxu liebiao lb shuzi",
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
      subtitle: "Bulleted List",
      icon: "≡",
      iconColor: "#f59e0b",
      keywords: "ul unordered list bullet 无序 wuxu liebiao lb dot",
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
      subtitle: "Code Block",
      icon: "{}",
      iconColor: "#ef4444",
      keywords: "code codeblock block script fence pre 代码 daima dm daimakuai 程序 chengxu cx",
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
      subtitle: "Quote",
      icon: "❝",
      iconColor: "#64748b",
      keywords: "quote blockquote bq pullquote 引用 yinyong yy 摘录 zhailu",
      group: "基础",
      action: run((view) => toggleWrap(schema.nodes.blockquote)(view.state, view.dispatch)),
    });
  }

  if (schema.nodes.horizontal_rule) {
    items.push({
      id: "horizontal_rule",
      label: "分隔线",
      subtitle: "Divider",
      icon: "─",
      iconColor: "#94a3b8",
      keywords: "hr horizontal rule divider line separator --- 分隔 fenge fg fengehxian 横线 hengxian",
      group: "基础",
      action: (view) => {
        const { state, dispatch } = view;
        dispatch(state.tr.replaceSelectionWith(schema.nodes.horizontal_rule.create()).scrollIntoView());
        view.focus();
      },
    });
  }

  if (schema.marks.link) {
    items.push({
      id: "link",
      label: "链接",
      subtitle: "Link",
      icon: "🔗",
      iconColor: "#06b6d4",
      keywords: "link url href anchor a 链接 lianjie lj 网址 wangzhi wz hyperlink",
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

  // ===== 常用 =====

  if (schema.nodes.checkbox_list) {
    items.push({
      id: "checkbox_list",
      label: "任务",
      subtitle: "To-do List",
      icon: "☑",
      iconColor: "#22c55e",
      keywords: "todo task checkbox checklist check 任务 renwu rw 待办 daiban db 清单 qingdan qd",
      group: "常用",
      action: run((view) =>
        toggleList(schema.nodes.checkbox_list, schema.nodes.checkbox_item)(view.state, view.dispatch)
      ),
    });
  }

  if (schema.nodes.image) {
    items.push({
      id: "image",
      label: "图片",
      subtitle: "Image",
      icon: "🖼",
      iconColor: "#f97316",
      keywords: "image img picture photo pic upload 图片 tupian tp 图像 tuxiang tx 照片 zhaopian zp 插图 chatu",
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

  items.push({
    id: "file",
    label: "视频或文件",
    subtitle: "Video / File",
    icon: "📎",
    iconColor: "#8b5cf6",
    keywords: "video file upload attachment attach mov mp4 avi pdf doc 视频 shipin sp 文件 wenjian wj 附件 fujian fj",
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

  if (schema.nodes.table) {
    items.push({
      id: "table",
      label: "表格",
      subtitle: "Table",
      icon: "▦",
      iconColor: "#14b8a6",
      keywords: "table grid spreadsheet 表格 biaoge bg 表 biao 网格 wangge",
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
      subtitle: "Mermaid Diagram",
      icon: "◇",
      iconColor: "#ec4899",
      keywords: "mermaid diagram flowchart chart graph 图表 tubiao tb 流程图 liuchengtu lct 时序图 shixutu",
      group: "常用",
      action: run((view) =>
        toggleBlockType(schema.nodes.code_block, schema.nodes.paragraph, { language: "mermaid" })(view.state, view.dispatch)
      ),
    });
  }

  if (schema.marks.highlight) {
    items.push({
      id: "highlight",
      label: "高亮",
      subtitle: "Highlight",
      icon: "🅰",
      iconColor: "#eab308",
      keywords: "highlight mark color callout notice 高亮 gaoliang gl 标记 biaoji bj 荧光 yingguang",
      group: "常用",
      action: run((view) => pmToggleMark(schema.marks.highlight)(view.state, view.dispatch)),
    });
  }

  // ===== 格式 =====

  if (schema.marks.strong) {
    items.push({
      id: "bold",
      label: "加粗",
      subtitle: "Bold",
      icon: "B",
      iconColor: "#1e293b",
      keywords: "bold strong 加粗 jiacu jc 粗体 cuti ct",
      group: "格式",
      action: run((view) => pmToggleMark(schema.marks.strong)(view.state, view.dispatch)),
    });
  }

  if (schema.marks.em) {
    items.push({
      id: "italic",
      label: "斜体",
      subtitle: "Italic",
      icon: "I",
      iconColor: "#475569",
      keywords: "italic em emphasis 斜体 xieti xt 倾斜 qingxie",
      group: "格式",
      action: run((view) => pmToggleMark(schema.marks.em)(view.state, view.dispatch)),
    });
  }

  if (schema.marks.s) {
    items.push({
      id: "strikethrough",
      label: "删除线",
      subtitle: "Strikethrough",
      icon: "S",
      iconColor: "#64748b",
      keywords: "strikethrough strike del 删除线 shanchuxian scx 划掉 huadiao",
      group: "格式",
      action: run((view) => pmToggleMark(schema.marks.s)(view.state, view.dispatch)),
    });
  }

  if (schema.marks.code) {
    items.push({
      id: "inline_code",
      label: "行内代码",
      subtitle: "Inline Code",
      icon: "`",
      iconColor: "#ef4444",
      keywords: "inline code mono 行内代码 hangneidaima hndm 代码 daima",
      group: "格式",
      action: run((view) => pmToggleMark(schema.marks.code)(view.state, view.dispatch)),
    });
  }

  if (schema.marks.underline) {
    items.push({
      id: "underline",
      label: "下划线",
      subtitle: "Underline",
      icon: "U",
      iconColor: "#3b82f6",
      keywords: "underline 下划线 xiahuaxian xhx",
      group: "格式",
      action: run((view) => pmToggleMark(schema.marks.underline)(view.state, view.dispatch)),
    });
  }

  return items;
}
