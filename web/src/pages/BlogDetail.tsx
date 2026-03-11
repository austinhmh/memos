import { useParams, useNavigate } from "react-router-dom";
import { useMemo as useMemoQuery, useUpdateMemo } from "@/hooks/useMemoQueries";
import { memoNamePrefix } from "@/helpers/resource-names";
import useCurrentUser from "@/hooks/useCurrentUser";
import { isSuperUser } from "@/utils/user";
import { Suspense, useCallback } from "react";
import { toast } from "react-hot-toast";
import VisibilityIcon from "@/components/VisibilityIcon";
import MemoActionMenu from "@/components/MemoActionMenu";
import { CheckIcon, ChevronDownIcon } from "lucide-react";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from "@/components/ui/dropdown-menu";
import { lazyWithRetry } from "@/router/lazyWithRetry";
import { Visibility } from "@/types/proto/api/v1/memo_service_pb";
import { useTranslate } from "@/utils/i18n";
import { AttachmentList } from "@/components/MemoView/components/metadata";

const BlogEditor = lazyWithRetry(() => import("@/components/BlogEditor"), "BlogEditor");

const BLOG_TAG = "#blog";

function ensureBlogTag(content: string): string {
  const tagPattern = /(?:^|\s)#blog(?:\s|$)/m;
  if (tagPattern.test(content)) return content;
  const trimmed = content.replace(/\n+$/, "");
  return trimmed + "\n\n" + BLOG_TAG + "\n";
}

const BlogDetail = () => {
  const params = useParams();
  const navigate = useNavigate();
  const uid = params.uid;
  const memoName = `${memoNamePrefix}${uid}`;
  const currentUser = useCurrentUser();
  const t = useTranslate();
  const updateMetadataMemo = useUpdateMemo();

  const { data: memo, isLoading, error } = useMemoQuery(memoName, { enabled: !!memoName });

  const isOwner = !!currentUser && memo?.creator === currentUser?.name;
  const canEdit = isOwner || (!!currentUser && isSuperUser(currentUser));
  const readonly = !canEdit;

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
      <div className="w-full max-w-4xl mx-auto flex items-center justify-center py-20">
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
    <div className="w-full max-w-4xl mx-auto">
      <div className="flex items-center justify-between px-1 py-3 mb-2 border-b border-border">
        <h1 className="text-lg font-semibold truncate flex-1 mr-4">{titleLine}</h1>
        <div className="flex items-center gap-2 shrink-0">
          {canEdit ? (
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <button
                  className="inline-flex items-center px-2 py-1 text-sm text-muted-foreground rounded-md hover:bg-accent transition-colors"
                  data-testid="visibility-selector"
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
            <div className="inline-flex items-center px-2 py-1 text-sm text-muted-foreground" data-testid="visibility-readonly">
              <VisibilityIcon visibility={memo.visibility} className="opacity-60 mr-1.5" />
              <span>{visibilityOptions.find((o) => o.value === memo.visibility)?.label}</span>
            </div>
          )}
          <MemoActionMenu memo={memo} readonly={readonly} isDetailPage deleteSuccessPath="/blog" />
        </div>
      </div>

      <Suspense fallback={<div style={{ padding: "2rem", color: "#888" }}>正在加载编辑器…</div>}>
        <BlogEditor memo={memo} readonly={readonly} normalizeBeforeSave={ensureBlogTag} />
      </Suspense>

      {memo.attachments.length > 0 && (
        <div className="mt-4">
          <AttachmentList attachments={memo.attachments} />
        </div>
      )}
    </div>
  );
};

export default BlogDetail;
