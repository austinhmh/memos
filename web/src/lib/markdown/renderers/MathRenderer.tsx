import katex from "katex";
import { useMemo } from "react";
import { getRenderFallbackText, getRenderLimitMessage, MATH_RENDER_LIMIT } from "@/lib/markdown/renderLimits";

interface MathRendererProps {
  content: string;
  displayMode: boolean;
}

export const MathRenderer: React.FC<MathRendererProps> = ({ content, displayMode }) => {
  const limitMessage = getRenderLimitMessage(content, MATH_RENDER_LIMIT);
  const html = useMemo(() => {
    if (limitMessage) {
      return "";
    }

    try {
      return katex.renderToString(content.trim(), {
        displayMode,
        throwOnError: false,
        trust: false,
      });
    } catch {
      const escaped = content.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
      return escaped;
    }
  }, [content, displayMode, limitMessage]);

  if (limitMessage) {
    const fallback = getRenderFallbackText(content);
    if (displayMode) {
      return (
        <div className="math-block my-4 overflow-x-auto">
          <div className="text-sm text-destructive mb-2">{limitMessage}</div>
          <pre>
            <code>{fallback}</code>
          </pre>
        </div>
      );
    }
    return <code title={limitMessage}>{fallback}</code>;
  }

  if (displayMode) {
    return <div className="math-block my-4 overflow-x-auto" dangerouslySetInnerHTML={{ __html: html }} />;
  }
  return <span className="math-inline" dangerouslySetInnerHTML={{ __html: html }} />;
};
