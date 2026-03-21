import { useParams, useNavigate, useLocation } from "react-router-dom";
import { useMemo as useMemoQuery, useMemoComments, useUpdateMemo } from "@/hooks/useMemoQueries";
import { memoNamePrefix } from "@/helpers/resource-names";
import useCurrentUser from "@/hooks/useCurrentUser";
import { useUser } from "@/hooks/useUserQueries";
import { isSuperUser } from "@/utils/user";
import { Suspense, useCallback, useRef, useState } from "react";
import { toast } from "react-hot-toast";
import VisibilityIcon from "@/components/VisibilityIcon";
import MemoActionMenu from "@/components/MemoActionMenu";
import MemoView from "@/components/MemoView";
import MemoTableOfContents from "@/components/MemoTableOfContents";
import MemoEditor from "@/components/MemoEditor";
import { MemoDetailSidebar } from "@/components/MemoDetailSidebar";
import { ArrowLeftIcon, CheckIcon, ChevronDownIcon, ChevronLeftIcon, ChevronRightIcon, MessageCircleIcon } from "lucide-react";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from "@/components/ui/dropdown-menu";
import { Button } from "@/components/ui/button";
import { lazyWithRetry } from "@/router/lazyWithRetry";
import { Visibility } from "@/types/proto/api/v1/memo_service_pb";
import { useTranslate } from "@/utils/i18n";
import useMediaQuery from "@/hooks/useMediaQuery";
import { cn } from "@/lib/utils";
import { AttachmentList } from "@/components/MemoView/components/metadata";

const BlogEditor = lazyWithRetry(() => import("@/components/BlogEditor"), "BlogEditor");

const BLOG_TAG = "#blog";
const PANEL_CLOSE_DELAY = 200;

function ensureBlogTag(content: string): string {
  const tagPattern = /(?:^|\s)#blog(?:\s|$)/m;
  if (tagPattern.test(content)) return content;
  const trimmed = content.replace(/\n+$/, "");
  return trimmed + "\n\n" + BLOG_TAG + "\n";
}

function useHoverPanel() {
  const [open, setOpen] = useState(false);
  const timerRef = useRef<ReturnType<typeof setTimeout>>();

  const onEnter = useCallback(() => {
    clearTimeout(timerRef.current);
    setOpen(true);
  }, []);

  const onLeave = useCallback(() => {
    timerRef.current = setTimeout(() => setOpen(false), PANEL_CLOSE_DELAY);
  }, []);

  return { open, onEnter, onLeave } as const;
}

