import mermaid from "mermaid";
import { useEffect, useMemo, useRef, useState } from "react";
import { useAuth } from "@/contexts/AuthContext";
import { normalizeMermaidCode } from "@/lib/mermaid/normalizeMermaidCode";
import { cn } from "@/lib/utils";
import { getThemeWithFallback, resolveTheme, setupSystemThemeListener } from "@/utils/theme";

interface MermaidBlockRendererProps {
  code: string;
}

const getMermaidTheme = (appTheme: string): "default" | "dark" => {
  return appTheme === "default-dark" ? "dark" : "default";
};

export const MermaidBlockRenderer: React.FC<MermaidBlockRendererProps> = ({ code }) => {
  const { userGeneralSetting } = useAuth();
  const containerRef = useRef<HTMLDivElement>(null);
  const [svg, setSvg] = useState<string>("");
  const [error, setError] = useState<string>("");
  const [systemThemeChange, setSystemThemeChange] = useState(0);

  const themePreference = getThemeWithFallback(userGeneralSetting?.theme);
  const currentTheme = useMemo(() => resolveTheme(themePreference), [themePreference, systemThemeChange]);

  useEffect(() => {
    if (themePreference !== "system") return;
    return setupSystemThemeListener(() => setSystemThemeChange((prev) => prev + 1));
  }, [themePreference]);

  useEffect(() => {
    if (!code?.trim()) return;
    const renderDiagram = async () => {
      try {
        const id = `mermaid-${Math.random().toString(36).substring(7)}`;
        mermaid.initialize({ startOnLoad: false, theme: getMermaidTheme(currentTheme), securityLevel: "strict", fontFamily: "inherit" });
        const normalizedCode = normalizeMermaidCode(code);
        const { svg: renderedSvg } = await mermaid.render(id, normalizedCode);
        setSvg(renderedSvg);
        setError("");
      } catch (err) {
        setError(err instanceof Error ? err.message : "Failed to render diagram");
      }
    };
    renderDiagram();
  }, [code, currentTheme]);

  if (error) {
    return (
      <div className="w-full">
        <div className="text-sm text-destructive mb-2">Mermaid Error: {error}</div>
        <pre><code className="language-mermaid">{code}</code></pre>
      </div>
    );
  }

  return (
    <div
      ref={containerRef}
      className={cn("mermaid-diagram w-full flex justify-center items-center my-4 overflow-x-auto")}
      dangerouslySetInnerHTML={{ __html: svg }}
    />
  );
};
