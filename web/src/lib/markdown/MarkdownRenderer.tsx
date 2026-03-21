import React, { useMemo, useState, useEffect, useRef, startTransition } from "react";
import type Token from "markdown-it/lib/token.mjs";
import type { Node as ProsemirrorNode } from "prosemirror-model";
import headingToSlug from "@/outline-vendor/shared/editor/lib/headingToSlug";
import { createMarkdownParser } from "./parser";
import { CodeBlockRenderer } from "./renderers/CodeBlockRenderer";
import { MathRenderer } from "./renderers/MathRenderer";
import { NoticeRenderer } from "./renderers/NoticeRenderer";
import { TagRenderer } from "./renderers/TagRenderer";
import { CheckboxRenderer } from "./renderers/CheckboxRenderer";

const LARGE_CONTENT_THRESHOLD = 50_000;
const INITIAL_BLOCKS = 30;
const BLOCKS_PER_LOAD = 20;

interface MarkdownRendererProps {
  content: string;
  className?: string;
}

interface BlockGroup {
  tokens: Token[];
  checkboxStartIndex: number;
}

type HeadingSlugState = {
  seen: Record<string, number>;
};

export const MarkdownRenderer: React.FC<MarkdownRendererProps> = React.memo(({ content, className }) => {
  const isLarge = content.length > LARGE_CONTENT_THRESHOLD;

  const parsed = useMemo(() => {
    const parser = createMarkdownParser();
    const tokens = parser.parse(content, {});

    if (!isLarge) {
      return {
        mode: "standard" as const,
        elements: renderTokens(tokens, content, 0, { seen: {} }),
      };
    }

    return { mode: "progressive" as const, groups: splitIntoTopLevelGroups(tokens) };
  }, [content, isLarge]);

  if (parsed.mode === "standard") {
    return <div className={className}>{parsed.elements}</div>;
  }

  return <ProgressiveRenderer groups={parsed.groups} rawContent={content} className={className} />;
});

MarkdownRenderer.displayName = "MarkdownRenderer";

const ProgressiveRenderer: React.FC<{
  groups: BlockGroup[];
  rawContent: string;
  className?: string;
}> = ({ groups, rawContent, className }) => {
  const [visibleCount, setVisibleCount] = useState(INITIAL_BLOCKS);
  const sentinelRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    setVisibleCount(INITIAL_BLOCKS);
  }, [groups]);

  useEffect(() => {
    if (visibleCount >= groups.length) return;

    const sentinel = sentinelRef.current;
    if (!sentinel) return;

    const observer = new IntersectionObserver(
      ([entry]) => {
        if (entry.isIntersecting) {
          startTransition(() => {
            setVisibleCount((prev) => Math.min(prev + BLOCKS_PER_LOAD, groups.length));
          });
        }
      },
      { rootMargin: "500px" },
    );

    observer.observe(sentinel);
    return () => observer.disconnect();
  }, [visibleCount, groups.length]);

  const headingStateRef = useRef<HeadingSlugState>({ seen: {} });

  useEffect(() => {
    headingStateRef.current = { seen: {} };
  }, [groups, rawContent]);

  return (
    <div className={className}>
      {groups.slice(0, visibleCount).map((group, idx) => (
        <MemoizedBlockGroup key={idx} group={group} rawContent={rawContent} headingState={headingStateRef.current} />
      ))}
      {visibleCount < groups.length && (
        <div ref={sentinelRef} className="py-2 text-center">
          <span className="text-muted-foreground text-xs animate-pulse">···</span>
        </div>
      )}
    </div>
  );
};

const MemoizedBlockGroup = React.memo(({
  group,
  rawContent,
  headingState,
}: {
  group: BlockGroup;
  rawContent: string;
  headingState: HeadingSlugState;
}) => {
  return <>{renderTokens(group.tokens, rawContent, group.checkboxStartIndex, headingState)}</>;
});

