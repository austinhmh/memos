import { create } from "@bufbuild/protobuf";
import { FieldMaskSchema } from "@bufbuild/protobuf/wkt";
import { type InfiniteData, type QueryClient, useInfiniteQuery, useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { memoServiceClient } from "@/connect";
import { userKeys } from "@/hooks/useUserQueries";
import type { ListMemosRequest, ListMemosResponse, Memo } from "@/types/proto/api/v1/memo_service_pb";
import { ListMemosRequestSchema, MemoSchema } from "@/types/proto/api/v1/memo_service_pb";

interface UseUpdateMemoOptions {
  invalidateListsOnSuccess?: boolean;
  invalidateUserStatsOnSuccess?: boolean;
  syncListCaches?: boolean;
}

function replaceMemoInListResponse(response: ListMemosResponse | undefined, updatedMemo: Memo) {
  if (!response?.memos?.length) {
    return response;
  }

  let changed = false;
  const memos = response.memos.map((memo) => {
    if (memo.name !== updatedMemo.name) {
      return memo;
    }
    changed = true;
    return updatedMemo;
  });

  return changed ? { ...response, memos } : response;
}

function extractTagFilters(filter?: string): string[] {
  if (!filter) {
    return [];
  }

  return Array.from(filter.matchAll(/tag in \["([^"]+)"\]/g), (match) => match[1]);
}

function matchesKnownListFilters(updatedMemo: Memo, request?: Partial<ListMemosRequest>): boolean {
  const requiredTags = extractTagFilters(request?.filter);
  if (requiredTags.length === 0) {
    return true;
  }

  const memoTags = updatedMemo.tags ?? [];
  return requiredTags.every((tag) => memoTags.includes(tag));
}

function syncMemoInListResponse(response: ListMemosResponse | undefined, updatedMemo: Memo, request?: Partial<ListMemosRequest>) {
  if (!response?.memos?.length) {
    return response;
  }

  const exists = response.memos.some((memo) => memo.name === updatedMemo.name);
  if (!exists) {
    return response;
  }

  if (!matchesKnownListFilters(updatedMemo, request)) {
    return {
      ...response,
      memos: response.memos.filter((memo) => memo.name !== updatedMemo.name),
    };
  }

  return replaceMemoInListResponse(response, updatedMemo);
}

function syncMemoInInfiniteList(
  data: InfiniteData<ListMemosResponse> | undefined,
  updatedMemo: Memo,
  request?: Partial<ListMemosRequest>,
): InfiniteData<ListMemosResponse> | undefined {
  if (!data?.pages?.length) {
    return data;
  }

  let changed = false;
  const pages = data.pages.map((page) => {
    const nextPage = syncMemoInListResponse(page, updatedMemo, request);
    if (nextPage !== page) {
      changed = true;
    }
    return nextPage ?? page;
  });

  return changed ? { ...data, pages } : data;
}

export function syncMemoToDetailCache(queryClient: QueryClient, updatedMemo: Memo) {
  queryClient.setQueryData(memoKeys.detail(updatedMemo.name), updatedMemo);
}

export function syncMemoToListCaches(queryClient: QueryClient, updatedMemo: Memo) {
  const listQueries = queryClient.getQueryCache().findAll({ queryKey: memoKeys.lists() });

  for (const query of listQueries) {
    const request = query.queryKey[2] as Partial<ListMemosRequest> | undefined;
    queryClient.setQueryData(query.queryKey, (oldData: unknown) => {
      if (oldData && typeof oldData === "object" && "pages" in oldData) {
        return syncMemoInInfiniteList(oldData as InfiniteData<ListMemosResponse>, updatedMemo, request);
      }
      return syncMemoInListResponse(oldData as ListMemosResponse | undefined, updatedMemo, request);
    });
  }
}

// Query keys factory for consistent cache management
export const memoKeys = {
  all: ["memos"] as const,
  lists: () => [...memoKeys.all, "list"] as const,
  list: (filters: Partial<ListMemosRequest>) => [...memoKeys.lists(), filters] as const,
  details: () => [...memoKeys.all, "detail"] as const,
  detail: (name: string) => [...memoKeys.details(), name] as const,
  comments: (name: string) => [...memoKeys.all, "comments", name] as const,
};

export function useMemos(request: Partial<ListMemosRequest> = {}) {
  return useQuery({
    queryKey: memoKeys.list(request),
    queryFn: async () => {
      const response = await memoServiceClient.listMemos(create(ListMemosRequestSchema, request as Record<string, unknown>));
      return response;
    },
  });
}

export function useInfiniteMemos(request: Partial<ListMemosRequest> = {}) {
  return useInfiniteQuery({
    queryKey: memoKeys.list(request),
    queryFn: async ({ pageParam }) => {
      const response = await memoServiceClient.listMemos(
        create(ListMemosRequestSchema, {
          ...request,
          pageToken: pageParam || "",
        } as Record<string, unknown>),
      );
      return response;
    },
    initialPageParam: "",
    getNextPageParam: (lastPage) => lastPage.nextPageToken || undefined,
    staleTime: 1000 * 60, // Consider data fresh for 1 minute
    gcTime: 1000 * 60 * 5, // Keep unused data in cache for 5 minutes
  });
}

export function useMemo(name: string, options?: { enabled?: boolean }) {
  return useQuery({
    queryKey: memoKeys.detail(name),
    queryFn: async () => {
      const memo = await memoServiceClient.getMemo({ name });
      return memo;
    },
    enabled: options?.enabled ?? true,
    staleTime: 1000 * 60 * 5, // 5 minutes — frequent refetch causes BlogEditor to unmount/remount, losing scroll position and editor state
  });
}

export function useCreateMemo() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async (memoToCreate: Memo) => {
      const memo = await memoServiceClient.createMemo({ memo: memoToCreate });
      return memo;
    },
    onSuccess: (newMemo) => {
      // Invalidate memo lists to refetch
      queryClient.invalidateQueries({ queryKey: memoKeys.lists() });
      // Add new memo to cache
      queryClient.setQueryData(memoKeys.detail(newMemo.name), newMemo);
      // Invalidate user stats
      queryClient.invalidateQueries({ queryKey: userKeys.stats() });
    },
  });
}

