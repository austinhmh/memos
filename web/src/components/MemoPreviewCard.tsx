import { timestampDate } from "@bufbuild/protobuf/wkt";
import { BookmarkIcon, CheckIcon, ChevronDownIcon, FileTextIcon, MessageCircleMoreIcon } from "lucide-react";
import { memo, useCallback } from "react";
import { toast } from "react-hot-toast";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from "@/components/ui/dropdown-menu";
import useCurrentUser from "@/hooks/useCurrentUser";
import { useUpdateMemo } from "@/hooks/useMemoQueries";
import useNavigateTo from "@/hooks/useNavigateTo";
import { useUser } from "@/hooks/useUserQueries";
import i18n from "@/i18n";
import { cn } from "@/lib/utils";
import type { Memo } from "@/types/proto/api/v1/memo_service_pb";
import { MemoRelation_Type, Visibility } from "@/types/proto/api/v1/memo_service_pb";
import { useTranslate } from "@/utils/i18n";
import { isSuperUser } from "@/utils/user";
import MemoActionMenu from "./MemoActionMenu";
import UserAvatar from "./UserAvatar";
import VisibilityIcon from "./VisibilityIcon";

interface MemoPreviewCardProps {
  memo: Memo;
  showCreator?: boolean;
  showVisibility?: boolean;
  showPinned?: boolean;
  parentPage?: string;
}

function extractTitle(content: string): { title: string; body: string } {
  const lines = content.split("\n");
  const firstLine = lines[0]?.trim() || "";
  if (firstLine.startsWith("# ")) {
    return { title: firstLine.slice(2).trim(), body: lines.slice(1).join("\n").trim() };
  }
  return { title: "", body: content.trim() };
}