MemoizedBlockGroup.displayName = "MemoizedBlockGroup";

function splitIntoTopLevelGroups(tokens: Token[]): BlockGroup[] {
  const groups: BlockGroup[] = [];
  let current: Token[] = [];
  let depth = 0;
  let checkboxCount = 0;
  let groupCheckboxStart = 0;

  for (const token of tokens) {
    current.push(token);
    depth += token.nesting;

    if (token.type === "checkbox_item_open") {
      checkboxCount++;
    }

    if (depth === 0 && current.length > 0) {
      groups.push({ tokens: current, checkboxStartIndex: groupCheckboxStart });
      groupCheckboxStart = checkboxCount;
      current = [];
    }
  }

  if (current.length > 0) {
    groups.push({ tokens: current, checkboxStartIndex: groupCheckboxStart });
  }

  return groups;
}

function renderTokens(
  tokens: Token[],
  rawContent: string,
  initialCheckboxIndex = 0,
  headingState: HeadingSlugState = { seen: {} },
): React.ReactNode[] {
  const result: React.ReactNode[] = [];
  let i = 0;
  let checkboxIndex = initialCheckboxIndex;

  while (i < tokens.length) {
    const token = tokens[i];

    if (token.type === "heading_open") {
      const level = parseInt(token.tag.slice(1), 10);
      const inlineToken = tokens[i + 1];
      const children = inlineToken ? renderInline(inlineToken.children || [], rawContent) : null;
      const headingNode = {
        textContent: inlineToken?.content || "",
      } as ProsemirrorNode;
      const baseSlug = headingToSlug(headingNode);
      const index = headingState.seen[baseSlug] ?? 0;
      headingState.seen[baseSlug] = index + 1;
      const id = index === 0 ? baseSlug : headingToSlug(headingNode, index);
      result.push(React.createElement(`h${level}`, { key: i, id }, children));
      i += 3;
      continue;
    }

    if (token.type === "paragraph_open") {
      const inlineToken = tokens[i + 1];
      const children = inlineToken ? renderInline(inlineToken.children || [], rawContent) : null;
      result.push(<p key={i}>{children}</p>);
      i += 3;
      continue;
    }

    if (token.type === "blockquote_open") {
      const { children, endIndex } = collectBlock(tokens, i, "blockquote_open", "blockquote_close", rawContent, headingState);
      result.push(<blockquote key={i}>{children}</blockquote>);
      i = endIndex + 1;
      continue;
    }

    if (token.type === "bullet_list_open") {
      const { children, endIndex } = collectBlock(tokens, i, "bullet_list_open", "bullet_list_close", rawContent, headingState);
      result.push(<ul key={i}>{children}</ul>);
      i = endIndex + 1;
      continue;
    }

    if (token.type === "ordered_list_open") {
      const start = token.attrGet("start");
      const { children, endIndex } = collectBlock(tokens, i, "ordered_list_open", "ordered_list_close", rawContent, headingState);
      result.push(<ol key={i} start={start ? parseInt(start) : undefined}>{children}</ol>);
      i = endIndex + 1;
      continue;
    }

    if (token.type === "list_item_open") {
      const { children, endIndex } = collectBlock(tokens, i, "list_item_open", "list_item_close", rawContent, headingState);
      result.push(<li key={i}>{children}</li>);
      i = endIndex + 1;
      continue;
    }

    if (token.type === "checkbox_list_open") {
      const { children, endIndex } = collectCheckboxList(tokens, i, rawContent, checkboxIndex, headingState);
      const checkboxCount = countCheckboxItems(tokens, i, endIndex);
      checkboxIndex += checkboxCount;
      result.push(<ul key={i} className="checkbox-list">{children}</ul>);
      i = endIndex + 1;
      continue;
    }

    if (token.type === "fence") {
      const language = (token.info || "").trim().toLowerCase();
      const code = token.content;
      result.push(<CodeBlockRenderer key={i} language={language} code={code} />);
      i += 1;
      continue;
    }

    if (token.type === "code_block") {
      result.push(<CodeBlockRenderer key={i} language="" code={token.content} />);
      i += 1;
      continue;
    }

    if (token.type === "math_block") {
      result.push(<MathRenderer key={i} content={token.content} displayMode={true} />);
      i += 1;
      continue;
    }

    if (token.type === "hr") {
      result.push(<hr key={i} />);
      i += 1;
      continue;
    }

    if (token.type === "html_block") {
      result.push(<div key={i} dangerouslySetInnerHTML={{ __html: sanitizeHtml(token.content) }} />);
      i += 1;
      continue;
    }

    if (token.type === "table_open") {
      const { endIndex } = findClosingToken(tokens, i, "table_open", "table_close");
      const tableTokens = tokens.slice(i, endIndex + 1);
      result.push(renderTable(tableTokens, i, rawContent));
      i = endIndex + 1;
      continue;
    }

    if (token.type === "container_notice_open") {
      const style = token.info.trim() || "info";
      const { children, endIndex } = collectBlock(tokens, i, "container_notice_open", "container_notice_close", rawContent, headingState);
      result.push(<NoticeRenderer key={i} style={style}>{children}</NoticeRenderer>);
      i = endIndex + 1;
      continue;
    }

    i++;
  }

  return result;
}

