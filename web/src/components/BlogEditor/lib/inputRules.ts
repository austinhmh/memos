import { ellipsis, InputRule, inputRules, smartQuotes, textblockTypeInputRule, wrappingInputRule } from "prosemirror-inputrules";
import type { Schema } from "prosemirror-model";
import type { Command, Plugin } from "prosemirror-state";
import { TextSelection } from "prosemirror-state";
import { listWrappingInputRule } from "@/outline-vendor/shared/editor/lib/listInputRule";
import { markInputRuleForPattern } from "@/outline-vendor/shared/editor/lib/markInputRule";

/**
 * Markdown 风格输入规则：在行首输入 #、>、-、*、1.、```、--- 等时，
 * 立即将当前块转换为标题、引用、列表、代码块、分割线，实现所见即所得（WYSIWYG）。
 */

const CODE_FENCE_RE = /^```(\w*)$/;

/**
 * Enter 键触发的代码块转换命令。
 * 当段落内容为 ```lang 时，将其转换为代码块（无需额外空格）。
 */
export function codeBlockOnEnter(schema: Schema): Command {
  const type = schema.nodes.code_block;
  if (!type) return () => false;

  return (state, dispatch) => {
    const { $from } = state.selection;
    if (!$from.parent.isTextblock || $from.parent.type !== schema.nodes.paragraph) return false;

    const text = $from.parent.textContent;
    const match = text.match(CODE_FENCE_RE);
    if (!match) return false;

    const $pos = state.doc.resolve($from.before());
    if (!$pos.node().canReplaceWith($pos.index(), $pos.indexAfter(), type)) return false;

    if (dispatch) {
      const start = $from.before();
      const end = $from.after();
      const tr = state.tr.delete(start, end).insert(start, type.createAndFill({ language: (match[1] || "").trim() })!);
      tr.setSelection(TextSelection.near(tr.doc.resolve(start + 1)));
      dispatch(tr);
    }
    return true;
  };
}

function blockQuoteRule(schema: Schema): InputRule | null {
  const type = schema.nodes.blockquote;
  if (!type) return null;
  return wrappingInputRule(/^\s*>\s$/, type);
}

function orderedListRule(schema: Schema): InputRule | null {
  const type = schema.nodes.ordered_list;
  if (!type) return null;
  return wrappingInputRule(
    /^(\d+)\.\s$/,
    type,
    (match) => ({ order: Number.parseInt(match[1], 10) }),
    (match, node) => node.childCount + node.attrs.order === Number.parseInt(match[1], 10),
  );
}

function bulletListRule(schema: Schema): InputRule | null {
  const type = schema.nodes.bullet_list;
  if (!type) return null;
  return wrappingInputRule(/^\s*[-*]\s$/, type);
}

function checkboxListRule(schema: Schema): InputRule | null {
  const type = schema.nodes.checkbox_list;
  if (!type) return null;
  return listWrappingInputRule(/^-?\s*(\[\s?\])\s$/i, type);
}

function codeBlockRule(schema: Schema): InputRule | null {
  const type = schema.nodes.code_block;
  if (!type) return null;
  // ``` 或 ```lang 开头创建代码块
  return textblockTypeInputRule(/^```(\w*)\s$/, type, (match) => ({
    language: (match[1] || "").trim(),
  }));
}

function headingRule(schema: Schema, maxLevel: number): InputRule | null {
  const type = schema.nodes.heading;
  if (!type) return null;
  return textblockTypeInputRule(new RegExp(`^(#{1,${maxLevel}})\\s$`), type, (match) => ({ level: match[1].length }));
}

function horizontalRuleRule(schema: Schema): InputRule | null {
  const type = schema.nodes.horizontal_rule;
  if (!type) return null;
  return new InputRule(/^(?:---|___|\*\*\*)\s$/, (state, _match, start, end) => {
    const $start = state.doc.resolve(start);
    const from = $start.before();
    const toAfterDelete = $start.after() - (end - start);
    return state.tr.delete(start, end).replaceWith(from, toAfterDelete, type.create());
  });
}

/**
 * 构建所见即所得所需的全部输入规则，并返回 inputRules 插件。
 */
export function buildMarkdownInputRules(schema: Schema): Plugin {
  const emdash = new InputRule(/(?:^|[^|-])(--\s)$/, "— ");

  const rules: InputRule[] = [];

  const hr = horizontalRuleRule(schema);
  if (hr) rules.push(hr);

  rules.push(...smartQuotes, ellipsis, emdash);

  const strong = schema.marks.strong;
  if (strong) rules.push(markInputRuleForPattern("**", strong));

  const em = schema.marks.em;
  if (em) {
    rules.push(markInputRuleForPattern("*", em));
    rules.push(markInputRuleForPattern("_", em));
  }

  const underline = schema.marks.underline;
  if (underline) rules.push(markInputRuleForPattern("__", underline));

  const highlight = schema.marks.highlight;
  if (highlight) rules.push(markInputRuleForPattern("==", highlight));

  const codeMark = schema.marks.code;
  if (codeMark) rules.push(markInputRuleForPattern("`", codeMark));

  const strike = schema.marks.s;
  if (strike) rules.push(markInputRuleForPattern("~", strike));

  const bq = blockQuoteRule(schema);
  if (bq) rules.push(bq);

  const ol = orderedListRule(schema);
  if (ol) rules.push(ol);

  const ul = bulletListRule(schema);
  if (ul) rules.push(ul);

  const checkbox = checkboxListRule(schema);
  if (checkbox) rules.push(checkbox);

  const codeBlock = codeBlockRule(schema);
  if (codeBlock) rules.push(codeBlock);

  const heading = headingRule(schema, 6);
  if (heading) rules.push(heading);

  return inputRules({ rules });
}