function extractSummary(text: string, maxLength = 200): string {
  const cleaned = text
    .replace(/^#{1,6}\s+/gm, "")
    .replace(/```[\s\S]*?```/g, "[code]")
    .replace(/\$\$[\s\S]*?\$\$/g, "[formula]")
    .replace(/!\[.*?\]\(.*?\)/g, "[image]")
    .replace(/\[([^\]]*)\]\(.*?\)/g, "$1")
    .replace(/[*_~`>]/g, "")
    .replace(/\n{2,}/g, "\n")
    .trim();

  if (cleaned.length <= maxLength) return cleaned;
  return cleaned.slice(0, maxLength) + "…";
}

const MemoPreviewCard: React.FC<MemoPreviewCardProps> = ({ memo: memoData, showCreator, showVisibility, showPinned, parentPage }) => {
  const navigateTo = useNavigateTo();
  const currentUser = useCurrentUser();
  const updateMemo = useUpdateMemo({ syncListCaches: true });
  const t = useTranslate();
  const creator = useUser(memoData.creator).data;
  const { title, body } = extractTitle(memoData.content);
  const summary = extractSummary(body);
  const displayTime = memoData.displayTime ? timestampDate(memoData.displayTime) : undefined;
  const commentAmount = (memoData.relations || []).filter(
    (r) => r.type === MemoRelation_Type.COMMENT && r.relatedMemo?.name === memoData.name,
  ).length;
  const hasAttachments = memoData.attachments && memoData.attachments.length > 0;
  const isBlog = memoData.tags?.includes("blog");
  const lineCount = memoData.content.split("\n").length;
  const isLongForm = isBlog || lineCount > 15;
  const readingTime = Math.max(1, Math.ceil(memoData.content.length / 400));
  const canEditVisibility = !!currentUser && (memoData.creator === currentUser.name || !!isSuperUser(currentUser));
  const visibilityOptions = [
    { value: Visibility.PRIVATE, label: t("memo.visibility.private") },
    { value: Visibility.PROTECTED, label: t("memo.visibility.protected") },
    { value: Visibility.PUBLIC, label: t("memo.visibility.public") },
  ] as const;

  const handleVisibilityChange = useCallback(
    async (visibility: Visibility) => {
      if (visibility === memoData.visibility) return;
      try {
        await updateMemo.mutateAsync({
          update: { name: memoData.name, visibility },
          updateMask: ["visibility"],
        });
        toast.success("权限已更新");
      } catch (err) {
        console.error("Failed to update visibility:", err);
        toast.error("权限更新失败");
      }
    },
    [memoData.name, memoData.visibility, updateMemo],
  );

  const handleClick = () => {
    navigateTo(`/${memoData.name}`, { state: { from: parentPage || "/" } });
  };

  return (
    <article
      className={cn(
        "group relative w-full bg-card border border-border rounded-lg px-5 py-4",
        "cursor-pointer transition-all duration-200",
        "hover:shadow-md hover:border-primary/20",
      )}
      onClick={handleClick}
    >
      <div className="flex flex-row items-center gap-2 mb-2">
        {isLongForm && <FileTextIcon className="w-4 h-4 text-primary/60 shrink-0" />}
        {showCreator && creator && (
          <div className="flex items-center gap-2 mr-2">
            <UserAvatar className="shrink-0" avatarUrl={creator.avatarUrl} />
            <span className="text-sm text-muted-foreground truncate">{creator.displayName || creator.username}</span>
          </div>
        )}
        <span className="text-xs text-muted-foreground">
          <relative-time datetime={displayTime?.toISOString()} lang={i18n.language} format="auto"></relative-time>
        </span>
        {isLongForm && <span className="text-xs text-muted-foreground">· {readingTime} min read</span>}
        <div className="flex-1" />
        {showPinned && memoData.pinned && <BookmarkIcon className="w-4 h-4 text-primary shrink-0" />}
        {showVisibility &&
          (canEditVisibility ? (
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <button
                  type="button"
                  className="inline-flex items-center gap-1 rounded-md px-1 py-0.5 text-muted-foreground hover:bg-accent hover:text-foreground transition-colors shrink-0"
                  onClick={(event) => event.stopPropagation()}
                >
                  <VisibilityIcon visibility={memoData.visibility} />
                  <ChevronDownIcon className="w-3.5 h-3.5 opacity-60" />
                </button>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="end">
                {visibilityOptions.map((option) => (
                  <DropdownMenuItem
                    key={option.value}
                    className="cursor-pointer gap-2"
                    onClick={(event) => {
                      event.stopPropagation();
                      handleVisibilityChange(option.value);
                    }}
                  >
                    <VisibilityIcon visibility={option.value} />
                    <span className="flex-1">{option.label}</span>
                    {memoData.visibility === option.value && <CheckIcon className="w-4 h-4 text-primary" />}
                  </DropdownMenuItem>
                ))}
              </DropdownMenuContent>
            </DropdownMenu>
          ) : (
            <VisibilityIcon visibility={memoData.visibility} />
          ))}
        {commentAmount > 0 && (
          <div className="flex items-center gap-0.5 text-muted-foreground">
            <MessageCircleMoreIcon className="w-3.5 h-3.5" />
            <span className="text-xs">{commentAmount}</span>
          </div>
        )}
        <div className="opacity-0 group-hover:opacity-100 transition-opacity" onClick={(e) => e.stopPropagation()}>
          <MemoActionMenu memo={memoData} />
        </div>
      </div>

      {title && <h3 className={cn("font-semibold text-foreground mb-1 line-clamp-1", isLongForm ? "text-lg" : "text-base")}>{title}</h3>}

      {summary && (
        <p
          className={cn("text-sm text-muted-foreground leading-relaxed whitespace-pre-line", isLongForm ? "line-clamp-4" : "line-clamp-3")}
        >
          {summary}
        </p>
      )}

      {hasAttachments && (
        <div className="mt-2 flex items-center gap-1 text-xs text-muted-foreground">
          <span>📎 {memoData.attachments.length}</span>
        </div>
      )}

      {memoData.tags && memoData.tags.length > 0 && (
        <div className="mt-2 flex flex-wrap gap-1">
          {memoData.tags.slice(0, 5).map((tag) => (
            <span
              key={tag}
              className={cn(
                "text-xs px-2 py-0.5 rounded-full",
                tag === "blog" ? "bg-blue-500/10 text-blue-600 dark:text-blue-400" : "bg-primary/10 text-primary",
              )}
            >
              #{tag}
            </span>
          ))}
          {memoData.tags.length > 5 && <span className="text-xs px-2 py-0.5 text-muted-foreground">+{memoData.tags.length - 5}</span>}
        </div>
      )}
    </article>
  );
};

export default memo(MemoPreviewCard);
