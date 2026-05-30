import { create } from "@bufbuild/protobuf";
import { PlusIcon } from "lucide-react";
import { useCallback, useMemo } from "react";
import { toast } from "react-hot-toast";
import { NavLink, useNavigate } from "react-router-dom";
import TagsSection from "@/components/MemoExplorer/TagsSection";
import { Button } from "@/components/ui/button";
import { useMemoFilters } from "@/hooks";
import useCurrentUser from "@/hooks/useCurrentUser";
import { useCreateMemo, useMemos } from "@/hooks/useMemoQueries";
import { cn } from "@/lib/utils";
import { MemoSchema, Visibility } from "@/types/proto/api/v1/memo_service_pb";

interface Props {
  className?: string;
}

const BLOG_FILTER = `tag in ["blog"]`;

const BlogExplorer = ({ className }: Props) => {
  const currentUser = useCurrentUser();
  const navigate = useNavigate();
  const createMemo = useCreateMemo();
  const contextualFilter = useMemoFilters({ includeShortcuts: false, includePinned: false });
  const blogFilter = useMemo(() => (contextualFilter ? `${BLOG_FILTER} && ${contextualFilter}` : BLOG_FILTER), [contextualFilter]);

  const { data } = useMemos({
    filter: blogFilter,
    pageSize: 200,
    orderBy: "update_time desc",
  });

  const memos = data?.memos ?? [];
  const tagCount = useMemo(() => {
    const counts: Record<string, number> = {};
    for (const memo of memos) {
      for (const tag of memo.tags ?? []) {
        if (tag === "blog") {
          continue;
        }
        counts[tag] = (counts[tag] || 0) + 1;
      }
    }
    return counts;
  }, [memos]);

  const handleNewDoc = useCallback(async () => {
    if (!currentUser) return;
    try {
      const memo = await createMemo.mutateAsync(
        create(MemoSchema, {
          content: `# \n\n#blog\n`,
          visibility: Visibility.PRIVATE,
        }),
      );
      const uid = memo.name.split("/").pop();
      navigate(`/blog/${uid}`);
    } catch (err) {
      toast.error("Failed to create document");
      console.error(err);
    }
  }, [currentUser, navigate, createMemo]);

  return (
    <aside
      className={cn(
        "relative w-full h-full overflow-auto flex flex-col justify-start items-start bg-background text-sidebar-foreground",
        className,
      )}
    >
      <div className="w-full flex items-center justify-between mb-4">
        <h2 className="text-sm font-semibold text-muted-foreground uppercase tracking-wider">Documents</h2>
        <Button variant="ghost" size="icon" className="h-7 w-7" onClick={handleNewDoc} title="New document">
          <PlusIcon className="w-4 h-4" />
        </Button>
      </div>

      <div className="w-full flex flex-col gap-0.5">
        {memos.length === 0 ? (
          <p className="text-sm text-muted-foreground px-2 py-4">No documents yet. Click + to create one.</p>
        ) : (
          memos.map((memo) => {
            const uid = memo.name.split("/").pop();
            const firstLine = memo.content.split("\n")[0].replace(/^#+\s*/, "") || "Untitled";
            return (
              <NavLink
                key={memo.name}
                to={`/blog/${uid}`}
                className={({ isActive }) =>
                  cn(
                    "w-full px-3 py-2 rounded-lg text-sm transition-colors flex items-center gap-2",
                    isActive
                      ? "bg-sidebar-accent text-sidebar-accent-foreground font-medium"
                      : "text-muted-foreground hover:bg-sidebar-accent/50 hover:text-foreground",
                  )
                }
                viewTransition
              >
                <span className="truncate">{firstLine}</span>
              </NavLink>
            );
          })
        )}
      </div>

      <div className="w-full mt-4 pt-4 border-t border-border">
        <TagsSection tagCount={tagCount} />
      </div>
    </aside>
  );
};

export default BlogExplorer;
