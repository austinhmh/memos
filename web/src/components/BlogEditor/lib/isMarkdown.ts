/**
 * Heuristic to detect whether a piece of text looks like Markdown.
 * Scores signals (code fences, headings, lists, links, tables, LaTeX)
 * and returns true when the signal count exceeds a confidence threshold.
 *
 * Ported from outline-source/shared/editor/lib/isMarkdown.ts
 */
export default function isMarkdown(text: string): boolean {
  let signals = 0;
  const lines = text.split("\n").length;
  const minConfidence = Math.min(3, Math.floor(lines / 5));

  const fences = text.match(/^```/gm);
  if (fences && fences.length > 1) {
    signals += fences.length;
  }

  const latex = text.match(/\$(.+)\$/g);
  if (latex && latex.length > 0) {
    signals += latex.length;
  }

  const links = text.match(/\[[\s\S]+\]\(https?:\/\/\S+\)/gm);
  if (links) {
    signals += links.length * 2;
  }

  const relativeLinks = text.match(/\[[\s\S]+\]\(\/\S+\)/gm);
  if (relativeLinks) {
    signals += relativeLinks.length * 2;
  }

  const headings = text.match(/^#{1,6}\s+\S+/gm);
  if (headings) {
    signals += headings.length;
  }

  const listItems = text.match(/^[-*]\s\S+/gm);
  if (listItems) {
    signals += listItems.length;
  }

  const tables = text.match(/\|\s?[:-]+\s?\|/gm);
  if (tables) {
    signals += tables.length;
  }

  return signals > minConfidence;
}