function renderInline(tokens: Token[], rawContent: string): React.ReactNode[] {
  const result: React.ReactNode[] = [];
  let i = 0;

  while (i < tokens.length) {
    const token = tokens[i];

    if (token.type === "text") {
      result.push(<React.Fragment key={i}>{token.content}</React.Fragment>);
      i++;
      continue;
    }

    if (token.type === "softbreak") {
      result.push(<br key={i} />);
      i++;
      continue;
    }

    if (token.type === "hardbreak" || token.type === "br") {
      result.push(<br key={i} />);
      i++;
      continue;
    }

    if (token.type === "code_inline") {
      result.push(<code key={i}>{token.content}</code>);
      i++;
      continue;
    }

    if (token.type === "math_inline") {
      result.push(<MathRenderer key={i} content={token.content} displayMode={false} />);
      i++;
      continue;
    }

    if (token.type === "tag") {
      const tagValue = token.content;
      result.push(<TagRenderer key={i} tag={tagValue} />);
      i++;
      continue;
    }

    if (token.type === "emoji") {
      result.push(<span key={i}>{token.content}</span>);
      i++;
      continue;
    }

    if (token.type === "html_inline") {
      result.push(<span key={i} dangerouslySetInnerHTML={{ __html: sanitizeHtml(token.content) }} />);
      i++;
      continue;
    }

    if (token.type === "image") {
      const src = sanitizeUrl(token.attrGet("src") || "");
      const alt = token.content || token.attrGet("alt") || "";
      const title = token.attrGet("title") || undefined;
      result.push(<img key={i} src={src} alt={alt} title={title} loading="lazy" />);
      i++;
      continue;
    }

    if (token.type === "strong_open") {
      const { children, endIndex } = collectInline(tokens, i, "strong_open", "strong_close", rawContent);
      result.push(<strong key={i}>{children}</strong>);
      i = endIndex + 1;
      continue;
    }

    if (token.type === "em_open") {
      const { children, endIndex } = collectInline(tokens, i, "em_open", "em_close", rawContent);
      result.push(<em key={i}>{children}</em>);
      i = endIndex + 1;
      continue;
    }

    if (token.type === "s_open") {
      const { children, endIndex } = collectInline(tokens, i, "s_open", "s_close", rawContent);
      result.push(<del key={i}>{children}</del>);
      i = endIndex + 1;
      continue;
    }

    if (token.type === "link_open") {
      const href = sanitizeUrl(token.attrGet("href") || "");
      const { children, endIndex } = collectInline(tokens, i, "link_open", "link_close", rawContent);
      const isAnchor = href.startsWith("#");
      result.push(
        <a
          key={i}
          href={href}
          {...(isAnchor
            ? {
                onClick: (e: React.MouseEvent) => {
                  e.preventDefault();
                  const targetId = href.slice(1);
                  const el = document.getElementById(targetId) || document.getElementById(decodeURIComponent(targetId));
                  if (el) el.scrollIntoView({ behavior: "smooth", block: "start" });
                },
              }
            : { target: "_blank", rel: "noopener noreferrer" })}
        >
          {children}
        </a>,
      );
      i = endIndex + 1;
      continue;
    }

    if (token.type === "highlight_open") {
      const { children, endIndex } = collectInline(tokens, i, "highlight_open", "highlight_close", rawContent);
      result.push(<mark key={i}>{children}</mark>);
      i = endIndex + 1;
      continue;
    }

    if (token.type === "underline_open") {
      const { children, endIndex } = collectInline(tokens, i, "underline_open", "underline_close", rawContent);
      result.push(<u key={i}>{children}</u>);
      i = endIndex + 1;
      continue;
    }

    result.push(<React.Fragment key={i}>{token.content}</React.Fragment>);
    i++;
  }

  return result;
}

