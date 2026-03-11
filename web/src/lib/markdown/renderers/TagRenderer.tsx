import { useLocation } from "react-router-dom";
import { type MemoFilter, stringifyFilters, useMemoFilterContext } from "@/contexts/MemoFilterContext";
import useNavigateTo from "@/hooks/useNavigateTo";
import { cn } from "@/lib/utils";
import { Routes } from "@/router";
import { useMemoViewContext } from "@/components/MemoView/MemoViewContext";

interface TagRendererProps {
  tag: string;
}

export const TagRenderer: React.FC<TagRendererProps> = ({ tag }) => {
  const memoViewContext = useMemoViewContext();
  const { parentPage, readonly } = memoViewContext;
  const location = useLocation();
  const navigateTo = useNavigateTo();
  const { getFiltersByFactor, removeFilter, addFilter } = useMemoFilterContext();

  const handleTagClick = (e: React.MouseEvent) => {
    if (readonly) {
      e.preventDefault();
      return;
    }
    e.stopPropagation();

    if (location.pathname.startsWith("/m")) {
      const pathname = parentPage || Routes.ROOT;
      const searchParams = new URLSearchParams();
      searchParams.set("filter", stringifyFilters([{ factor: "tagSearch", value: tag }]));
      navigateTo(`${pathname}?${searchParams.toString()}`);
      return;
    }

    const isActive = getFiltersByFactor("tagSearch").some((filter: MemoFilter) => filter.value === tag);
    if (isActive) {
      removeFilter((f: MemoFilter) => f.factor === "tagSearch" && f.value === tag);
    } else {
      removeFilter((f: MemoFilter) => f.factor === "tagSearch");
      addFilter({ factor: "tagSearch", value: tag });
    }
  };

  return (
    <span
      className={cn(
        "inline-block w-auto text-primary transition-colors",
        readonly ? "cursor-default" : "cursor-pointer hover:opacity-80",
      )}
      data-tag={tag}
      onClick={handleTagClick}
    >
      #{tag}
    </span>
  );
};
