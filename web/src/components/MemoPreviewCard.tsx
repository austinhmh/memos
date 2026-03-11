import { timestampDate } from "@bufbuild/protobuf/wkt";
import { BookmarkIcon, MessageCircleMoreIcon } from "lucide-react";
import { memo } from "react";
import { useUser } from "@/hooks/useUserQueries";
import useNavigateTo from "@/hooks/useNavigateTo";
import i18n from "@/i18n";
import { cn } from "@/lib/utils";
import type { Memo } from "@/types/proto/api/v1/memo_service_pb";
import { MemoRelation_Type, Visibility } from "@/types/proto/api/v1/memo_service_pb";
import VisibilityIcon from "./VisibilityIcon";
import UserAvatar from "./UserAvatar";

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
  const creator = useUser(memoData.creator).data;
  const { title, body } = extractTitle(memoData.content);
  const summary = extractSummary(body);
  const displayTime = memoData.displayTime ? timestampDate(memoData.displayTime) : undefined;
  const commentAmount = (memoData.relations || []).filter(
    (r) => r.type === MemoRelation_Type.COMMENT && r.relatedMemo?.name === memoData.name,
  ).length;
  const hasAttachments = memoData.attachments && memoData.attachments.length > 0;

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
        {showCreator && creator && (
          <div className="flex items-center gap-2 mr-2">
            <UserAvatar className="shrink-0" avatarUrl={creator.avatarUrl} />
            <span className="text-sm text-muted-foreground truncate">{creator.displayName || creator.username}</span>
          </div>
        )}
        <span className="text-xs text-muted-foreground">
          <relative-time datetime={displayTime?.toISOString()} lang={i18n.language} format="auto"></relative-time>
        </span>
        <div className="flex-1" />
        {showPinned && memoData.pinned && <BookmarkIcon className="w-4 h-4 text-primary shrink-0" />}
        {showVisibility && memoData.visibility !== Visibility.PRIVATE && (
          <VisibilityIcon visibility={memoData.visibility} />
        )}
        {commentAmount > 0 && (
          <div className="flex items-center gap-0.5 text-muted-foreground">
            <MessageCircleMoreIcon className="w-3.5 h-3.5" />
            <span className="text-xs">{commentAmount}</span>
          </div>
        )}
      </div>

      {title && (
        <h3 className="text-base font-semibold text-foreground mb-1 line-clamp-1">{title}</h3>
      )}

      {summary && (
        <p className="text-sm text-muted-foreground leading-relaxed line-clamp-3 whitespace-pre-line">{summary}</p>
      )}

      {hasAttachments && (
        <div className="mt-2 flex items-center gap-1 text-xs text-muted-foreground">
          <span>📎 {memoData.attachments.length}</span>
        </div>
      )}

      {memoData.tags && memoData.tags.length > 0 && (
        <div className="mt-2 flex flex-wrap gap-1">
          {memoData.tags.slice(0, 5).map((tag) => (
            <span key={tag} className="text-xs px-2 py-0.5 rounded-full bg-primary/10 text-primary">#{tag}</span>
          ))}
          {memoData.tags.length > 5 && (
            <span className="text-xs px-2 py-0.5 text-muted-foreground">+{memoData.tags.length - 5}</span>
          )}
        </div>
      )}
    </article>
  );
};

export default memo(MemoPreviewCard);