const BlogDetail = () => {
  const params = useParams();
  const navigate = useNavigate();
  const { state: locationState } = useLocation();
  const uid = params.uid;
  const memoName = `${memoNamePrefix}${uid}`;
  const currentUser = useCurrentUser();
  const t = useTranslate();
  const md = useMediaQuery("md");
  const lgLayout = useMediaQuery("lg");
  const updateMetadataMemo = useUpdateMemo();
  const [showCommentEditor, setShowCommentEditor] = useState(false);

  const leftPanel = useHoverPanel();
  const rightPanel = useHoverPanel();

  const { data: memo, isLoading, error } = useMemoQuery(memoName, { enabled: !!memoName });
  const { data: commentsResponse } = useMemoComments(memoName, { enabled: !!memo });
  const comments = commentsResponse?.memos || [];

  const creator = useUser(memo?.creator || "").data;
  const isOwner = !!currentUser && memo?.creator === currentUser?.name;
  const canEdit = isOwner || (!!currentUser && isSuperUser(currentUser));
  const readonly = !canEdit;
  const showCreateCommentButton = currentUser && !showCommentEditor;

  // BlogLayout explorer right edge: nav(4rem) + explorer(18rem lg / 14rem md)
  const tocLeft = lgLayout ? "22rem" : "18rem";

  const handleBack = useCallback(() => {
    if (locationState?.from) {
      navigate(locationState.from);
    } else {
      navigate("/blog");
    }
  }, [locationState, navigate]);

  const handleVisibilityChange = useCallback(
    async (visibility: Visibility) => {
      if (!memo?.name || !canEdit) return;
      try {
        await updateMetadataMemo.mutateAsync({
          update: { name: memo.name, visibility },
          updateMask: ["visibility"],
        });
        toast.success("权限已更新");
      } catch (err) {
        console.error("Failed to update visibility:", err);
        toast.error("权限更新失败");
      }
    },
    [memo?.name, canEdit, updateMetadataMemo],
  );

  if (error) {
    const code = (error as any)?.code;
    if (code === 16 || code === 7) {
      navigate("/403", { replace: true });
      return null;
    }
    navigate("/404", { replace: true });
    return null;
  }

  if (isLoading || !memo) {
    return (
      <div className="w-full flex items-center justify-center py-20">
        <div className="animate-spin w-6 h-6 border-2 border-primary border-t-transparent rounded-full" />
      </div>
    );
  }

  const titleLine = memo.content.split("\n")[0].replace(/^#+\s*/, "") || "Untitled";

  const visibilityOptions = [
    { value: Visibility.PRIVATE, label: t("memo.visibility.private") },
    { value: Visibility.PROTECTED, label: t("memo.visibility.protected") },
    { value: Visibility.PUBLIC, label: t("memo.visibility.public") },
  ] as const;

  return (
    <>
      {/* Center content */}
      <div className="w-full px-4 sm:px-6 md:px-10 sm:pt-3 md:pt-6 pb-8">
        {/* Top bar */}
        <div className="flex items-center justify-between mb-4">
          <button
            type="button"
            className="flex items-center gap-1 text-sm text-muted-foreground hover:text-foreground transition-colors cursor-pointer"
            onClick={handleBack}
          >
            <ArrowLeftIcon className="w-4 h-4" />
            <span>Back</span>
          </button>

          <div className="flex items-center gap-2 shrink-0">
            {canEdit ? (
              <DropdownMenu>
                <DropdownMenuTrigger asChild>
                  <button className="inline-flex items-center px-2 py-1 text-sm text-muted-foreground rounded-md hover:bg-accent transition-colors">
                    <VisibilityIcon visibility={memo.visibility} className="opacity-60 mr-1.5" />
                    <span>{visibilityOptions.find((o) => o.value === memo.visibility)?.label}</span>
                    <ChevronDownIcon className="ml-0.5 w-4 h-4 opacity-60" />
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
              <div className="inline-flex items-center px-2 py-1 text-sm text-muted-foreground">
                <VisibilityIcon visibility={memo.visibility} className="opacity-60 mr-1.5" />
                <span>{visibilityOptions.find((o) => o.value === memo.visibility)?.label}</span>
              </div>
            )}
            <MemoActionMenu memo={memo} readonly={readonly} isDetailPage deleteSuccessPath="/blog" />
          </div>
        </div>

        {/* Title */}
        <h1 className="text-2xl font-bold mb-4">{titleLine}</h1>

        {/* Editor */}
        <Suspense fallback={<div style={{ padding: "2rem", color: "#888" }}>正在加载编辑器…</div>}>
          <BlogEditor memo={memo} readonly={readonly} normalizeBeforeSave={ensureBlogTag} />
        </Suspense>

        {/* Mobile: inline attachments + comments */}
        {!md && (
          <>
            {memo.attachments.length > 0 && (
              <div className="mt-4">
                <AttachmentList attachments={memo.attachments} />
              </div>
            )}
            <div className="pt-6 pb-16 w-full">
              <div className="relative mx-auto grow w-full flex flex-col justify-start items-start gap-y-1">
                {comments.length === 0 ? (
                  showCreateCommentButton && (
                    <div className="w-full flex flex-row justify-center items-center py-6">
                      <Button variant="ghost" onClick={() => setShowCommentEditor(true)}>
                        <span className="text-muted-foreground">{t("memo.comment.write-a-comment")}</span>
                        <MessageCircleIcon className="ml-2 w-5 h-auto text-muted-foreground" />
                      </Button>
                    </div>
                  )
                ) : (
                  <>
                    <div className="w-full flex flex-row justify-between items-center h-8 pl-3 mb-2">
                      <div className="flex flex-row justify-start items-center">
                        <MessageCircleIcon className="w-5 h-auto text-muted-foreground mr-1" />
                        <span className="text-muted-foreground text-sm">{t("memo.comment.self")}</span>
                        <span className="text-muted-foreground text-sm ml-1">({comments.length})</span>
                      </div>
                      {showCreateCommentButton && (
                        <Button variant="ghost" className="text-muted-foreground text-xs" onClick={() => setShowCommentEditor(true)}>
                          {t("memo.comment.write-a-comment")}
                        </Button>
                      )}
                    </div>
                    {comments.map((comment) => (
                      <MemoView
                        key={`${comment.name}-${comment.displayTime}`}
                        memo={comment}
                        parentPage={locationState?.from || "/blog"}
                        showCreator
                        compact
                      />
                    ))}
                  </>
                )}
              </div>
            </div>
          </>
        )}
      </div>

      {/* ===== Left TOC hover panel (desktop only) ===== */}
      {md && (
        <div
          className={cn("fixed top-0 bottom-0 z-40", leftPanel.open ? "w-56" : "w-2")}
          style={{ left: tocLeft }}
          onMouseEnter={leftPanel.onEnter}
          onMouseLeave={leftPanel.onLeave}
        >
          {/* Trigger indicator */}
          <div
            className={cn(
              "absolute left-0 top-0 bottom-0 w-2 flex items-center justify-center transition-opacity duration-300",
              leftPanel.open ? "opacity-0" : "opacity-100",
            )}
          >
            <div className="w-0.5 h-16 rounded-full bg-border/60 group-hover:bg-primary/40 transition-colors" />
          </div>

          {/* Panel content */}
          <div
            className={cn(
              "absolute left-0 top-0 bottom-0 w-56 bg-background/95 backdrop-blur-sm border-r border-border shadow-lg",
              "overflow-y-auto hide-scrollbar pt-16 px-4",
              "transition-all duration-300 ease-in-out",
              leftPanel.open ? "opacity-100 translate-x-0" : "opacity-0 -translate-x-2 pointer-events-none",
            )}
          >
            <div className="flex items-center gap-1.5 mb-3 text-xs text-muted-foreground uppercase tracking-wider font-semibold select-none">
              <ChevronLeftIcon className="w-3.5 h-3.5" />
              <span>目录</span>
            </div>
            <MemoTableOfContents content={memo.content} />
          </div>
        </div>
      )}

      {/* ===== Right sidebar hover panel (desktop only) ===== */}
      {md && (
        <div
          className={cn("fixed top-0 bottom-0 right-0 z-40", rightPanel.open ? "w-64" : "w-2")}
          onMouseEnter={rightPanel.onEnter}
          onMouseLeave={rightPanel.onLeave}
        >
          {/* Trigger indicator */}
          <div
            className={cn(
              "absolute right-0 top-0 bottom-0 w-2 flex items-center justify-center transition-opacity duration-300",
              rightPanel.open ? "opacity-0" : "opacity-100",
            )}
          >
            <div className="w-0.5 h-16 rounded-full bg-border/60 transition-colors" />
          </div>

          {/* Panel content */}
          <div
            className={cn(
              "absolute right-0 top-0 bottom-0 w-64 bg-background/95 backdrop-blur-sm border-l border-border shadow-lg",
              "overflow-y-auto hide-scrollbar pt-16 px-4",
              "transition-all duration-300 ease-in-out",
              rightPanel.open ? "opacity-100 translate-x-0" : "opacity-0 translate-x-2 pointer-events-none",
            )}
          >
            <div className="flex items-center gap-1.5 mb-3 text-xs text-muted-foreground uppercase tracking-wider font-semibold select-none">
              <span>详情</span>
              <ChevronRightIcon className="w-3.5 h-3.5" />
            </div>

            <MemoDetailSidebar className="py-2" memo={memo} parentPage={locationState?.from || "/blog"} />

            {memo.attachments.length > 0 && (
              <div className="mt-4">
                <AttachmentList attachments={memo.attachments} />
              </div>
            )}

            {/* Comments */}
            <div className="mt-6">
              <div className="flex items-center gap-1.5 mb-2">
                <MessageCircleIcon className="w-4 h-4 text-muted-foreground opacity-60" />
                <span className="text-sm text-muted-foreground select-none">
                  {t("memo.comment.self")}
                  {comments.length > 0 && <span className="ml-1">({comments.length})</span>}
                </span>
              </div>
              {comments.length > 0 && (
                <div className="flex flex-col gap-1">
                  {comments.map((comment) => (
                    <MemoView
                      key={`${comment.name}-${comment.displayTime}`}
                      memo={comment}
                      parentPage={locationState?.from || "/blog"}
                      showCreator
                      compact
                    />
                  ))}
                </div>
              )}
              {showCreateCommentButton && (
                <Button
                  variant="ghost"
                  className="w-full mt-1 text-muted-foreground text-xs"
                  onClick={() => setShowCommentEditor(true)}
                >
                  {t("memo.comment.write-a-comment")}
                </Button>
              )}
              {showCommentEditor && (
                <div className="w-full mt-2">
                  <MemoEditor
                    cacheKey={`${memo.name}-${memo.updateTime}-comment`}
                    placeholder={t("editor.add-your-comment-here")}
                    parentMemoName={memo.name}
                    autoFocus
                    compact
                    onConfirm={async () => setShowCommentEditor(false)}
                    onCancel={() => setShowCommentEditor(false)}
                  />
                </div>
              )}
            </div>
          </div>
        </div>
      )}

    </>
  );
};

export default BlogDetail;
