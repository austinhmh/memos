import type { StateInline } from "markdown-it";
import type MarkdownIt from "markdown-it";

function tokenize(state: StateInline, _silent: boolean): boolean {
  const start = state.pos;
  const marker = state.src.charCodeAt(start);
  if (marker !== 0x3d /* = */) return false;
  if (state.src.charCodeAt(start + 1) !== 0x3d) return false;

  const scanned = state.scanDelims(state.pos, true);
  let len = scanned.length;
  if (len < 2) return false;

  if (len % 2) {
    const token = state.push("text", "", 0);
    token.content = "=";
    len--;
  }

  for (let i = 0; i < len; i += 2) {
    const token = state.push("text", "", 0);
    token.content = "==";
    if (!scanned.can_open && !scanned.can_close) continue;
    state.delimiters.push({
      marker,
      length: 0,
      jump: i,
      token: state.tokens.length - 1,
      end: -1,
      open: scanned.can_open,
      close: scanned.can_close,
    } as any);
  }

  state.pos += scanned.length;
  return true;
}

function postProcess(state: StateInline, delimiters: StateInline.Delimiter[]) {
  const loneMarkers: number[] = [];
  const max = delimiters.length;
  for (let i = 0; i < max; i++) {
    const startDelim = delimiters[i];
    if (startDelim.marker !== 0x3d) continue;
    if (startDelim.end === -1) continue;
    const endDelim = delimiters[startDelim.end];

    const openToken = state.tokens[startDelim.token];
    openToken.type = "highlight_open";
    openToken.tag = "mark";
    openToken.nesting = 1;
    openToken.markup = "==";
    openToken.content = "";

    const closeToken = state.tokens[endDelim.token];
    closeToken.type = "highlight_close";
    closeToken.tag = "mark";
    closeToken.nesting = -1;
    closeToken.markup = "==";
    closeToken.content = "";

    if (state.tokens[endDelim.token - 1].type === "text" && state.tokens[endDelim.token - 1].content === "=") {
      loneMarkers.push(endDelim.token - 1);
    }
  }

  while (loneMarkers.length) {
    const i = loneMarkers.pop()!;
    let j = i + 1;
    while (j < state.tokens.length && state.tokens[j].type === "highlight_close") j++;
    j--;
    if (i !== j) {
      const token = state.tokens[j];
      state.tokens[j] = state.tokens[i];
      state.tokens[i] = token;
    }
  }
}

export function markdownHighlight(md: MarkdownIt) {
  md.inline.ruler.before("emphasis", "highlight", tokenize);
  md.inline.ruler2.before("emphasis", "highlight", (state) => {
    postProcess(state, state.delimiters);
    const tokensMeta = state.tokens_meta || [];
    for (let curr = 0; curr < tokensMeta.length; curr++) {
      const delimiters = tokensMeta[curr]?.delimiters;
      if (delimiters) postProcess(state, delimiters);
    }
    return false;
  });
}
