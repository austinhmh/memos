import type MarkdownIt from "markdown-it";
import type { StateInline } from "markdown-it";

const TEXT_COLOR_OPEN_RE = /^\{\{(?:#([0-9a-fA-F]{6}):|color:([0-9a-fA-F]{6})\|)/;

function textColorRule(state: StateInline, silent: boolean): boolean {
  const start = state.pos;
  const match = TEXT_COLOR_OPEN_RE.exec(state.src.slice(start));
  if (!match) return false;

  const contentStart = start + match[0].length;
  const contentEnd = state.src.indexOf("}}", contentStart);
  if (contentEnd <= contentStart) return false;

  if (silent) return true;

  const openToken = state.push("text_color_open", "span", 1);
  openToken.markup = "{{";
  openToken.attrSet("data-color", `#${match[1] || match[2]}`);

  const children: StateInline["tokens"] = [];
  state.md.inline.parse(state.src.slice(contentStart, contentEnd), state.md, state.env, children);
  state.tokens.push(...children);

  const closeToken = state.push("text_color_close", "span", -1);
  closeToken.markup = "}}";

  state.pos = contentEnd + 2;
  return true;
}

export function markdownTextColor(md: MarkdownIt) {
  md.inline.ruler.before("emphasis", "text_color", textColorRule);
}
