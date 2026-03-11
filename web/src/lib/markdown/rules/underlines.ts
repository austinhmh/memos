import type MarkdownIt from "markdown-it";

export function markdownUnderlines(md: MarkdownIt) {
  md.inline.ruler2.after("emphasis", "underline", (state) => {
    const tokens = state.tokens;
    for (let i = tokens.length - 1; i > 0; i--) {
      const token = tokens[i];
      if (token.markup === "__") {
        if (token.type === "strong_open") {
          tokens[i].tag = "u";
          tokens[i].type = "underline_open";
        }
        if (token.type === "strong_close") {
          tokens[i].tag = "u";
          tokens[i].type = "underline_close";
        }
      }
    }
    return false;
  });
}
