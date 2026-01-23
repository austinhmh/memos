import type { Root } from "mdast";
import type { Node } from "unist";
import { visit } from "unist-util-visit";

/**
 * Remark plugin to add source line number information to AST nodes
 * This enables intelligent scroll synchronization between editor and preview
 */
export const remarkLineNumbers = () => {
  return (tree: Root) => {
    visit(tree, (node: Node) => {
      // Add line number information from position data
      if (node.position?.start?.line) {
        if (!node.data) {
          node.data = {};
        }
        // Store the starting line number
        (node.data as any).sourceLine = node.position.start.line;
      }
    });
  };
};
