import { timestampDate } from "@bufbuild/protobuf/wkt";
import { ConnectError } from "@connectrpc/connect";
import { ArrowLeftIcon, MessageCircleIcon } from "lucide-react";
import { Suspense, useCallback, useMemo as useReactMemo, useRef, useState } from "react";
import { toast } from "react-hot-toast";
import { Link, useLocation, useParams } from "react-router-dom";
import { MemoDetailSidebar, MemoDetailSidebarDrawer } from "@/components/MemoDetailSidebar";
import MemoEditor from "@/components/MemoEditor";
import MemoTableOfContents from "@/components/MemoTableOfContents";
import MemoView from "@/components/MemoView";
import { AttachmentList } from "@/components/MemoView/components/metadata";
import { MemoViewContext } from "@/components/MemoView/MemoViewContext";
import MobileHeader from "@/components/MobileHeader";
import { Button } from "@/components/ui/button";
import { memoNamePrefix } from "@/helpers/resource-names";
import useCurrentUser from "@/hooks/useCurrentUser";
import useMediaQuery from "@/hooks/useMediaQuery";
import { useMemo, useMemoComments } from "@/hooks/useMemoQueries";
import useNavigateTo from "@/hooks/useNavigateTo";
import { useUser } from "@/hooks/useUserQueries";
import i18n from "@/i18n";
import { MarkdownRenderer } from "@/lib/markdown/MarkdownRenderer";
import { lazyWithRetry } from "@/router/lazyWithRetry";
import { State } from "@/types/proto/api/v1/common_pb";
import { useTranslate } from "@/utils/i18n";
import { isSuperUser } from "@/utils/user";

const BlogEditor = lazyWithRetry(() => import("@/components/BlogEditor"), "BlogEditor");

