import { timestampDate } from "@bufbuild/protobuf/wkt";
import { BookmarkIcon, CheckIcon, ChevronDownIcon, EyeOffIcon, MessageCircleMoreIcon } from "lucide-react";
import { useState } from "react";
import { toast } from "react-hot-toast";
import { Link } from "react-router-dom";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from "@/components/ui/dropdown-menu";
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from "@/components/ui/tooltip";
import { useUpdateMemo } from "@/hooks/useMemoQueries";
import i18n from "@/i18n";
import { cn } from "@/lib/utils";
import { Visibility } from "@/types/proto/api/v1/memo_service_pb";
import type { User } from "@/types/proto/api/v1/user_service_pb";
import { useTranslate } from "@/utils/i18n";
import { isSuperUser } from "@/utils/user";
import MemoActionMenu from "../../MemoActionMenu";
import { ReactionSelector } from "../../MemoReactionListView";
import UserAvatar from "../../UserAvatar";
import VisibilityIcon from "../../VisibilityIcon";
import { useMemoViewContext, useMemoViewDerived } from "../MemoViewContext";
import type { MemoHeaderProps } from "../types";

const MemoHeader: React.FC<MemoHeaderProps> = ({
  showCreator,
  showVisibility,
  showPinned,
  onEdit,
  onGotoDetail,
  onUnpin,
  onToggleNsfwVisibility,
}) => {
  const t = useTranslate();
  const updateMemo = useUpdateMemo({ syncListCaches: true });
  const [reactionSelectorOpen, setReactionSelectorOpen] = useState(false);

  const { memo, creator, currentUser, parentPage, isArchived, readonly, showNSFWContent, nsfw } = useMemoViewContext();
  const { isInMemoDetailPage, commentAmount, relativeTimeFormat } = useMemoViewDerived();
  const canEditVisibility = !readonly && !!currentUser && (memo.creator === currentUser.name || !!isSuperUser(currentUser));
  const visibilityOptions = [
    { value: Visibility.PRIVATE, label: t("memo.visibility.private") },
    { value: Visibility.PROTECTED, label: t("memo.visibility.protected") },
    { value: Visibility.PUBLIC, label: t("memo.visibility.public") },
  ] as const;

  const handleVisibilityChange = async (visibility: Visibility) => {
    if (visibility === memo.visibility) return;
    try {
      await updateMemo.mutateAsync({
        update: { name: memo.name, visibility },
        updateMask: ["visibility"],
      });
      toast.success("权限已更新");
    } catch (err) {
      console.error("Failed to update visibility:", err);
      toast.error("权限更新失败");
    }
  };

  const displayTime = isArchived ? (
    (memo.displayTime ? timestampDate(memo.displayTime) : undefined)?.toLocaleString(i18n.language)
  ) : (
    <relative-time
      datetime={(memo.displayTime ? timestampDate(memo.displayTime) : undefined)?.toISOString()}
      lang={i18n.language}
      format={relativeTimeFormat}
    ></relative-time>
  );

  return (
    <div className="w-full flex flex-row justify-between items-center gap-2">
      <div className="w-auto max-w-[calc(100%-8rem)] grow flex flex-row justify-start items-center">
        {showCreator && creator ? (
          <CreatorDisplay creator={creator} displayTime={displayTime} onGotoDetail={onGotoDetail} />
        ) : (
          <TimeDisplay displayTime={displayTime} onGotoDetail={onGotoDetail} />
        )}
      </div>

      <div className="flex flex-row justify-end items-center select-none shrink-0 gap-2">
        {currentUser && !isArchived && (
          <ReactionSelector
            className={cn("border-none w-auto h-auto", reactionSelectorOpen && "block!", "block sm:hidden sm:group-hover:block")}
            memo={memo}
            onOpenChange={setReactionSelectorOpen}
          />
        )}

        {!isInMemoDetailPage && commentAmount > 0 && (
          <Link
            className={cn("flex flex-row justify-start items-center rounded-md px-1 hover:opacity-80 gap-0.5")}
            to={`/${memo.name}#comments`}
            viewTransition
            state={{ from: parentPage }}
          >
            <MessageCircleMoreIcon className="w-4 h-4 mx-auto text-muted-foreground" />
            <span className="text-xs text-muted-foreground">{commentAmount}</span>
          </Link>
        )}

        {showVisibility &&
          (canEditVisibility ? (
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <button
                  type="button"
                  className="inline-flex justify-center items-center gap-1 rounded-md px-1 py-0.5 text-muted-foreground hover:bg-accent hover:text-foreground transition-colors"
                >
                  <VisibilityIcon visibility={memo.visibility} />
                  <ChevronDownIcon className="w-3.5 h-3.5 opacity-60" />
                </button>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="end">
                {visibilityOptions.map((option) => (
                  <DropdownMenuItem
                    key={option.value}
                    className="cursor-pointer gap-2"
                    onClick={() => handleVisibilityChange(option.value)}
                  >
                    <VisibilityIcon visibility={option.value} />
                    <span className="flex-1">{option.label}</span>
                    {memo.visibility === option.value && <CheckIcon className="w-4 h-4 text-primary" />}
                  </DropdownMenuItem>
                ))}
              </DropdownMenuContent>
            </DropdownMenu>
          ) : (
            <VisibilityIcon visibility={memo.visibility} />
          ))}

        {showPinned && memo.pinned && (
          <TooltipProvider>
            <Tooltip>
              <TooltipTrigger asChild>
                <span className="cursor-pointer">
                  <BookmarkIcon className="w-4 h-auto text-primary" onClick={onUnpin} />
                </span>
              </TooltipTrigger>
              <TooltipContent>
                <p>{t("common.unpin")}</p>
              </TooltipContent>
            </Tooltip>
          </TooltipProvider>
        )}

        {nsfw && showNSFWContent && onToggleNsfwVisibility && (
          <span className="cursor-pointer">
            <EyeOffIcon className="w-4 h-auto text-primary" onClick={onToggleNsfwVisibility} />
          </span>
        )}

        <MemoActionMenu memo={memo} readonly={readonly} onEdit={onEdit} />
      </div>
    </div>
  );
};