function collectBlock(
  tokens: Token[],
  startIndex: number,
  openType: string,
  closeType: string,
  rawContent: string,
  headingState: HeadingSlugState,
): { children: React.ReactNode[]; endIndex: number } {
  let depth = 1;
  let i = startIndex + 1;
  const innerTokens: Token[] = [];

  while (i < tokens.length && depth > 0) {
    if (tokens[i].type === openType) depth++;
    if (tokens[i].type === closeType) {
      depth--;
      if (depth === 0) break;
    }
    innerTokens.push(tokens[i]);
    i++;
  }

  return { children: renderTokens(innerTokens, rawContent, 0, headingState), endIndex: i };
}

function collectInline(
  tokens: Token[],
  startIndex: number,
  openType: string,
  closeType: string,
  rawContent: string,
): { children: React.ReactNode[]; endIndex: number } {
  let depth = 1;
  let i = startIndex + 1;
  const innerTokens: Token[] = [];

  while (i < tokens.length && depth > 0) {
    if (tokens[i].type === openType) depth++;
    if (tokens[i].type === closeType) {
      depth--;
      if (depth === 0) break;
    }
    innerTokens.push(tokens[i]);
    i++;
  }

  return { children: renderInline(innerTokens, rawContent), endIndex: i };
}

function collectCheckboxList(
  tokens: Token[],
  startIndex: number,
  rawContent: string,
  startCheckboxIndex: number,
  headingState: HeadingSlugState,
): { children: React.ReactNode[]; endIndex: number } {
  let depth = 1;
  let i = startIndex + 1;
  const items: React.ReactNode[] = [];
  let localIdx = 0;

  while (i < tokens.length && depth > 0) {
    if (tokens[i].type === "checkbox_list_open") depth++;
    if (tokens[i].type === "checkbox_list_close") {
      depth--;
      if (depth === 0) break;
    }

    if (tokens[i].type === "checkbox_item_open") {
      const checked = tokens[i].attrGet("checked") === "true";
      const taskIndex = startCheckboxIndex + localIdx;
      localIdx++;
      const { children, endIndex } = collectBlock(tokens, i, "checkbox_item_open", "checkbox_item_close", rawContent, headingState);
      items.push(
        <CheckboxRenderer key={i} checked={checked} taskIndex={taskIndex}>
          {children}
        </CheckboxRenderer>
      );
      i = endIndex + 1;
      continue;
    }

    i++;
  }

  return { children: items, endIndex: i };
}

function countCheckboxItems(tokens: Token[], start: number, end: number): number {
  let count = 0;
  for (let i = start; i <= end; i++) {
    if (tokens[i].type === "checkbox_item_open") count++;
  }
  return count;
}