const MemoDetail = () => {
  const t = useTranslate();
  const md = useMediaQuery("md");
  const params = useParams();
  const navigateTo = useNavigateTo();
  const { state: locationState } = useLocation();
  const currentUser = useCurrentUser();
  const uid = params.uid;
  const memoName = `${memoNamePrefix}${uid}`;
  const [showCommentEditor, setShowCommentEditor] = useState(false);

  // Resizable panels
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

  const { data: memo, error, isLoading } = useMemo(memoName, { enabled: !!memoName });

  const lockedMemoRef = useRef(memo);
  if (memo && (!lockedMemoRef.current || lockedMemoRef.current.name !== memo.name)) {
    lockedMemoRef.current = memo;
  }
  const stableMemo = lockedMemoRef.current ?? memo;

  if (error) {
    toast.error((error as ConnectError).message);
    navigateTo("/403");
  }

  const { data: parentMemo } = useMemo(memo?.parent || "", {
    enabled: !!memo?.parent,
  });

  const { data: commentsResponse } = useMemoComments(memoName, {
    enabled: !!memo,
  });
  const comments = commentsResponse?.memos || [];

  const creator = useUser(memo?.creator || "").data;
  const isArchived = memo?.state === State.ARCHIVED;
  const canEdit = !!currentUser && (memo?.creator === currentUser?.name || isSuperUser(currentUser)) && !isArchived;

  const handleBack = useCallback(() => {
    if (locationState?.from) {
      navigateTo(locationState.from);
    } else {
      navigateTo("/");
    }
  }, [locationState, navigateTo]);

  const showCreateCommentButton = currentUser && !showCommentEditor;

  const memoViewContextValue = useReactMemo(
    () =>
      memo
        ? {
            memo,
            creator,
            currentUser,
            parentPage: locationState?.from || "/",
            isArchived,
            readonly: !canEdit,
            showNSFWContent: true,
            nsfw: false,
          }
        : null,
    [memo, creator, currentUser, locationState?.from, isArchived, canEdit],
  );

  if (!memo) {
    if (isLoading) {
      return (
        <section className="@container w-full max-w-3xl mx-auto min-h-full flex items-center justify-center pt-20">
          <p className="text-muted-foreground">正在加载…</p>
        </section>
      );
    }
    return null;
  }

  const displayTime = memo.displayTime ? timestampDate(memo.displayTime) : undefined;

  return (
    <section className="@container w-full min-h-full flex flex-col overflow-x-hidden">
      {!md && (
        <MobileHeader>
          <MemoDetailSidebarDrawer memo={memo} parentPage={locationState?.from} />
        </MobileHeader>
      )}

      {/* Top bar */}
      <div className="w-full flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between px-4 sm:px-6 pt-3 md:pt-6 pb-2 min-w-0">
        <button
          type="button"
          className="flex min-w-0 items-center gap-1 text-sm text-muted-foreground hover:text-foreground transition-colors cursor-pointer"
          onClick={handleBack}
        >
          <ArrowLeftIcon className="w-4 h-4 shrink-0" />
          <span className="truncate">Back</span>
        </button>
        <div className="flex items-center gap-3 min-w-0 sm:justify-end">
          {creator && (
            <Link
              className="flex min-w-0 items-center gap-1.5 hover:opacity-80"
              to={`/u/${encodeURIComponent(creator.username)}`}
              viewTransition
            >
              <span className="min-w-0 truncate text-sm text-muted-foreground">{creator.displayName || creator.username}</span>
            </Link>
          )}
          <span className="text-xs text-muted-foreground shrink-0">
            <relative-time datetime={displayTime?.toISOString()} lang={i18n.language} format="auto"></relative-time>
          </span>
        </div>
      </div>

      {/* Parent memo link */}
      {parentMemo && (
        <div className="w-full px-4 sm:px-6 mb-3">
          <Link
            className="inline-flex max-w-full items-center px-3 py-1 border border-border rounded-lg text-sm text-muted-foreground hover:shadow hover:opacity-80"
            to={`/${parentMemo.name}`}
            state={locationState}
            viewTransition
          >
            <ArrowLeftIcon className="w-4 h-auto shrink-0 opacity-60 mr-2" />
            <span className="truncate">{parentMemo.content.split("\n")[0]}</span>
          </Link>
        </div>
      )}

      {/* Three-column layout */}
      <div ref={containerRef} className="flex-1 flex min-h-0 w-full overflow-x-hidden">
        {/* Left: TOC */}
        {md && (
          <>
            <div
              className="shrink-0 sticky top-0 self-start max-h-svh overflow-y-auto hide-scrollbar pt-4 px-3"
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
        <div className="flex-1 min-w-0 px-4 sm:px-6 pb-8 md:overflow-y-auto">
          <MemoViewContext.Provider value={memoViewContextValue}>
            <div className="w-full">
              {canEdit ? (
                <Suspense
                  fallback={
                    <div style={{ padding: "2rem", color: "#888" }}>
                      <p>正在加载文档…</p>
                    </div>
                  }
                >
                  <BlogEditor memo={stableMemo ?? memo} readonly={false} />
                </Suspense>
              ) : (
                <div className="blog-editor">
                  <div className="blog-editor-content ProseMirror">
                    <MarkdownRenderer content={memo.content} />
                  </div>
                </div>
              )}
            </div>
          </MemoViewContext.Provider>
        </div>

        {/* Right: metadata + attachments + comments */}
        {md && (
          <>
            <div
              className="shrink-0 w-1 cursor-col-resize hover:bg-primary/30 transition-colors"
              onMouseDown={() => handleMouseDown("right")}
            />
            <div
              className="shrink-0 sticky top-0 self-start max-h-svh overflow-y-auto hide-scrollbar pt-4 px-3"
              style={{ width: `${rightWidth}%` }}
            >
              <MemoDetailSidebar className="py-2" memo={memo} parentPage={locationState?.from} />

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
                        parentPage={locationState?.from}
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

      {/* Mobile: sidebar + attachments + comments inline */}
      {!md && (
        <div className="w-full px-4 sm:px-6">
          <div className="mt-4 pt-4 border-t border-border">
            <MemoDetailSidebar className="py-2" memo={memo} parentPage={locationState?.from} />
          </div>

          {memo.attachments.length > 0 && (
            <div className="mt-4">
              <AttachmentList attachments={memo.attachments} />
            </div>
          )}
          <div className="pt-6 pb-16 w-full">
            <div className="relative mx-auto grow w-full flex flex-col justify-start items-start gap-y-1">
              {comments.length === 0 ? (
                <>
                  {showCreateCommentButton && (
                    <div className="w-full flex flex-row justify-center items-center py-6">
                      <Button variant="ghost" onClick={() => setShowCommentEditor(true)}>
                        <span className="text-muted-foreground">{t("memo.comment.write-a-comment")}</span>
                        <MessageCircleIcon className="ml-2 w-5 h-auto text-muted-foreground" />
                      </Button>
                    </div>
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
                </>
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
                      parentPage={locationState?.from}
                      showCreator
                      compact
                    />
                  ))}
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
                </>
              )}
            </div>
          </div>
        </div>
      )}
    </section>
  );
};

export default MemoDetail;
