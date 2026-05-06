import type MarkdownIt from "markdown-it";
import type { StateBlock, StateInline } from "markdown-it";

function isValidDelimiter(state: StateInline, pos: number) {
  const max = state.posMax;
  let canOpen = true;
  let canClose = true;
  const prevChar = pos > 0 ? state.src.charCodeAt(pos - 1) : -1;
  const nextChar = pos + 1 <= max ? state.src.charCodeAt(pos + 1) : -1;
  if (prevChar === 0x20 || prevChar === 0x09 || (nextChar >= 0x30 && nextChar <= 0x39)) {
    canClose = false;
  }
  if (nextChar === 0x20 || nextChar === 0x09) {
    canOpen = false;
  }
  return { canOpen, canClose };
}

function mathInline(state: StateInline, silent: boolean): boolean {
  if (state.src[state.pos] !== "$") return false;
  const res = isValidDelimiter(state, state.pos);
  if (!res.canOpen) {
    if (!silent) state.pending += "$";
    state.pos += 1;
    return true;
  }
  const start = state.pos + 1;
  let match = start;
  while ((match = state.src.indexOf("$", match)) !== -1) {
    let pos = match - 1;
    while (state.src[pos] === "\\") pos -= 1;
    if ((match - pos) % 2 === 1) break;
    match += 1;
  }
  if (match === -1) {
    if (!silent) state.pending += "$";
    state.pos = start;
    return true;
  }
  if (match - start === 0) {
    if (!silent) state.pending += "$$";
    state.pos = start + 1;
    return true;
  }
  if (!res.canClose) {
    if (!silent) state.pending += "$";
    state.pos = start;
    return true;
  }
  if (!silent) {
    const token = state.push("math_inline", "math", 0);
    token.markup = "$";
    token.content = state.src.slice(start, match);
  }
  state.pos = match + 1;
  return true;
}

function mathDisplay(state: StateBlock, start: number, end: number, silent: boolean) {
  let pos = state.bMarks[start] + state.tShift[start];
  const max = state.eMarks[start];
  if (pos + 2 > max) return false;
  if (state.src.slice(pos, pos + 2) !== "$$") return false;
  pos += 2;
  const firstLine = state.src.slice(pos, max);
  if (silent) return true;

  let found = false;
  let lastLine = "";
  if (firstLine.trim().slice(-2) === "$$") {
    found = true;
  }

  let next = start;
  if (!found) {
    for (next = start + 1; next < end; next++) {
      pos = state.bMarks[next] + state.tShift[next];
      const eMarks = state.eMarks[next];
      if (state.src.slice(pos, eMarks).trim().endsWith("$$")) {
        const lastPos = state.src.slice(0, eMarks).lastIndexOf("$$");
        lastLine = state.src.slice(pos, lastPos);
        found = true;
        break;
      }
    }
  }

  state.line = next + 1;
  const token = state.push("math_block", "math", 0);
  token.block = true;
  token.content =
    (firstLine && firstLine.trim() ? firstLine + "\n" : "") +
    state.getLines(start + 1, next, state.tShift[start], true) +
    (lastLine && lastLine.trim() ? lastLine : "");
  token.map = [start, state.line];
  token.markup = "$$";
  return true;
}

export function markdownMath(md: MarkdownIt) {
  md.inline.ruler.after("escape", "math_inline", mathInline);
  md.block.ruler.after("blockquote", "math_block", mathDisplay, {
    alt: ["paragraph", "reference", "blockquote", "list"],
  });
}
