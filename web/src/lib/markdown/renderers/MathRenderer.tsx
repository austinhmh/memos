import katex from "katex";
import { useMemo } from "react";

interface MathRendererProps {
  content: string;
  displayMode: boolean;
}

export const MathRenderer: React.FC<MathRendererProps> = ({ content, displayMode }) => {
  const html = useMemo(() => {
    try {
      return katex.renderToString(content.trim(), {
        displayMode,
        throwOnError: false,
        trust: true,
      });
    } catch {
      return content;
    }
  }, [content, displayMode]);

  if (displayMode) {
    return <div className="math-block my-4 overflow-x-auto" dangerouslySetInnerHTML={{ __html: html }} />;
  }
  return <span className="math-inline" dangerouslySetInnerHTML={{ __html: html }} />;
};