export function useUpdateMemo(options: UseUpdateMemoOptions = {}) {
  const queryClient = useQueryClient();
  const { invalidateListsOnSuccess = true, invalidateUserStatsOnSuccess = true, syncListCaches = false } = options;

  const syncUpdatedMemoIntoKnownLists = (updatedMemo: Memo) => {
    syncMemoToListCaches(queryClient, updatedMemo);
  };

  return useMutation({
    mutationFn: async ({ update, updateMask }: { update: Partial<Memo>; updateMask: string[] }) => {
      const memo = await memoServiceClient.updateMemo({
        memo: create(MemoSchema, update as Record<string, unknown>),
        updateMask: create(FieldMaskSchema, { paths: updateMask }),
      });
      return memo;
    },
    onMutate: async ({ update }) => {
      if (!update.name) {
        return { previousMemo: undefined };
      }

      // Cancel outgoing refetches to prevent race conditions
      await queryClient.cancelQueries({ queryKey: memoKeys.detail(update.name) });

      // Snapshot previous value for rollback on error
      const previousMemo = queryClient.getQueryData<Memo>(memoKeys.detail(update.name));

      // Optimistically update the cache
      if (previousMemo) {
        queryClient.setQueryData(memoKeys.detail(update.name), { ...previousMemo, ...update });
      }

      return { previousMemo };
    },
    onError: (_err, { update }, context) => {
      // Rollback on error
      if (context?.previousMemo && update.name) {
        queryClient.setQueryData(memoKeys.detail(update.name), context.previousMemo);
      }
    },
    onSuccess: (updatedMemo) => {
      // Update cache with server response
      queryClient.setQueryData(memoKeys.detail(updatedMemo.name), updatedMemo);

      if (syncListCaches) {
        syncUpdatedMemoIntoKnownLists(updatedMemo);
      }

      if (invalidateListsOnSuccess) {
        queryClient.invalidateQueries({ queryKey: memoKeys.lists() });
      }
      if (invalidateUserStatsOnSuccess) {
        queryClient.invalidateQueries({ queryKey: userKeys.stats() });
      }
    },
  });
}

export function useDeleteMemo() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async (name: string) => {
      await memoServiceClient.deleteMemo({ name });
      return name;
    },
    onSuccess: (name) => {
      // Remove from cache
      queryClient.removeQueries({ queryKey: memoKeys.detail(name) });
      // Invalidate lists
      queryClient.invalidateQueries({ queryKey: memoKeys.lists() });
      // Invalidate user stats
      queryClient.invalidateQueries({ queryKey: userKeys.stats() });
    },
  });
}

export function useMemoComments(name: string, options?: { enabled?: boolean }) {
  return useQuery({
    queryKey: memoKeys.comments(name),
    queryFn: async () => {
      const response = await memoServiceClient.listMemoComments({ name });
      return response;
    },
    enabled: options?.enabled ?? true,
    staleTime: 1000 * 60, // 1 minute
  });
}
