import { PlusIcon } from "lucide-react";
import { useCallback, useMemo } from "react";
import { useNavigate } from "react-router-dom";
import { toast } from "react-hot-toast";
import { create } from "@bufbuild/protobuf";
import { Button } from "@/components/ui/button";
import VisibilityIcon from "@/components/VisibilityIcon";
import { useMemoFilters } from "@/hooks";
import useCurrentUser from "@/hooks/useCurrentUser";
import { useMemos, useCreateMemo } from "@/hooks/useMemoQueries";
import { cn } from "@/lib/utils";
import { MemoSchema, Visibility } from "@/types/proto/api/v1/memo_service_pb";
import { useTranslate } from "@/utils/i18n";

const BLOG_FILTER = `tag in ["blog"]`;

const BlogHome = () => {
  const currentUser = useCurrentUser();
  const navigate = useNavigate();
  const createMemo = useCreateMemo();
  const t = useTranslate();
  const contextualFilter = useMemoFilters({ includeShortcuts: false, includePinned: false });
  const blogFilter = useMemo(
    () => (contextualFilter ? `${BLOG_FILTER} && ${contextualFilter}` : BLOG_FILTER),
    [contextualFilter],
  );

  const { data } = useMemos({
    filter: blogFilter,
    pageSize: 50,
    orderBy: "update_time desc",
  });

  const memos = data?.memos ?? [];

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
            return (
              <button
                key={memo.name}
                type="button"
                className={cn(
                  "w-full text-left px-5 py-4 rounded-lg border border-border bg-card",
                  "hover:border-primary/30 hover:shadow-sm transition-all cursor-pointer",
                )}
                onClick={() => navigate(`/memos/${uid}`)}
              >
                <div className="flex items-center gap-2 mb-1">
                  <h3 className="text-base font-semibold flex-1 truncate">{title}</h3>
                  <span className="inline-flex items-center gap-1 text-xs text-muted-foreground shrink-0">
                    <VisibilityIcon visibility={memo.visibility} className="w-3.5 h-3.5" />
                    <span>{t(`memo.visibility.${Visibility[memo.visibility]?.toLowerCase() || "private"}` as Parameters<typeof t>[0])}</span>
                  </span>
                </div>
                {preview && <p className="text-sm text-muted-foreground line-clamp-2">{preview}</p>}
              </button>
            );
          })}
        </div>
      )}
    </div>
  );
};

export default BlogHome;
