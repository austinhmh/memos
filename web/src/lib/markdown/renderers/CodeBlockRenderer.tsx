import copy from "copy-to-clipboard";
import hljs from "highlight.js";
import { CheckIcon, ChevronDownIcon, ChevronUpIcon, CopyIcon } from "lucide-react";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useAuth } from "@/contexts/AuthContext";
import { cn } from "@/lib/utils";
import { getThemeWithFallback, resolveTheme } from "@/utils/theme";
import { MermaidBlockRenderer } from "./MermaidBlockRenderer";

interface CodeBlockRendererProps {
  language: string;
  code: string;
}

const MAX_HEIGHT = "50vh";

export const CodeBlockRenderer: React.FC<CodeBlockRendererProps> = ({ language, code }) => {
  const { userGeneralSetting } = useAuth();
  const [copied, setCopied] = useState(false);
  const [expanded, setExpanded] = useState(false);
  const [isOverflowing, setIsOverflowing] = useState(false);
  const codeRef = useRef<HTMLPreElement>(null);
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

  useEffect(() => {
    if (!codeRef.current) return;
    const el = codeRef.current;
    const check = () => setIsOverflowing(el.scrollHeight > el.clientHeight + 2);
    check();
    const observer = new ResizeObserver(check);
    observer.observe(el);
    return () => observer.disconnect();
  }, [codeContent, expanded]);

  const highlightedCode = useMemo(() => {
    try {
      const hllang = hljs.getLanguage(lang);
      if (hllang) {
        return hljs.highlight(codeContent, { language: lang }).value;
      }
    } catch { /* skip */ }
    return Object.assign(document.createElement("span"), { textContent: codeContent }).innerHTML;
  }, [lang, codeContent]);

  const handleCopy = useCallback(async () => {
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
  }, [codeContent]);

  const toggleExpand = useCallback(() => {
    setExpanded((prev) => !prev);
  }, []);

  return (
    <div className="code-block-collapsible relative">
      <pre
        ref={codeRef}
        className="relative"
        style={expanded ? undefined : { maxHeight: MAX_HEIGHT, overflowY: "auto" }}
      >
        <div className="absolute right-2 leading-3 top-1.5 flex flex-row justify-end items-center gap-1 opacity-60 hover:opacity-80 z-10">
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
      {(isOverflowing || expanded) && (
        <button
          onClick={toggleExpand}
          className="code-block-expand-btn"
          title={expanded ? "收起 Collapse" : "展开全部 Expand All"}
        >
          {expanded ? (
            <>
              <ChevronUpIcon className="w-3.5 h-3.5" />
              <span>收起 Collapse</span>
            </>
          ) : (
            <>
              <ChevronDownIcon className="w-3.5 h-3.5" />
              <span>展开全部 Expand All</span>
            </>
          )}
        </button>
      )}
    </div>
  );
};
