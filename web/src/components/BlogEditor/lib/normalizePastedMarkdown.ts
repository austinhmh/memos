/**
 * Pre-process pasted markdown text before parsing.
 *
 * - Wraps bare checkboxes (e.g. `[X] item`) in list markers (`- [X] item`)
 * - Collapses triple+ newlines with a hard break so whitespace is preserved
 *
 * Ported from outline-source/shared/editor/lib/markdown/normalize.ts
 */
export default function normalizePastedMarkdown(text: string): string {
  const CHECKBOX_REGEX = /^\s?(\[(X|\s|_|-)\]\s(.*)?)/gim;

  while (text.match(CHECKBOX_REGEX)) {
    text = text.replace(CHECKBOX_REGEX, (match) => `- ${match.trim()}`);
  }

  text = text.replace(/\n{3,}/g, "\n\n\\\n");

  return text;
}
