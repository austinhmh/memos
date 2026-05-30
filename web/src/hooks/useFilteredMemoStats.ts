import { timestampDate } from "@bufbuild/protobuf/wkt";
import dayjs from "dayjs";
import { countBy } from "lodash-es";
import { useMemo } from "react";
import { useMemos } from "@/hooks/useMemoQueries";
import { useUserStats } from "@/hooks/useUserQueries";
import type { StatisticsData } from "@/types/statistics";

export interface FilteredMemoStats {
  statistics: StatisticsData;
  tags: Record<string, number>;
  loading: boolean;
}

export interface UseFilteredMemoStatsOptions {
  userName?: string;
}

export const useFilteredMemoStats = (options: UseFilteredMemoStatsOptions = {}): FilteredMemoStats => {
  const { userName } = options;

  // Fetch user stats if userName is provided
  const { data: userStats, isLoading: isLoadingUserStats } = useUserStats(userName);

  // Fetch memos for fallback computation (or when userName is not provided)
  const { data: memosResponse, isLoading: isLoadingMemos } = useMemos({});

  const data = useMemo(() => {
    const loading = isLoadingUserStats || isLoadingMemos;
    let activityStats: Record<string, number> = {};
    let tagCount: Record<string, number> = {};

    // Use backend stats for user-scoped calendars so the activity calendar covers all memos, not only the currently cached page.
    if (userName && userStats?.memoDisplayTimestamps && userStats.memoDisplayTimestamps.length > 0) {
      activityStats = countBy(
        userStats.memoDisplayTimestamps
          .map((ts) => (ts ? timestampDate(ts) : undefined))
          .filter((date): date is Date => date !== undefined)
          .map((date) => dayjs(date).format("YYYY-MM-DD")),
      );
    } else if (memosResponse?.memos) {
      const updateTimeList: Date[] = [];
      const memos = memosResponse.memos;

      for (const memo of memos) {
        const updateTime = memo.updateTime ? timestampDate(memo.updateTime) : undefined;
        if (updateTime) {
          updateTimeList.push(updateTime);
        }
      }

      activityStats = countBy(updateTimeList.map((date) => dayjs(date).format("YYYY-MM-DD")));
    }

    // Try to use backend user stats for tag counts if userName is provided and available
    if (userName && userStats?.tagCount) {
      tagCount = userStats.tagCount;
    } else if (memosResponse?.memos) {
      // Fallback: compute tags from memos if backend stats not available
      // Also used for Explore and Archived contexts
      for (const memo of memosResponse.memos) {
        if (memo.tags && memo.tags.length > 0) {
          for (const tag of memo.tags) {
            tagCount[tag] = (tagCount[tag] || 0) + 1;
          }
        }
      }
    }

    return {
      statistics: { activityStats },
      tags: tagCount,
      loading,
    };
  }, [userName, userStats, memosResponse, isLoadingUserStats, isLoadingMemos]);

  return data;
};
