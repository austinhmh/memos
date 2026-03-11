import { useCallback } from "react";
import { useMemoFilterContext } from "@/contexts/MemoFilterContext";
import MemoPreviewCard from "@/components/MemoPreviewCard";
import PagedMemoList from "@/components/PagedMemoList";
import { useMemoFilters, useMemoSorting } from "@/hooks";
import useCurrentUser from "@/hooks/useCurrentUser";
import { State } from "@/types/proto/api/v1/common_pb";
import { Memo, Visibility } from "@/types/proto/api/v1/memo_service_pb";

const Explore = () => {
  const currentUser = useCurrentUser();
  const { getFiltersByFactor } = useMemoFilterContext();
  const hasExplicitSearch =
    getFiltersByFactor("tagSearch").length > 0 || getFiltersByFactor("contentSearch").length > 0;

  const visibilities = currentUser ? [Visibility.PUBLIC, Visibility.PROTECTED] : [Visibility.PUBLIC];

  const memoFilter = useMemoFilters({
    includeShortcuts: false,
    includePinned: false,
    visibilities,
  });

  const { listSort: baseSort, orderBy } = useMemoSorting({
    pinnedFirst: false,
    state: State.NORMAL,
  });

  const listSort = useCallback(
    (list: Memo[]) => {
      if (hasExplicitSearch) {
        return baseSort ? baseSort(list) : list;
      }

      const filtered = list.filter((m) => !m.content.includes("#blog"));
      return baseSort ? baseSort(filtered) : filtered;
    },
    [baseSort, hasExplicitSearch],
  );

  return (
    <PagedMemoList
      renderer={(memo: Memo) => (
        <MemoPreviewCard key={`${memo.name}-${memo.updateTime}`} memo={memo} showCreator showVisibility />
      )}
      listSort={listSort}
      orderBy={orderBy}
      filter={memoFilter}
      showCreator
    />
  );
};

export default Explore;
