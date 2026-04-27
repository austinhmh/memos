import { create } from "@bufbuild/protobuf";
import { CheckIcon, ChevronDownIcon, PlusIcon } from "lucide-react";
import { useCallback, useMemo } from "react";
import { toast } from "react-hot-toast";
import { useNavigate } from "react-router-dom";
import { Button } from "@/components/ui/button";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from "@/components/ui/dropdown-menu";
import VisibilityIcon from "@/components/VisibilityIcon";
import { useMemoFilters } from "@/hooks";
import useCurrentUser from "@/hooks/useCurrentUser";
import { useCreateMemo, useMemos, useUpdateMemo } from "@/hooks/useMemoQueries";
import { cn } from "@/lib/utils";
import { MemoSchema, Visibility } from "@/types/proto/api/v1/memo_service_pb";
import { getAttachmentThumbnailUrl, getAttachmentType, getAttachmentUrl } from "@/utils/attachment";
import { useTranslate } from "@/utils/i18n";
import { isSuperUser } from "@/utils/user";

const BLOG_FILTER = `tag in ["blog"]`;

const BlogHome = () => {
  const currentUser = useCurrentUser();
  const navigate = useNavigate();
  const createMemo = useCreateMemo();
  const updateMemo = useUpdateMemo({ syncListCaches: true });
  const t = useTranslate();
  const contextualFilter = useMemoFilters({ includeShortcuts: false, includePinned: false });
  const blogFilter = useMemo(() => (contextualFilter ? `${BLOG_FILTER} && ${contextualFilter}` : BLOG_FILTER), [contextualFilter]);

  const { data } = useMemos({
    filter: blogFilter,
    pageSize: 50,
    orderBy: "update_time desc",
  });

  const memos = data?.memos ?? [];
  const visibilityOptions = [
    { value: Visibility.PRIVATE, label: t("memo.visibility.private") },
    { value: Visibility.PROTECTED, label: t("memo.visibility.protected") },
    { value: Visibility.PUBLIC, label: t("memo.visibility.public") },
  ] as const;

  const handleVisibilityChange = useCallback(
    async (memoName: string, visibility: Visibility) => {
      try {
        await updateMemo.mutateAsync({
          update: { name: memoName, visibility },
          updateMask: ["visibility"],
        });
        toast.success("权限已更新");
      } catch (err) {
        console.error("Failed to update visibility:", err);
        toast.error("权限更新失败");
      }
    },
    [updateMemo],
  );

  const handleNewDoc = useCallback(async () => {
    if (!currentUser) return;
    try {
      const now = new Date();
      const ts = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}-${String(now.getDate()).padStart(2, "0")} ${String(now.getHours()).padStart(2, "0")}:${String(now.getMinutes()).padStart(2, "0")}`;
      const memo = await createMemo.mutateAsync(
        create(MemoSchema, {
          content: `# Untitled ${ts}\n\n#blog\n`,
          visibility: Visibility.PRIVATE,
        }),
      );
      const uid = memo.name.split("/").pop();
      navigate(`/memos/${uid}`);
    } catch (err) {
      toast.error("Failed to create document");
      console.error(err);
    }
  }, [currentUser, navigate, createMemo]);

  return (
    <div className="w-full max-w-4xl mx-auto">
      <div className="flex items-center justify-between mb-6">
        <h1 className="text-2xl font-bold">Writing</h1>
        <Button onClick={handleNewDoc}>
          <PlusIcon className="w-4 h-4 mr-2" />
          New Article
        </Button>
      </div>

      {memos.length === 0 ? (
        <div className="flex flex-col items-center justify-center py-20 text-muted-foreground">
          <p className="text-lg mb-4">No articles yet</p>
          <Button variant="outline" onClick={handleNewDoc}>
            <PlusIcon className="w-4 h-4 mr-2" />
            Write your first article
          </Button>
        </div>
      ) : (
        <div className="flex flex-col gap-2">
          {memos.map((memo) => {
            const uid = memo.name.split("/").pop();
            const lines = memo.content.split("\n");
            const title = lines[0].replace(/^#+\s*/, "") || "Untitled";
            const preview = lines.slice(1).join("\n").trim().slice(0, 120);
            const coverImage = memo.attachments.find((attachment) => getAttachmentType(attachment) === "image/*");
            const canEdit = !!currentUser && (memo.creator === currentUser.name || !!isSuperUser(currentUser));
            const currentVisibilityLabel =
              visibilityOptions.find((option) => option.value === memo.visibility)?.label || t("memo.visibility.private");
            return (
              <article
                key={memo.name}
                className={cn(
                  "w-full text-left px-5 py-4 rounded-lg border border-border bg-card",
                  "hover:border-primary/30 hover:shadow-sm transition-all cursor-pointer",
                )}
                onClick={() => navigate(`/memos/${uid}`)}
              >
                <div className="flex items-start gap-4">
                  <div className="min-w-0 flex-1">
                    <div className="flex items-center gap-2 mb-1">
                      <h3 className="text-base font-semibold flex-1 truncate">{title}</h3>
                      {canEdit ? (
                        <DropdownMenu>
                          <DropdownMenuTrigger asChild>
                            <button
                              type="button"
                              className="inline-flex items-center gap-1 rounded-md px-1.5 py-1 text-xs text-muted-foreground shrink-0 hover:bg-accent hover:text-foreground transition-colors"
                              onClick={(event) => event.stopPropagation()}
                            >
                              <VisibilityIcon visibility={memo.visibility} className="w-3.5 h-3.5" />
                              <span>{currentVisibilityLabel}</span>
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
                                  if (option.value !== memo.visibility) {
                                    handleVisibilityChange(memo.name, option.value);
                                  }
                                }}
                              >
                                <VisibilityIcon visibility={option.value} />
                                <span className="flex-1">{option.label}</span>
                                {memo.visibility === option.value && <CheckIcon className="w-4 h-4 text-primary" />}
                              </DropdownMenuItem>
                            ))}
                          </DropdownMenuContent>
                        </DropdownMenu>
                      ) : (
                        <span className="inline-flex items-center gap-1 text-xs text-muted-foreground shrink-0">
                          <VisibilityIcon visibility={memo.visibility} className="w-3.5 h-3.5" />
                          <span>{currentVisibilityLabel}</span>
                        </span>
                      )}
                    </div>
                    {preview && <p className="text-sm text-muted-foreground line-clamp-2">{preview}</p>}
                  </div>
                  {coverImage && (
                    <img
                      src={getAttachmentThumbnailUrl(coverImage)}
                      alt={coverImage.filename}
                      className="w-24 h-16 sm:w-32 sm:h-20 rounded-md object-cover border border-border bg-muted shrink-0"
                      loading="lazy"
                      decoding="async"
                      onError={(event) => {
                        const target = event.currentTarget;
                        const fallbackUrl = getAttachmentUrl(coverImage);
                        if (target.src !== fallbackUrl) {
                          target.src = fallbackUrl;
                        }
                      }}
                    />
                  )}
                </div>
              </article>
            );
          })}
        </div>
      )}
    </div>
  );
};

export default BlogHome;
