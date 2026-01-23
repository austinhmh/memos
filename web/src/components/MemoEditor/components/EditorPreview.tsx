import type { Element } from "hast";
import { memo, useMemo } from "react";
import ReactMarkdown from "react-markdown";
import rehypeKatex from "rehype-katex";
import rehypeRaw from "rehype-raw";
import rehypeSanitize from "rehype-sanitize";
import remarkBreaks from "remark-breaks";
import remarkGfm from "remark-gfm";
import remarkMath from "remark-math";
import { CodeBlock } from "@/components/MemoContent/CodeBlock";
import { isTagNode, isTaskListItemNode } from "@/components/MemoContent/ConditionalComponent";
import { SANITIZE_SCHEMA } from "@/components/MemoContent/constants";
import { Tag } from "@/components/MemoContent/Tag";
import { TaskListItem } from "@/components/MemoContent/TaskListItem";
import { MemoViewContext } from "@/components/MemoView/MemoViewContext";
import { useTranslate } from "@/utils/i18n";
import { rehypeLineNumbers } from "@/utils/rehype-plugins/rehype-line-numbers";
import { remarkDisableSetext } from "@/utils/remark-plugins/remark-disable-setext";
import { remarkLineNumbers } from "@/utils/remark-plugins/remark-line-numbers";
import { remarkPreserveType } from "@/utils/remark-plugins/remark-preserve-type";
import { remarkTag } from "@/utils/remark-plugins/remark-tag";

interface EditorPreviewProps {
  content: string;
  scrollRef?: React.RefObject<HTMLDivElement>;
}

export const EditorPreview = memo(({ content, scrollRef }: EditorPreviewProps) => {
  const t = useTranslate();

  const previewTitle = useMemo(() => t("editor.preview-title"), [t]);
  const emptyText = useMemo(() => t("editor.preview-empty"), [t]);

  // Provide a minimal MemoViewContext for the preview
  // This prevents errors when Tag components try to access the context
  const mockMemoViewContext = useMemo(
    () => ({
      memo: {} as any,
      creator: undefined,
      currentUser: undefined,
      parentPage: "",
      isArchived: false,
      readonly: true, // Preview is always readonly
      showNSFWContent: false,
      nsfw: false,
    }),
    [],
  );

  return (
    <div className="w-full h-full flex flex-col min-h-0">
      <h3 className="text-sm font-medium text-muted-foreground mb-2 px-1 flex-shrink-0">
        {previewTitle}
      </h3>
      <div ref={scrollRef} className="flex-1 overflow-y-auto border rounded-md p-4 bg-background min-h-0">
        {content ? (
          <MemoViewContext.Provider value={mockMemoViewContext}>
            <div className="markdown-content relative w-full max-w-full wrap-break-word text-base leading-6">
              <ReactMarkdown
                remarkPlugins={[
                  remarkDisableSetext,
                  remarkMath,
                  remarkGfm,
                  remarkBreaks,
                  remarkTag,
                  remarkPreserveType,
                  remarkLineNumbers, // Add line number tracking
                ]}
                rehypePlugins={[
                  rehypeRaw,
                  rehypeKatex,
                  [rehypeSanitize, SANITIZE_SCHEMA],
                  rehypeLineNumbers, // Transfer line numbers to HTML
                ]}
                components={{
                  input: ((inputProps: React.ComponentProps<"input"> & { node?: Element }) => {
                    if (inputProps.node && isTaskListItemNode(inputProps.node)) {
                      return <TaskListItem {...inputProps} />;
                    }
                    return <input {...inputProps} />;
                  }) as React.ComponentType<React.ComponentProps<"input">>,
                  span: ((spanProps: React.ComponentProps<"span"> & { node?: Element }) => {
                    const { node, ...rest } = spanProps;
                    if (node && isTagNode(node)) {
                      return <Tag {...spanProps} />;
                    }
                    return <span {...rest} />;
                  }) as React.ComponentType<React.ComponentProps<"span">>,
                  pre: CodeBlock,
                  a: ({ href, children, ...aProps }) => (
                    <a href={href} target="_blank" rel="noopener noreferrer" {...aProps}>
                      {children}
                    </a>
                  ),
                }}
              >
                {content}
              </ReactMarkdown>
            </div>
          </MemoViewContext.Provider>
        ) : (
          <p className="text-muted-foreground text-sm italic">
            {emptyText}
          </p>
        )}
      </div>
    </div>
  );
});

EditorPreview.displayName = "EditorPreview";
