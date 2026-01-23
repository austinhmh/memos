import { ChevronDownIcon, ChevronRightIcon, ListIcon } from "lucide-react";
import { useEffect, useState } from "react";
import { cn } from "@/lib/utils";
import { useTranslate } from "@/utils/i18n";

interface Heading {
  id: string;
  text: string;
  level: number;
  children?: Heading[];
}

interface Props {
  content: string;
  className?: string;
}

const TableOfContents = ({ content, className }: Props) => {
  const t = useTranslate();
  const [headings, setHeadings] = useState<Heading[]>([]);
  const [activeId, setActiveId] = useState<string>("");
  const [isExpanded, setIsExpanded] = useState<boolean>(true);
  const [collapsedIds, setCollapsedIds] = useState<Set<string>>(new Set());

  useEffect(() => {
    const extractHeadings = (markdown: string): Heading[] => {
      const lines = markdown.split("\n");
      const flatHeadings: Heading[] = [];
      let headingCounter = 0;

      for (const line of lines) {
        const atxMatch = line.match(/^(#{1,6})\s+(.+)$/);
        if (atxMatch) {
          const level = atxMatch[1].length;
          const text = atxMatch[2].trim();
          const id = `heading-${headingCounter++}`;
          flatHeadings.push({ id, text, level, children: [] });
        }
      }

      // 构建树形结构
      const buildTree = (items: Heading[]): Heading[] => {
        const root: Heading[] = [];
        const stack: Heading[] = [];

        for (const item of items) {
          while (stack.length > 0 && stack[stack.length - 1].level >= item.level) {
            stack.pop();
          }

          if (stack.length === 0) {
            root.push(item);
          } else {
            const parent = stack[stack.length - 1];
            if (!parent.children) parent.children = [];
            parent.children.push(item);
          }

          stack.push(item);
        }

        return root;
      };

      return buildTree(flatHeadings);
    };

    const extracted = extractHeadings(content);
    setHeadings(extracted);

    setTimeout(() => {
      const contentElement = document.querySelector(".markdown-content");
      if (contentElement) {
        const domHeadings = contentElement.querySelectorAll("h1, h2, h3, h4, h5, h6");
        const flatHeadings = flattenHeadings(extracted);
        domHeadings.forEach((heading, index) => {
          if (index < flatHeadings.length) {
            heading.id = flatHeadings[index].id;
          }
        });
      }
    }, 100);
  }, [content]);

  const flattenHeadings = (items: Heading[]): Heading[] => {
    const result: Heading[] = [];
    const flatten = (items: Heading[]) => {
      for (const item of items) {
        result.push(item);
        if (item.children && item.children.length > 0) {
          flatten(item.children);
        }
      }
    };
    flatten(items);
    return result;
  };

  useEffect(() => {
    const handleScroll = () => {
      const flatHeadings = flattenHeadings(headings);
      const headingElements = flatHeadings.map((h) => document.getElementById(h.id)).filter(Boolean);
      
      for (let i = headingElements.length - 1; i >= 0; i--) {
        const element = headingElements[i];
        if (element) {
          const rect = element.getBoundingClientRect();
          if (rect.top <= 100) {
            setActiveId(flatHeadings[i].id);
            return;
          }
        }
      }
      
      if (headingElements.length > 0) {
        setActiveId(flatHeadings[0].id);
      }
    };

    window.addEventListener("scroll", handleScroll);
    handleScroll();

    return () => window.removeEventListener("scroll", handleScroll);
  }, [headings]);

  const handleClick = (id: string) => {
    const element = document.getElementById(id);
    if (element) {
      const offset = 80;
      const elementPosition = element.getBoundingClientRect().top + window.pageYOffset;
      const offsetPosition = elementPosition - offset;

      window.scrollTo({
        top: offsetPosition,
        behavior: "smooth",
      });
      setActiveId(id);
    }
  };

  const toggleCollapse = (id: string) => {
    setCollapsedIds((prev) => {
      const newSet = new Set(prev);
      if (newSet.has(id)) {
        newSet.delete(id);
      } else {
        newSet.add(id);
      }
      return newSet;
    });
  };

  const renderHeading = (heading: Heading, depth: number = 0) => {
    const hasChildren = heading.children && heading.children.length > 0;
    const isCollapsed = collapsedIds.has(heading.id);

    return (
      <li key={heading.id} className="w-full">
        <div className="flex flex-row items-center w-full">
          {hasChildren && (
            <button
              type="button"
              onClick={() => toggleCollapse(heading.id)}
              className="shrink-0 p-1 hover:bg-accent rounded transition-colors"
            >
              {isCollapsed ? (
                <ChevronRightIcon className="w-3 h-3 text-muted-foreground" />
              ) : (
                <ChevronDownIcon className="w-3 h-3 text-muted-foreground" />
              )}
            </button>
          )}
          <button
            type="button"
            onClick={() => handleClick(heading.id)}
            style={{ paddingLeft: hasChildren ? "0" : "1.25rem" }}
            className={cn(
              "flex-1 text-left text-sm py-1 px-2 rounded transition-colors truncate",
              "hover:bg-accent hover:text-accent-foreground",
              activeId === heading.id
                ? "text-primary font-medium bg-accent/50"
                : "text-muted-foreground"
            )}
            title={heading.text}
          >
            {heading.text}
          </button>
        </div>
        {hasChildren && !isCollapsed && (
          <ul className="ml-4 space-y-1 mt-1">
            {heading.children!.map((child) => renderHeading(child, depth + 1))}
          </ul>
        )}
      </li>
    );
  };

  if (headings.length === 0) {
    return null;
  }

  const totalCount = flattenHeadings(headings).length;

  return (
    <aside className={cn("w-full flex flex-col justify-start items-start", className)}>
      <button
        type="button"
        onClick={() => setIsExpanded(!isExpanded)}
        className="flex flex-row justify-start items-center w-full gap-1 mb-3 text-sm leading-6 text-muted-foreground select-none hover:text-foreground transition-colors cursor-pointer"
      >
        {isExpanded ? (
          <ChevronDownIcon className="w-4 h-auto" />
        ) : (
          <ChevronRightIcon className="w-4 h-auto" />
        )}
        <ListIcon className="w-4 h-auto" />
        <span>{t("memo.table-of-contents") || "目录"}</span>
        <span className="text-xs opacity-60">({totalCount})</span>
      </button>
      {isExpanded && (
        <nav className="w-full">
          <ul className="space-y-1">
            {headings.map((heading) => renderHeading(heading))}
          </ul>
        </nav>
      )}
    </aside>
  );
};

export default TableOfContents;
