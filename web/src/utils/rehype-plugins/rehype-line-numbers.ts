import type { Element, Root } from "hast";
import { visit } from "unist-util-visit";

/**
 * Rehype plugin to transfer source line numbers from AST data to HTML data attributes
 * This enables intelligent scroll synchronization by mapping editor lines to preview elements
 */
export const rehypeLineNumbers = () => {
  return (tree: Root) => {
    visit(tree, "element", (node: Element) => {
      // Transfer sourceLine from data to HTML data attribute
      if (node.data && (node.data as any).sourceLine) {
        if (!node.properties) {
          node.properties = {};
        }
        node.properties["data-source-line"] = (node.data as any).sourceLine;
      }
    });
  };
};
