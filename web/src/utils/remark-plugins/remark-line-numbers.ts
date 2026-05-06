import type { Root } from "mdast";
import { visit } from "unist-util-visit";

type NodeWithLineData = {
  position?: {
    start?: {
      line?: number;
    };
  };
  data?: {
    sourceLine?: number;
  };
};

/**
 * Remark plugin to add source line number information to AST nodes
 * This enables intelligent scroll synchronization between editor and preview
 */
export const remarkLineNumbers = () => {
  return (tree: Root) => {
    visit(tree, (node: NodeWithLineData) => {
      // Add line number information from position data
      if (node.position?.start?.line) {
        if (!node.data) {
          node.data = {};
        }
        // Store the starting line number
        node.data.sourceLine = node.position.start.line;
      }
    });
  };
};
