import copy from "copy-to-clipboard";
import hljs from "highlight.js";
import { CheckIcon, ChevronDownIcon, ChevronUpIcon, CopyIcon } from "lucide-react";
import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import { useAuth } from "@/contexts/AuthContext";
import { cn } from "@/lib/utils";
import { getThemeWithFallback, resolveTheme } from "@/utils/theme";
import { MermaidBlockRenderer } from "./MermaidBlockRenderer";

interface CodeBlockRendererProps {
  language: string;
  code: string;
}

const MAX_HEIGHT = "50vh";
const MAX_SYNC_HIGHLIGHT_CHARS = 12_000;
const MAX_SYNC_HIGHLIGHT_LINES = 180;

let loadedHighlightTheme: "dark" | "light" | undefined;
let loadingHighlightTheme: "dark" | "light" | undefined;
let highlightThemeLoadPromise: Promise<void> | undefined;

function escapeHtml(content: string): string {
  return Object.assign(document.createElement("span"), { textContent: content }).innerHTML;
}

async function ensureHighlightTheme(theme: "dark" | "light") {
  if (loadedHighlightTheme === theme) {
    return;
  }

  if (loadingHighlightTheme === theme && highlightThemeLoadPromise) {
    await highlightThemeLoadPromise;
    return;
  }

  loadingHighlightTheme = theme;
  highlightThemeLoadPromise = (async () => {
    try {
      const cssModule =
        theme === "dark"
          ? await import("highlight.js/styles/github-dark-dimmed.css?inline")
          : await import("highlight.js/styles/github.css?inline");
      const existingStyle = document.querySelector("style[data-hljs-theme]");
      const style = existingStyle ?? document.createElement("style");
      style.textContent = cssModule.default;
      style.setAttribute("data-hljs-theme", theme);
      if (!existingStyle) {
        document.head.appendChild(style);
      }
      loadedHighlightTheme = theme;
    } catch (error) {
      console.warn("Failed to load highlight.js theme:", error);
    } finally {
      if (loadingHighlightTheme === theme) {
        loadingHighlightTheme = undefined;
        highlightThemeLoadPromise = undefined;
      }
    }
  })();

  await highlightThemeLoadPromise;
}

export const CodeBlockRenderer: React.FC<CodeBlockRendererProps> = ({ language, code }) => {
  const { userGeneralSetting } = useAuth();
  const [copied, setCopied] = useState(false);
  const [expanded, setExpanded] = useState(false);
  const [isOverflowing, setIsOverflowing] = useState(false);
  const preRef = useRef<HTMLPreElement>(null);
  const codeContent = code.replace(/\n$/, "");
  const lang = language.trim().toLowerCase();
  const isMermaid = lang === "mermaid" || lang === "mermaidjs";
  const theme = getThemeWithFallback(userGeneralSetting?.theme);
  const resolvedTheme = resolveTheme(theme);
  const highlightTheme = resolvedTheme.includes("dark") ? "dark" : "light";

  useEffect(() => {
    ensureHighlightTheme(highlightTheme);
  }, [highlightTheme]);

  const highlightedCode = useMemo(() => {
    const shouldSkipHighlight = codeContent.length > MAX_SYNC_HIGHLIGHT_CHARS || codeContent.split("\n").length > MAX_SYNC_HIGHLIGHT_LINES;

    if (shouldSkipHighlight) {
      return escapeHtml(codeContent);
    }

    try {
      const hllang = hljs.getLanguage(lang);
      if (hllang) {
        return hljs.highlight(codeContent, { language: lang }).value;
      }
    } catch {
      /* skip */
    }
    return escapeHtml(codeContent);
  }, [lang, codeContent]);

  useLayoutEffect(() => {
    const pre = preRef.current;
    if (!pre) {
      return;
    }

    let raf = 0;
    const measure = () => {
      if (raf) {
        cancelAnimationFrame(raf);
      }

      raf = requestAnimationFrame(() => {
        raf = 0;
        const next = !expanded && pre.scrollHeight > pre.clientHeight + 1;
        setIsOverflowing((prev) => (prev === next ? prev : next));
      });
    };

    measure();

    const observer = typeof ResizeObserver === "undefined" ? undefined : new ResizeObserver(measure);
    observer?.observe(pre);
    window.addEventListener("resize", measure);

    return () => {
      if (raf) {
        cancelAnimationFrame(raf);
      }
      observer?.disconnect();
      window.removeEventListener("resize", measure);
    };
  }, [expanded, highlightedCode]);

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

  if (isMermaid) {
    return <MermaidBlockRenderer code={codeContent} />;
  }

  const showExpandButton = expanded || isOverflowing;

  return (
    <div className="code-block-collapsible relative">
      <pre ref={preRef} className="relative" style={expanded ? undefined : { maxHeight: MAX_HEIGHT, overflowY: "auto" }}>
        <div className="absolute right-2 leading-3 top-1.5 flex flex-row justify-end items-center gap-1 opacity-60 hover:opacity-80 z-10">
          <span className="text-[10px] font-medium text-muted-foreground/60 uppercase tracking-wider select-none">
            {lang || "plaintext"}
          </span>
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
      {showExpandButton && (
        <button
          type="button"
          onClick={toggleExpand}
          className="code-block-expand-btn"
          aria-label={expanded ? "收起代码块" : "展开代码块"}
          aria-expanded={expanded}
          title={expanded ? "收起代码块" : "展开代码块"}
        >
          {expanded ? <ChevronUpIcon className="w-4 h-4" /> : <ChevronDownIcon className="w-4 h-4" />}
        </button>
      )}
    </div>
  );
};
