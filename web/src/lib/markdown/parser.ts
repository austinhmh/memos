import MarkdownIt from "markdown-it";
import markdownItContainer from "markdown-it-container";
import { full as emojiPlugin } from "markdown-it-emoji";
import { markdownMath } from "./rules/math";
import { markdownCheckboxes } from "./rules/checkboxes";
import { markdownTag } from "./rules/tag";
import { markdownHighlight } from "./rules/highlight";
import { markdownUnderlines } from "./rules/underlines";

let cachedParser: MarkdownIt | null = null;

export function createMarkdownParser(): MarkdownIt {
  if (cachedParser) return cachedParser;

  const md = new MarkdownIt("default", {
    html: false,
    breaks: false,
    linkify: true,
  });

  md.use(emojiPlugin);
  md.use(markdownMath);
  md.use(markdownCheckboxes);
  md.use(markdownTag);
  md.use(markdownHighlight);
  md.use(markdownUnderlines);

  md.use(markdownItContainer, "notice", {
    marker: ":",
    validate: () => true,
  });

  return (cachedParser = md);
}

export type { Token } from "markdown-it";
