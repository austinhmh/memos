import React from "react";
import { setBlockType, toggleMark as pmToggleMark } from "prosemirror-commands";
import type { EditorView } from "prosemirror-view";
import type { Schema } from "prosemirror-model";
import {
  TypeIcon,
  Heading1Icon,
  Heading2Icon,
  Heading3Icon,
  Heading4Icon,
  Heading5Icon,
  ListOrderedIcon,
  ListIcon,
  CodeIcon,
  QuoteIcon,
  MinusIcon,
  LinkIcon,
  CheckSquareIcon,
  ImageIcon,
  PaperclipIcon,
  TableIcon,
  DiamondIcon,
  HighlighterIcon,
  BoldIcon,
  ItalicIcon,
  StrikethroughIcon,
  CodeXmlIcon,
  UnderlineIcon,
} from "lucide-react";
import toggleBlockType from "@/outline-vendor/shared/editor/commands/toggleBlockType";
import toggleList from "@/outline-vendor/shared/editor/commands/toggleList";
import toggleWrap from "@/outline-vendor/shared/editor/commands/toggleWrap";
import type { SlashMenuItem } from "../plugins/SlashMenuPlugin";

const I = 18;

const ic = (Icon: React.FC<{ size?: number }>, color: string, bg: string): { icon: React.ReactNode; iconColor: string; iconBg: string } => ({
  icon: React.createElement(Icon, { size: I }),
  iconColor: color,
  iconBg: bg,
});

const blue   = ic.bind(null, Heading1Icon, "#3b82f6", "rgba(59,130,246,0.1)");
const colors = {
  text:       { iconColor: "#6b7280", iconBg: "rgba(107,114,128,0.1)" },
  h1:        { iconColor: "#3b82f6", iconBg: "rgba(59,130,246,0.1)" },
  h2:        { iconColor: "#6366f1", iconBg: "rgba(99,102,241,0.1)" },
  h3:        { iconColor: "#8b5cf6", iconBg: "rgba(139,92,246,0.1)" },
  h4:        { iconColor: "#a855f7", iconBg: "rgba(168,85,247,0.1)" },
  h5:        { iconColor: "#c084fc", iconBg: "rgba(192,132,252,0.1)" },
  list:      { iconColor: "#f59e0b", iconBg: "rgba(245,158,11,0.1)" },
  code:      { iconColor: "#ef4444", iconBg: "rgba(239,68,68,0.1)" },
  quote:     { iconColor: "#64748b", iconBg: "rgba(100,116,139,0.1)" },
  divider:   { iconColor: "#94a3b8", iconBg: "rgba(148,163,184,0.1)" },
  link:      { iconColor: "#06b6d4", iconBg: "rgba(6,182,212,0.1)" },
  todo:      { iconColor: "#22c55e", iconBg: "rgba(34,197,94,0.1)" },
  image:     { iconColor: "#f97316", iconBg: "rgba(249,115,22,0.1)" },
  file:      { iconColor: "#8b5cf6", iconBg: "rgba(139,92,246,0.1)" },
  table:     { iconColor: "#14b8a6", iconBg: "rgba(20,184,166,0.1)" },
  mermaid:   { iconColor: "#ec4899", iconBg: "rgba(236,72,153,0.1)" },
  highlight: { iconColor: "#eab308", iconBg: "rgba(234,179,8,0.1)" },
  bold:      { iconColor: "#1e293b", iconBg: "rgba(30,41,59,0.1)" },
  italic:    { iconColor: "#475569", iconBg: "rgba(71,85,105,0.1)" },
  strike:    { iconColor: "#64748b", iconBg: "rgba(100,116,139,0.1)" },
  inlineCode:{ iconColor: "#ef4444", iconBg: "rgba(239,68,68,0.1)" },
  underline: { iconColor: "#3b82f6", iconBg: "rgba(59,130,246,0.1)" },
};

const headingIcons = [Heading1Icon, Heading2Icon, Heading3Icon, Heading4Icon, Heading5Icon];
const headingColors = [colors.h1, colors.h2, colors.h3, colors.h4, colors.h5];

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
    subtitle: "Text",
    icon: React.createElement(TypeIcon, { size: I }),
    ...colors.text,
    keywords: "text paragraph plain p wenben wb 正文 zhengwen zw",
    group: "基础",
    action: run((view) => setBlockType(schema.nodes.paragraph)(view.state, view.dispatch)),
  });

  for (let level = 1; level <= 5; level++) {
    items.push({
      id: `heading${level}`,
      label: `${level}级标题`,
      subtitle: `Heading ${level}`,
      icon: React.createElement(headingIcons[level - 1], { size: I }),
      ...headingColors[level - 1],
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
      icon: React.createElement(ListOrderedIcon, { size: I }),
      ...colors.list,
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
      icon: React.createElement(ListIcon, { size: I }),
      ...colors.list,
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
      icon: React.createElement(CodeIcon, { size: I }),
      ...colors.code,
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
      icon: React.createElement(QuoteIcon, { size: I }),
      ...colors.quote,
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
      icon: React.createElement(MinusIcon, { size: I }),
      ...colors.divider,
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
      icon: React.createElement(LinkIcon, { size: I }),
      ...colors.link,
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

  if (schema.nodes.checkbox_list) {
    items.push({
      id: "checkbox_list",
      label: "任务",
      subtitle: "To-do List",
      icon: React.createElement(CheckSquareIcon, { size: I }),
      ...colors.todo,
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
      icon: React.createElement(ImageIcon, { size: I }),
      ...colors.image,
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
    icon: React.createElement(PaperclipIcon, { size: I }),
    ...colors.file,
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
      icon: React.createElement(TableIcon, { size: I }),
      ...colors.table,
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
      icon: React.createElement(DiamondIcon, { size: I }),
      ...colors.mermaid,
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
      icon: React.createElement(HighlighterIcon, { size: I }),
      ...colors.highlight,
      keywords: "highlight mark color callout notice 高亮 gaoliang gl 标记 biaoji bj 荧光 yingguang",
      group: "常用",
      action: run((view) => pmToggleMark(schema.marks.highlight)(view.state, view.dispatch)),
    });
  }

  if (schema.marks.strong) {
    items.push({
      id: "bold",
      label: "加粗",
      subtitle: "Bold",
      icon: React.createElement(BoldIcon, { size: I }),
      ...colors.bold,
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
      icon: React.createElement(ItalicIcon, { size: I }),
      ...colors.italic,
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
      icon: React.createElement(StrikethroughIcon, { size: I }),
      ...colors.strike,
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
      icon: React.createElement(CodeXmlIcon, { size: I }),
      ...colors.inlineCode,
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
      icon: React.createElement(UnderlineIcon, { size: I }),
      ...colors.underline,
      keywords: "underline 下划线 xiahuaxian xhx",
      group: "格式",
      action: run((view) => pmToggleMark(schema.marks.underline)(view.state, view.dispatch)),
    });
  }

  return items;
}