function findClosingToken(
  tokens: Token[],
  startIndex: number,
  openType: string,
  closeType: string,
): { endIndex: number } {
  let depth = 1;
  let i = startIndex + 1;
  while (i < tokens.length && depth > 0) {
    if (tokens[i].type === openType) depth++;
    if (tokens[i].type === closeType) depth--;
    i++;
  }
  return { endIndex: i - 1 };
}

function renderTable(tokens: Token[], baseKey: number, rawContent: string): React.ReactNode {
  const rows: React.ReactNode[] = [];
  let i = 0;
  let isHeader = false;
  const headerRows: React.ReactNode[] = [];
  const bodyRows: React.ReactNode[] = [];

  while (i < tokens.length) {
    const token = tokens[i];

    if (token.type === "thead_open") {
      isHeader = true;
      i++;
      continue;
    }
    if (token.type === "thead_close") {
      isHeader = false;
      i++;
      continue;
    }
    if (token.type === "tbody_open" || token.type === "tbody_close") {
      i++;
      continue;
    }

    if (token.type === "tr_open") {
      const cells: React.ReactNode[] = [];
      i++;
      while (i < tokens.length && tokens[i].type !== "tr_close") {
        if (tokens[i].type === "th_open" || tokens[i].type === "td_open") {
          const cellTag = tokens[i].type === "th_open" ? "th" : "td";
          const style: React.CSSProperties = {};
          const attrs = tokens[i].attrs;
          if (attrs) {
            for (const [key, value] of attrs) {
              if (key === "style" && value.includes("text-align")) {
                const match = value.match(/text-align:\s*(left|center|right)/);
                if (match) style.textAlign = match[1] as "left" | "center" | "right";
              }
            }
          }
          i++;
          const inlineToken = tokens[i];
          const children = inlineToken?.type === "inline" ? renderInline(inlineToken.children || [], rawContent) : null;
          i++;
          cells.push(React.createElement(cellTag, { key: cells.length, style: Object.keys(style).length ? style : undefined }, children));
          i++; // skip close
          continue;
        }
        i++;
      }
      const row = <tr key={rows.length}>{cells}</tr>;
      if (isHeader) headerRows.push(row);
      else bodyRows.push(row);
      i++;
      continue;
    }

    i++;
  }

  return (
    <div key={baseKey} className="overflow-x-auto">
      <table>
        {headerRows.length > 0 && <thead>{headerRows}</thead>}
        {bodyRows.length > 0 && <tbody>{bodyRows}</tbody>}
        {headerRows.length === 0 && bodyRows.length === 0 && <tbody>{rows}</tbody>}
      </table>
    </div>
  );
}

function slugify(text: string): string {
  return text
    .toLowerCase()
    .replace(/[^\w\s\u4e00-\u9fff-]/g, "")
    .replace(/\s+/g, "-")
    .replace(/-+/g, "-")
    .trim();
}

function sanitizeHtml(html: string): string {
  const DANGEROUS_TAGS = /<(script|iframe|object|embed|form|base|meta|link|style|svg|math|details|dialog|template|applet|frameset|frame|bgsound|video|audio|source)[>\s/]/gi;
  const EVENT_HANDLERS = /\bon\w+\s*=/gi;
  const DANGEROUS_ATTRS = /\b(srcdoc|formaction|action|xlink:href)\s*=/gi;
  return html
    .replace(DANGEROUS_TAGS, "&lt;$1 ")
    .replace(EVENT_HANDLERS, "data-removed=")
    .replace(DANGEROUS_ATTRS, "data-removed=");
}

function sanitizeUrl(url: string): string {
  if (!url) return "";
  const trimmed = url.trim();
  if (/^\s*(javascript|data|vbscript)\s*:/i.test(trimmed)) {
    return "";
  }
  return trimmed;
}
