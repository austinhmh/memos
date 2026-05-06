import type MarkdownIt from "markdown-it";
import type { Token } from "markdown-it";

const CHECKBOX_REGEX = /\[(X|\s|_|-)\]\s(.*)?/i;

function matches(token: Token | void) {
  return token && token.content.match(CHECKBOX_REGEX);
}

function isInline(token: Token | void): boolean {
  return !!token && token.type === "inline";
}

function isParagraph(token: Token | void): boolean {
  return !!token && token.type === "paragraph_open";
}

function isListItem(token: Token | void): boolean {
  return !!token && token.type === "list_item_open";
}

function looksLikeChecklist(tokens: Token[], index: number) {
  return isInline(tokens[index]) && isListItem(tokens[index - 2]) && isParagraph(tokens[index - 1]) && matches(tokens[index]);
}

export function markdownCheckboxes(md: MarkdownIt): void {
  md.core.ruler.after("inline", "checkboxes", (state) => {
    const tokens = state.tokens;
    for (let i = tokens.length - 1; i > 0; i--) {
      const matchesChecklist = looksLikeChecklist(tokens, i);
      if (matchesChecklist) {
        const value = matchesChecklist[1];
        const checked = value.toLowerCase() === "x";

        if (tokens[i - 3].type === "bullet_list_open") {
          tokens[i - 3].type = "checkbox_list_open";
        }
        if (tokens[i + 3]?.type === "bullet_list_close") {
          tokens[i + 3].type = "checkbox_list_close";
        }

        const tokenChildren = tokens[i].children;
        if (tokenChildren && tokenChildren[0].type === "text") {
          const contentMatches = tokenChildren[0].content.match(CHECKBOX_REGEX);
          if (contentMatches) {
            tokens[i].content = contentMatches[2] || "";
            tokenChildren[0].content = contentMatches[2] || "";
          }
        }

        tokens[i - 2].type = "checkbox_item_open";
        if (checked) {
          tokens[i - 2].attrs = [["checked", "true"]];
        }

        let j = i;
        while (tokens[j] && tokens[j].type !== "list_item_close" && tokens[j].type !== "checkbox_item_close") {
          j++;
        }
        if (tokens[j]) {
          tokens[j].type = "checkbox_item_close";
        }
      }
    }
    return false;
  });
}
