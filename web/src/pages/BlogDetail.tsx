import { ArrowLeftIcon, CheckIcon, ChevronDownIcon, MessageCircleIcon } from "lucide-react";
import { Suspense, useCallback, useRef, useState } from "react";
import { toast } from "react-hot-toast";
import { useLocation, useNavigate, useParams } from "react-router-dom";
import MemoActionMenu from "@/components/MemoActionMenu";
import { MemoDetailSidebar } from "@/components/MemoDetailSidebar";
import MemoEditor from "@/components/MemoEditor";
import MemoTableOfContents from "@/components/MemoTableOfContents";
import MemoView from "@/components/MemoView";
import { AttachmentList } from "@/components/MemoView/components/metadata";
import { Button } from "@/components/ui/button";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from "@/components/ui/dropdown-menu";
import VisibilityIcon from "@/components/VisibilityIcon";
import { memoNamePrefix } from "@/helpers/resource-names";
import useCurrentUser from "@/hooks/useCurrentUser";
import useMediaQuery from "@/hooks/useMediaQuery";
import { useMemoComments, useMemo as useMemoQuery, useUpdateMemo } from "@/hooks/useMemoQueries";
import { MarkdownRenderer } from "@/lib/markdown/MarkdownRenderer";
import { lazyWithRetry } from "@/router/lazyWithRetry";
import { Visibility } from "@/types/proto/api/v1/memo_service_pb";
import { useTranslate } from "@/utils/i18n";
import { isSuperUser } from "@/utils/user";

const BlogEditor = lazyWithRetry(() => import("@/components/BlogEditor"), "BlogEditor");

const BlogDetail = () => {
  const params = useParams();
  const navigate = useNavigate();
  const { state: locationState } = useLocation();
  const uid = params.uid;
  const memoName = `${memoNamePrefix}${uid}`;
  const currentUser = useCurrentUser();
  const t = useTranslate();
  const md = useMediaQuery("md");
  const updateMetadataMemo = useUpdateMemo();
  const [showCommentEditor, setShowCommentEditor] = useState(false);

  // Resizable three-column panels
  const [leftWidth, setLeftWidth] = useState(20);
  const [rightWidth, setRightWidth] = useState(20);
  const draggingRef = useRef<"left" | "right" | null>(null);
  const containerRef = useRef<HTMLDivElement>(null);

  const handleMouseDown = useCallback((side: "left" | "right") => {
    draggingRef.current = side;
    const onMouseMove = (e: MouseEvent) => {
      if (!containerRef.current || !draggingRef.current) return;
      const rect = containerRef.current.getBoundingClientRect();
      const pct = ((e.clientX - rect.left) / rect.width) * 100;
      if (draggingRef.current === "left") {
        setLeftWidth(Math.max(10, Math.min(35, pct)));
      } else {
        setRightWidth(Math.max(10, Math.min(35, 100 - pct)));
      }
    };
    const onMouseUp = () => {
      draggingRef.current = null;
      window.removeEventListener("mousemove", onMouseMove);
      window.removeEventListener("mouseup", onMouseUp);
      document.body.style.cursor = "";
      document.body.style.userSelect = "";
    };
    document.body.style.cursor = "col-resize";
    document.body.style.userSelect = "none";
    window.addEventListener("mousemove", onMouseMove);
    window.addEventListener("mouseup", onMouseUp);
  }, []);

  const { data: memo, isLoading, error } = useMemoQuery(memoName, { enabled: !!memoName });
  const { data: commentsResponse } = useMemoComments(memoName, { enabled: !!memo });
  const comments = commentsResponse?.memos || [];

  const isOwner = !!currentUser && memo?.creator === currentUser?.name;
  const canEdit = isOwner || (!!currentUser && isSuperUser(currentUser));
  const readonly = !canEdit;
  const showCreateCommentButton = currentUser && !showCommentEditor;

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
    const code = (error as { code?: number })?.code;
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
    <section className="@container w-full min-h-full flex flex-col">
      {/* Top bar */}
      <div className="w-full flex items-center justify-between px-4 sm:px-6 pt-3 md:pt-6 pb-2">
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
                <button
                  type="button"
                  className="inline-flex items-center px-2 py-1 text-sm text-muted-foreground rounded-md hover:bg-accent transition-colors"
                >
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

      {/* Three-column layout */}
      <div ref={containerRef} className="flex-1 flex min-h-0 w-full">
        {/* Left: TOC */}
        {md && (
          <>
            <div
              className="shrink-0 sticky top-0 self-start max-h-screen overflow-y-auto hide-scrollbar pt-4 px-3"
              style={{ width: `${leftWidth}%` }}
            >
              <MemoTableOfContents content={memo.content} />
            </div>
            <div
              className="shrink-0 w-1 cursor-col-resize hover:bg-primary/30 transition-colors"
              onMouseDown={() => handleMouseDown("left")}
            />
          </>
        )}

        {/* Center: main content */}
        <div className="flex-1 min-w-0 px-4 sm:px-6 pb-8 overflow-y-auto">
          <h1 className="text-2xl font-bold mb-4">{titleLine}</h1>

          {canEdit ? (
            <Suspense fallback={<div style={{ padding: "2rem", color: "#888" }}>正在加载文档…</div>}>
              <BlogEditor memo={memo} readonly={false} />
            </Suspense>
          ) : (
            <div className="blog-editor">
              <div className="blog-editor-content ProseMirror">
                <MarkdownRenderer content={memo.content} />
              </div>
            </div>
          )}

          {/* Mobile: sidebar + attachments + comments */}
          {!md && (
            <>
              <div className="mt-6 pt-4 border-t border-border">
                <MemoDetailSidebar className="py-2" memo={memo} parentPage={locationState?.from || "/blog"} />
              </div>

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

        {/* Right: metadata + attachments + comments */}
        {md && (
          <>
            <div
              className="shrink-0 w-1 cursor-col-resize hover:bg-primary/30 transition-colors"
              onMouseDown={() => handleMouseDown("right")}
            />
            <div
              className="shrink-0 sticky top-0 self-start max-h-screen overflow-y-auto hide-scrollbar pt-4 px-3"
              style={{ width: `${rightWidth}%` }}
            >
              <MemoDetailSidebar className="py-2" memo={memo} parentPage={locationState?.from || "/blog"} />

              {memo.attachments.length > 0 && (
                <div className="mt-4">
                  <AttachmentList attachments={memo.attachments} />
                </div>
              )}

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
                  <Button variant="ghost" className="w-full mt-1 text-muted-foreground text-xs" onClick={() => setShowCommentEditor(true)}>
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
          </>
        )}
      </div>
    </section>
  );
};

export default BlogDetail;
