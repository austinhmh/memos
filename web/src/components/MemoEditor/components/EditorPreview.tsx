import { memo, useMemo } from "react";
import MemoContent from "@/components/MemoContent";
import { MemoViewContext } from "@/components/MemoView/MemoViewContext";
import { useTranslate } from "@/utils/i18n";

interface EditorPreviewProps {
  content: string;
}

export const EditorPreview = memo(({ content }: EditorPreviewProps) => {
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
      <div className="flex-1 overflow-y-auto border rounded-md p-4 bg-background min-h-0">
        {content ? (
          <MemoViewContext.Provider value={mockMemoViewContext}>
            <MemoContent content={content} />
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
