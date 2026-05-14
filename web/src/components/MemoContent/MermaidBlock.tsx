import { useEffect, useMemo, useRef, useState } from "react";
import { useAuth } from "@/contexts/AuthContext";
import { getRenderFallbackText, getRenderLimitMessage, MERMAID_RENDER_LIMIT } from "@/lib/markdown/renderLimits";
import { renderMermaid } from "@/lib/mermaid/mermaidInit";
import { normalizeMermaidCode } from "@/lib/mermaid/normalizeMermaidCode";
import { sanitizeSvg } from "@/lib/sanitize-svg";
import { cn } from "@/lib/utils";
import { getThemeWithFallback, resolveTheme, setupSystemThemeListener } from "@/utils/theme";
import { extractCodeContent } from "./utils";

interface MermaidBlockProps {
  children?: React.ReactNode;
  className?: string;
}

const getMermaidTheme = (appTheme: string): "default" | "dark" => {
  return appTheme === "default-dark" ? "dark" : "default";
};

export const MermaidBlock = ({ children, className }: MermaidBlockProps) => {
  const { userGeneralSetting } = useAuth();
  const containerRef = useRef<HTMLDivElement>(null);
  const [svg, setSvg] = useState<string>("");
  const [error, setError] = useState<string>("");
  const [systemThemeChange, setSystemThemeChange] = useState(0);

  const codeContent = extractCodeContent(children);

  const themePreference = getThemeWithFallback(userGeneralSetting?.theme);
  const currentTheme = useMemo(() => resolveTheme(themePreference), [themePreference, systemThemeChange]);

  useEffect(() => {
    if (themePreference !== "system") return;
    return setupSystemThemeListener(() => {
      setSystemThemeChange((prev) => prev + 1);
    });
  }, [themePreference]);

  useEffect(() => {
    const trimmedCode = codeContent?.trim();
    if (!trimmedCode) {
      setSvg("");
      setError("");
      return;
    }

    const limitMessage = getRenderLimitMessage(codeContent, MERMAID_RENDER_LIMIT);
    if (limitMessage) {
      setSvg("");
      setError(limitMessage);
      return;
    }

    const render = async () => {
      try {
        const normalizedCode = normalizeMermaidCode(codeContent);
        const { svg: renderedSvg } = await renderMermaid(normalizedCode, {
          theme: getMermaidTheme(currentTheme),
        });
        const safeSvg = sanitizeSvg(renderedSvg);
        if (!safeSvg) {
          throw new Error("Unsafe Mermaid SVG output");
        }
        setSvg(safeSvg);
        setError("");
      } catch (err) {
        console.error("Failed to render mermaid diagram:", err);
        setError(err instanceof Error ? err.message : "Failed to render diagram");
      }
    };

    render();
  }, [codeContent, currentTheme]);

  if (error) {
    return (
      <div className="w-full">
        <div className="text-sm text-destructive mb-2">Mermaid Error: {error}</div>
        <pre className={className}>
          <code className="language-mermaid">{getRenderFallbackText(codeContent)}</code>
        </pre>
      </div>
    );
  }

  return (
    <div
      ref={containerRef}
      className={cn("mermaid-diagram w-full flex justify-center items-center my-4 overflow-x-auto", className)}
      dangerouslySetInnerHTML={{ __html: svg }}
    />
  );
};
