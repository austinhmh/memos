import { useCallback } from "react";
import MemoPreviewCard from "@/components/MemoPreviewCard";
import PagedMemoList from "@/components/PagedMemoList";
import { useMemoFilters, useMemoSorting } from "@/hooks";
import useCurrentUser from "@/hooks/useCurrentUser";
import { State } from "@/types/proto/api/v1/common_pb";
import type { Memo } from "@/types/proto/api/v1/memo_service_pb";

const Home = () => {
  const user = useCurrentUser();

  const memoFilter = useMemoFilters({
    creatorName: user?.name,
    includeShortcuts: true,
    includePinned: true,
  });

  const { listSort: baseSort, orderBy } = useMemoSorting({
    pinnedFirst: true,
    state: State.NORMAL,
  });

  const listSort = useCallback(
    (list: Memo[]) => {
      return baseSort ? baseSort(list) : list;
    },
    [baseSort],
  );

  return (
    <div className="w-full min-h-full bg-background text-foreground">
      <PagedMemoList
        renderer={(memo: Memo) => (
          <MemoPreviewCard key={`${memo.name}-${memo.displayTime}`} memo={memo} showVisibility showPinned showCreator />
        )}
        listSort={listSort}
        orderBy={orderBy}
        filter={memoFilter}
      />
    </div>
  );
};

export default Home;
