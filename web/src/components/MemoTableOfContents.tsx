import { useEffect, useState, useMemo } from "react";
import { ListTreeIcon } from "lucide-react";
import { cn } from "@/lib/utils";
import slugify from "slugify";

interface TocItem {
  level: number;
  text: string;
  id: string;
}

function safeSlugify(text: string) {
  return `h-${slugify(text, {
    remove: /[!"#$%&'.()*+,/:;<=>?@[\]\\^_`{|}~]/g,
    lower: true,
  }).replace(/&amp;/g, "")}`;
}

function extractHeadings(content: string): TocItem[] {
  const lines = content.split("\n");
  const headings: TocItem[] = [];
  const seen: Record<string, number> = {};
  let inCodeBlock = false;

  for (const line of lines) {
    if (line.trimStart().startsWith("```")) {
      inCodeBlock = !inCodeBlock;
      continue;
    }
    if (inCodeBlock) continue;

    const match = line.match(/^(#{1,6})\s+(.+)/);
    if (match) {
      const level = match[1].length;
      const text = match[2].replace(/[#*_`[\]()]/g, "").trim();
      if (!text) continue;

      const baseSlug = safeSlugify(text);
      const index = seen[baseSlug] ?? 0;
      seen[baseSlug] = index + 1;
      const id = index === 0 ? baseSlug : `${baseSlug}-${index}`;

      headings.push({ level, text, id });
    }
  }

  return headings;
}

interface MemoTableOfContentsProps {
  content: string;
  className?: string;
}

const MemoTableOfContents = ({ content, className }: MemoTableOfContentsProps) => {
  const headings = useMemo(() => extractHeadings(content), [content]);
  const [activeId, setActiveId] = useState<string>("");

  useEffect(() => {
    if (headings.length === 0) return;

    const observer = new IntersectionObserver(
      (entries) => {
        for (const entry of entries) {
          if (entry.isIntersecting) {
            setActiveId(entry.target.id);
            break;
          }
        }
      },
      { rootMargin: "-80px 0px -60% 0px", threshold: 0.1 },
    );

    const timer = setTimeout(() => {
      for (const h of headings) {
        const el = document.getElementById(h.id);
        if (el) observer.observe(el);
      }
    }, 500);

    return () => {
      clearTimeout(timer);
      observer.disconnect();
    };
  }, [headings]);

  if (headings.length === 0) return null;

  const minLevel = Math.min(...headings.map((h) => h.level));

  const handleClick = (id: string) => {
    const el = document.getElementById(id);
    if (el) {
      el.scrollIntoView({ behavior: "smooth", block: "start" });
      setActiveId(id);
    }
  };

  return (
    <nav className={cn("w-full", className)}>
      <div className="flex items-center gap-1.5 mb-2 text-sm font-medium text-muted-foreground select-none">
        <ListTreeIcon className="w-4 h-4 opacity-60" />
        <span>目录</span>
      </div>
      <ul className="flex flex-col gap-0.5">
        {headings.map((h, i) => {
          const indent = h.level - minLevel;
          return (
            <li key={`${h.id}-${i}`}>
              <button
                type="button"
                onClick={() => handleClick(h.id)}
                className={cn(
                  "w-full text-left text-xs leading-5 py-0.5 rounded-sm transition-colors truncate cursor-pointer",
                  "hover:text-foreground hover:bg-accent/40",
                  activeId === h.id
                    ? "text-foreground font-medium bg-accent/30"
                    : "text-muted-foreground",
                )}
                style={{ paddingLeft: `${indent * 12 + 4}px` }}
                title={h.text}
              >
                {h.text}
              </button>
            </li>
          );
        })}
      </ul>
    </nav>
  );
};

export default MemoTableOfContents;
