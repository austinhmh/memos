import { Plugin, PluginKey } from "prosemirror-state";

/**
 * Placeholder for code block syntax highlighting.
 * Schema already renders code_block as .code-block with data-language;
 * CSS can target .code-block pre code. Optional: integrate highlight.js later.
 */
export function createCodeHighlightPlugin(): Plugin {
  return new Plugin({
    key: new PluginKey("codeHighlight"),
  });
}
