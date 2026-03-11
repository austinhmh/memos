import type { StateInline } from "markdown-it";
import type MarkdownIt from "markdown-it";

const MAX_TAG_LENGTH = 100;

function isTagChar(code: number): boolean {
  if (code >= 0x41 && code <= 0x5a) return true; // A-Z
  if (code >= 0x61 && code <= 0x7a) return true; // a-z
  if (code >= 0x30 && code <= 0x39) return true; // 0-9
  if (code === 0x5f || code === 0x2d || code === 0x2f) return true; // _ - /
  if (code > 0x7f) return true; // unicode letters/symbols
  return false;
}

function tagRule(state: StateInline, silent: boolean): boolean {
  const pos = state.pos;
  const ch = state.src.charCodeAt(pos);
  if (ch !== 0x23) return false; // #

  if (pos > 0) {
    const prev = state.src.charCodeAt(pos - 1);
    if (prev === 0x23) return false; // preceded by #
  }

  const nextPos = pos + 1;
  if (nextPos >= state.posMax) return false;
  const nextCh = state.src.charCodeAt(nextPos);
  if (!isTagChar(nextCh) || nextCh === 0x23) return false;
  if (nextCh === 0x20 || nextCh === 0x09) return false;

  let end = nextPos;
  while (end < state.posMax && isTagChar(state.src.charCodeAt(end))) {
    end++;
  }

  const tagContent = state.src.slice(nextPos, end);
  if (tagContent.length === 0 || tagContent.length > MAX_TAG_LENGTH) return false;

  if (!silent) {
    const token = state.push("tag", "span", 0);
    token.content = tagContent;
    token.markup = "#";
    token.attrSet("class", "tag");
    token.attrSet("data-tag", tagContent);
  }

  state.pos = end;
  return true;
}

export function markdownTag(md: MarkdownIt) {
  md.inline.ruler.before("emphasis", "tag", tagRule);
}
