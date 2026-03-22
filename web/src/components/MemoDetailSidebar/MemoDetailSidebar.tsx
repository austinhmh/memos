import { create } from "@bufbuild/protobuf";
import { FieldMaskSchema } from "@bufbuild/protobuf/wkt";
import { timestampDate } from "@bufbuild/protobuf/wkt";
import { isEqual } from "lodash-es";
import { CheckCircleIcon, Code2Icon, HashIcon, LinkIcon, PlusIcon, XIcon } from "lucide-react";
import { useCallback, useRef, useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { toast } from "react-hot-toast";
import { memoServiceClient } from "@/connect";
import useCurrentUser from "@/hooks/useCurrentUser";
import { memoKeys } from "@/hooks/useMemoQueries";
import { cn } from "@/lib/utils";
import { Memo, Memo_PropertySchema, MemoRelation_Type } from "@/types/proto/api/v1/memo_service_pb";
import { isSuperUser } from "@/utils/user";
import { useTranslate } from "@/utils/i18n";
import MemoRelationForceGraph from "../MemoRelationForceGraph";

interface Props {
  memo: Memo;
  className?: string;
  parentPage?: string;
}

const MemoDetailSidebar = ({ memo, className, parentPage }: Props) => {
  const t = useTranslate();
  const currentUser = useCurrentUser();
  const queryClient = useQueryClient();
  const [showTagInput, setShowTagInput] = useState(false);
  const [tagValue, setTagValue] = useState("");
  const inputRef = useRef<HTMLInputElement>(null);
  const property = create(Memo_PropertySchema, memo.property || {});
  const hasSpecialProperty = property.hasLink || property.hasTaskList || property.hasCode || property.hasIncompleteTasks;
  const shouldShowRelationGraph = memo.relations.filter((r) => r.type === MemoRelation_Type.REFERENCE).length > 0;
  const canEdit = !!currentUser && (memo.creator === currentUser.name || isSuperUser(currentUser));

  const invalidateMemo = useCallback((name: string) => {
    queryClient.invalidateQueries({ queryKey: memoKeys.detail(name) });
    queryClient.invalidateQueries({ queryKey: memoKeys.lists() });
  }, [queryClient]);

  const addTagToContent = useCallback(async (tag: string) => {
    const normalizedTag = tag.replace(/^#/, "").trim();
    if (!normalizedTag || !memo.name) return;

    const tagText = `#${normalizedTag}`;
    if (memo.content.includes(tagText)) {
      toast.error(`标签 ${tagText} 已存在`);
      return;
    }

    const trimmed = memo.content.replace(/\n+$/, "");
    const newContent = trimmed + "\n\n" + tagText + "\n";

    try {
      await memoServiceClient.updateMemo({
        memo: { name: memo.name, content: newContent },
        updateMask: create(FieldMaskSchema, { paths: ["content"] }),
      });
      invalidateMemo(memo.name);
      setTagValue("");
      setShowTagInput(false);
    } catch (err) {
      console.error("Failed to add tag:", err);
      toast.error("添加标签失败 Failed to add tag");
    }
  }, [memo, invalidateMemo]);

  const removeTagFromContent = useCallback(async (tag: string) => {
    if (!memo.name) return;
    const tagText = `#${tag}`;
    const newContent = memo.content
      .replace(new RegExp(`\\n*${tagText.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}\\s*`, "g"), "")
      .replace(/\n{3,}/g, "\n\n")
      .replace(/\n+$/, "\n");

    try {
      await memoServiceClient.updateMemo({
        memo: { name: memo.name, content: newContent },
        updateMask: create(FieldMaskSchema, { paths: ["content"] }),
      });
      invalidateMemo(memo.name);
    } catch (err) {
      console.error("Failed to remove tag:", err);
      toast.error("删除标签失败 Failed to remove tag");
    }
  }, [memo, invalidate]);

  const handleTagSubmit = useCallback(() => {
    if (tagValue.trim()) {
      addTagToContent(tagValue.trim());
    }
  }, [tagValue, addTagToContent]);

  return (
    <aside
      className={cn("relative w-full h-auto max-h-screen overflow-auto hide-scrollbar flex flex-col justify-start items-start", className)}
    >
      <div className="flex flex-col justify-start items-start w-full px-1 gap-2 h-auto shrink-0 flex-nowrap hide-scrollbar">
        {shouldShowRelationGraph && (
          <div className="relative w-full h-36 border border-border rounded-lg bg-muted">
            <MemoRelationForceGraph className="w-full h-full" memo={memo} parentPage={parentPage} />
            <div className="absolute top-1 left-2 text-xs opacity-60 font-mono gap-1 flex flex-row items-center">
              <span>{t("common.relations")}</span>
              <span className="text-xs opacity-60">(Beta)</span>
            </div>
          </div>
        )}
        <div className="w-full flex flex-col">
          <p className="flex flex-row justify-start items-center w-full gap-1 mb-1 text-sm leading-6 text-muted-foreground select-none">
            <span>{t("common.created-at")}</span>
          </p>
          <p className="text-sm text-muted-foreground">{memo.createTime && timestampDate(memo.createTime).toLocaleString()}</p>
        </div>
        {!isEqual(memo.createTime, memo.updateTime) && (
          <div className="w-full flex flex-col">
            <p className="flex flex-row justify-start items-center w-full gap-1 mb-1 text-sm leading-6 text-muted-foreground select-none">
              <span>{t("common.last-updated-at")}</span>
            </p>
            <p className="text-sm text-muted-foreground">{memo.updateTime && timestampDate(memo.updateTime).toLocaleString()}</p>
          </div>
        )}
        {hasSpecialProperty && (
          <div className="w-full flex flex-col">
            <p className="flex flex-row justify-start items-center w-full gap-1 mb-1 text-sm leading-6 text-muted-foreground select-none">
              <span>{t("common.properties")}</span>
            </p>
            <div className="w-full flex flex-row justify-start items-center gap-x-2 gap-y-1 flex-wrap text-muted-foreground">
              {property.hasLink && (
                <div className="w-auto border border-border pl-1 pr-1.5 rounded-md flex justify-between items-center">
                  <div className="w-auto flex justify-start items-center mr-1">
                    <LinkIcon className="w-4 h-auto mr-1" />
                    <span className="block text-sm">{t("memo.links")}</span>
                  </div>
                </div>
              )}
              {property.hasTaskList && (
                <div className="w-auto border border-border pl-1 pr-1.5 rounded-md flex justify-between items-center">
                  <div className="w-auto flex justify-start items-center mr-1">
                    <CheckCircleIcon className="w-4 h-auto mr-1" />
                    <span className="block text-sm">{t("memo.to-do")}</span>
                  </div>
                </div>
              )}
              {property.hasCode && (
                <div className="w-auto border border-border pl-1 pr-1.5 rounded-md flex justify-between items-center">
                  <div className="w-auto flex justify-start items-center mr-1">
                    <Code2Icon className="w-4 h-auto mr-1" />
                    <span className="block text-sm">{t("memo.code")}</span>
                  </div>
                </div>
              )}
            </div>
          </div>
        )}

        {/* Tags section with add/remove */}
        <div className="w-full">
          <div className="flex flex-row justify-between items-center w-full gap-1 mb-1 text-sm leading-6 text-muted-foreground select-none">
            <div className="flex items-center gap-1">
              <span>{t("common.tags")}</span>
              {memo.tags.length > 0 && <span className="shrink-0">({memo.tags.length})</span>}
            </div>
            {canEdit && !showTagInput && (
              <button
                onClick={() => {
                  setShowTagInput(true);
                  setTimeout(() => inputRef.current?.focus(), 50);
                }}
                className="p-0.5 rounded hover:bg-accent text-muted-foreground hover:text-foreground transition-colors"
                title="添加标签 Add Tag"
              >
                <PlusIcon className="w-3.5 h-3.5" />
              </button>
            )}
          </div>

          {showTagInput && (
            <div className="flex items-center gap-1 mb-2">
              <span className="text-sm text-muted-foreground">#</span>
              <input
                ref={inputRef}
                type="text"
                value={tagValue}
                onChange={(e) => setTagValue(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === "Enter") {
                    e.preventDefault();
                    handleTagSubmit();
                  } else if (e.key === "Escape") {
                    setShowTagInput(false);
                    setTagValue("");
                  }
                }}
                placeholder="tag name"
                className="flex-1 min-w-0 text-sm bg-transparent border-b border-border focus:border-primary outline-none px-1 py-0.5 text-foreground placeholder:text-muted-foreground/50"
              />
              <button
                onClick={handleTagSubmit}
                disabled={!tagValue.trim()}
                className="text-xs px-2 py-0.5 rounded bg-primary/10 text-primary hover:bg-primary/20 disabled:opacity-30 transition-colors"
              >
                添加
              </button>
              <button
                onClick={() => { setShowTagInput(false); setTagValue(""); }}
                className="p-0.5 rounded hover:bg-accent text-muted-foreground"
              >
                <XIcon className="w-3.5 h-3.5" />
              </button>
            </div>
          )}

          {memo.tags.length > 0 ? (
            <div className="w-full flex flex-row justify-start items-center relative flex-wrap gap-x-2 gap-y-1">
              {memo.tags.map((tag) => (
                <div
                  key={tag}
                  className="group shrink-0 w-auto max-w-full text-sm rounded-md leading-6 flex flex-row justify-start items-center select-none text-muted-foreground"
                >
                  <HashIcon className="w-4 h-auto shrink-0 opacity-40" />
                  <span className="truncate opacity-80 ml-0.5">{tag}</span>
                  {canEdit && (
                    <button
                      onClick={() => removeTagFromContent(tag)}
                      className="ml-1 p-0.5 rounded opacity-0 group-hover:opacity-60 hover:!opacity-100 hover:bg-destructive/10 hover:text-destructive transition-all"
                      title={`删除标签 #${tag}`}
                    >
                      <XIcon className="w-3 h-3" />
                    </button>
                  )}
                </div>
              ))}
            </div>
          ) : !showTagInput && (
            <p className="text-xs text-muted-foreground/50">无标签 No tags</p>
          )}
        </div>
      </div>
    </aside>
  );
};

export default MemoDetailSidebar;