interface CreatorDisplayProps {
  creator: User;
  displayTime: React.ReactNode;
  onGotoDetail: () => void;
}

const CreatorDisplay: React.FC<CreatorDisplayProps> = ({ creator, displayTime, onGotoDetail }) => (
  <div className="w-full flex flex-row justify-start items-center">
    <Link className="w-auto hover:opacity-80 rounded-md transition-colors" to={`/u/${encodeURIComponent(creator.username)}`} viewTransition>
      <UserAvatar className="mr-2 shrink-0" avatarUrl={creator.avatarUrl} />
    </Link>
    <div className="w-full flex flex-col justify-center items-start">
      <Link
        className="block leading-tight hover:opacity-80 rounded-md transition-colors truncate text-muted-foreground"
        to={`/u/${encodeURIComponent(creator.username)}`}
        viewTransition
      >
        {creator.displayName || creator.username}
      </Link>
      <button
        type="button"
        className="w-auto -mt-0.5 text-xs leading-tight text-muted-foreground select-none cursor-pointer hover:opacity-80 transition-colors text-left"
        onClick={onGotoDetail}
      >
        {displayTime}
      </button>
    </div>
  </div>
);

interface TimeDisplayProps {
  displayTime: React.ReactNode;
  onGotoDetail: () => void;
}

const TimeDisplay: React.FC<TimeDisplayProps> = ({ displayTime, onGotoDetail }) => (
  <button
    type="button"
    className="w-full text-sm leading-tight text-muted-foreground select-none cursor-pointer hover:text-foreground transition-colors text-left"
    onClick={onGotoDetail}
  >
    {displayTime}
  </button>
);

export default MemoHeader;
