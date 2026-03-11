import copy from "copy-to-clipboard";
import hljs from "highlight.js";
import { CheckIcon, CopyIcon } from "lucide-react";
import { useEffect, useMemo, useState } from "react";
import { useAuth } from "@/contexts/AuthContext";
import { cn } from "@/lib/utils";
import { getThemeWithFallback, resolveTheme } from "@/utils/theme";
import { MermaidBlockRenderer } from "./MermaidBlockRenderer";

interface CodeBlockRendererProps {
  language: string;
  code: string;
}

export const CodeBlockRenderer: React.FC<CodeBlockRendererProps> = ({ language, code }) => {
  const { userGeneralSetting } = useAuth();
  const [copied, setCopied] = useState(false);
  const codeContent = code.replace(/\n$/, "");
  const lang = language.trim().toLowerCase();
  const isMermaid = lang === "mermaid" || lang === "mermaidjs";

  if (isMermaid) {
    return <MermaidBlockRenderer code={codeContent} />;
  }

  const theme = getThemeWithFallback(userGeneralSetting?.theme);
  const resolvedTheme = resolveTheme(theme);
  const isDarkTheme = resolvedTheme.includes("dark");

  useEffect(() => {
    const dynamicImportStyle = async () => {
      const existingStyle = document.querySelector("style[data-hljs-theme]");
      if (existingStyle) existingStyle.remove();
      try {
        const cssModule = isDarkTheme
          ? await import("highlight.js/styles/github-dark-dimmed.css?inline")
          : await import("highlight.js/styles/github.css?inline");
        const style = document.createElement("style");
        style.textContent = cssModule.default;
        style.setAttribute("data-hljs-theme", isDarkTheme ? "dark" : "light");
        document.head.appendChild(style);
      } catch (error) {
        console.warn("Failed to load highlight.js theme:", error);
      }
    };
    dynamicImportStyle();
  }, [resolvedTheme, isDarkTheme]);

  const highlightedCode = useMemo(() => {
    try {
      const hllang = hljs.getLanguage(lang);
      if (hllang) {
        return hljs.highlight(codeContent, { language: lang }).value;
      }
    } catch { /* skip */ }
    return Object.assign(document.createElement("span"), { textContent: codeContent }).innerHTML;
  }, [lang, codeContent]);

  const handleCopy = async () => {
    try {
      if (navigator.clipboard && window.isSecureContext) {
        await navigator.clipboard.writeText(codeContent);
      } else {
        copy(codeContent);
      }
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      copy(codeContent);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    }
  };

  return (
    <pre className="relative">
      <div className="absolute right-2 leading-3 top-1.5 flex flex-row justify-end items-center gap-1 opacity-60 hover:opacity-80">
        <span className="text-[10px] font-medium text-muted-foreground/60 uppercase tracking-wider select-none">{lang || "plaintext"}</span>
        <button
          onClick={handleCopy}
          className={cn("rounded-md transition-all", "hover:bg-accent/50", copied ? "text-primary" : "text-muted-foreground")}
          aria-label={copied ? "Copied" : "Copy code"}
          title={copied ? "Copied!" : "Copy code"}
        >
          {copied ? <CheckIcon className="w-3 h-3" /> : <CopyIcon className="w-3 h-3" />}
        </button>
      </div>
      <code className={`language-${lang}`} dangerouslySetInnerHTML={{ __html: highlightedCode }} />
    </pre>
  );
};
