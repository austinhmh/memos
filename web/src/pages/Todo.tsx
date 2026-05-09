import { create } from "@bufbuild/protobuf";
import { timestampDate } from "@bufbuild/protobuf/wkt";
import dayjs from "dayjs";
import { ArchiveIcon, CheckCircle2Icon, CircleIcon, ExternalLinkIcon, ListTodoIcon, SearchIcon } from "lucide-react";
import { useCallback, useMemo, useState } from "react";
import { toast } from "react-hot-toast";
import Empty from "@/components/Empty";
import MobileHeader from "@/components/MobileHeader";
import Skeleton from "@/components/Skeleton";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Input } from "@/components/ui/input";
import { DEFAULT_LIST_MEMOS_PAGE_SIZE } from "@/helpers/consts";
import useCurrentUser from "@/hooks/useCurrentUser";
import { useCreateMemo, useInfiniteMemos, useUpdateMemo } from "@/hooks/useMemoQueries";
import useNavigateTo from "@/hooks/useNavigateTo";
import i18n from "@/i18n";
import { cn } from "@/lib/utils";
import { Routes } from "@/router";
import { State } from "@/types/proto/api/v1/common_pb";
import { type Memo, MemoSchema, Visibility } from "@/types/proto/api/v1/memo_service_pb";
import { extractTasks, type TaskItem, toggleTaskAtIndex } from "@/utils/markdown-manipulation";

interface TodoTask extends TaskItem {
  memo: Memo;
}

type TodoFilter = "open" | "all" | "done";

interface TodoSection {
  key: string;
  title: string;
  description: string;
  tasks: TodoTask[];
}

const getMemoDisplayDate = (memo: Memo) => {
  const date = memo.displayTime ? timestampDate(memo.displayTime) : undefined;
  return date ? dayjs(date) : undefined;
};

const getMemoRoute = (memo: Memo) => `/${memo.name}`;

const getMemoUid = (memo: Memo) => memo.name.split("/").pop() || memo.name;

const getPrimaryTag = (memo: Memo) => memo.tags?.[0];

const getSectionKey = (memo: Memo) => getPrimaryTag(memo) || "untagged";

const getSectionTitle = (key: string) => (key === "untagged" ? "No tag" : `#${key}`);

const getSectionDescription = (tasks: TodoTask[]) => {
  const memoCount = new Set(tasks.map((task) => task.memo.name)).size;
  return `${tasks.length} tasks from ${memoCount} memos`;
};

const collectTasksFromMemos = (memos: Memo[]): TodoTask[] =>
  memos.flatMap((memo) =>
    extractTasks(memo.content).map((task) => ({
      ...task,
      memo,
    })),
  );

const filterTasks = (tasks: TodoTask[], filter: TodoFilter, query: string) => {
  const normalizedQuery = query.trim().toLowerCase();
  return tasks.filter((task) => {
    if (filter === "open" && task.checked) {
      return false;
    }
    if (filter === "done" && !task.checked) {
      return false;
    }
    if (!normalizedQuery) {
      return true;
    }

    const searchableText = [task.content, getPrimaryTag(task.memo), getMemoUid(task.memo), task.memo.snippet]
      .filter(Boolean)
      .join(" ")
      .toLowerCase();
    return searchableText.includes(normalizedQuery);
  });
};

const groupTasksByTag = (tasks: TodoTask[]): TodoSection[] => {
  const groups = new Map<string, TodoTask[]>();

  for (const task of tasks) {
    const key = getSectionKey(task.memo);
    const group = groups.get(key) ?? [];
    group.push(task);
    groups.set(key, group);
  }

  return Array.from(groups.entries())
    .sort(([aKey], [bKey]) => {
      if (aKey === "untagged") return 1;
      if (bKey === "untagged") return -1;
      return aKey.localeCompare(bKey);
    })
    .map(([key, sectionTasks]) => ({
      key,
      title: getSectionTitle(key),
      description: getSectionDescription(sectionTasks),
      tasks: sectionTasks,
    }));
};

const getTaskStats = (tasks: TodoTask[]) => {
  const done = tasks.filter((task) => task.checked).length;
  const open = tasks.length - done;
  return { total: tasks.length, open, done };
};

interface StatCardProps {
  label: string;
  value: number;
  tone?: "primary" | "success" | "muted";
}

const StatCard = ({ label, value, tone = "muted" }: StatCardProps) => (
  <div className="rounded-xl border border-border bg-card px-4 py-3">
    <p
      className={cn(
        "text-2xl font-semibold leading-none",
        tone === "primary" && "text-primary",
        tone === "success" && "text-green-600 dark:text-green-400",
      )}
    >
      {value}
    </p>
    <p className="mt-1 text-xs text-muted-foreground">{label}</p>
  </div>
);

interface TodoTaskRowProps {
  task: TodoTask;
  onToggle: (task: TodoTask, checked: boolean) => void;
  onOpenMemo: (memo: Memo) => void;
  disabled?: boolean;
}

const TodoTaskRow = ({ task, onToggle, onOpenMemo, disabled }: TodoTaskRowProps) => {
  const displayDate = getMemoDisplayDate(task.memo);
  const tag = getPrimaryTag(task.memo);

  return (
    <div className="group flex items-start gap-3 rounded-lg border border-border/70 bg-background px-3 py-2.5 transition-colors hover:border-primary/30 hover:bg-accent/30">
      <Checkbox
        checked={task.checked}
        disabled={disabled}
        onCheckedChange={(checked) => onToggle(task, checked === true)}
        className="mt-0.5"
      />
      <div className="min-w-0 flex-1">
        <button type="button" className="block w-full text-left" onClick={() => onOpenMemo(task.memo)}>
          <span className={cn("text-sm leading-5", task.checked && "text-muted-foreground line-through")}>{task.content}</span>
        </button>
        <div className="mt-1 flex flex-wrap items-center gap-1.5 text-xs text-muted-foreground">
          {tag && <Badge variant="secondary">#{tag}</Badge>}
          <span>memo {getMemoUid(task.memo)}</span>
          {displayDate && (
            <>
              <span>·</span>
              <relative-time datetime={displayDate.toDate().toISOString()} lang={i18n.language} format="auto" />
            </>
          )}
        </div>
      </div>
      <Button
        variant="ghost"
        size="icon"
        className="size-7 opacity-0 transition-opacity group-hover:opacity-100"
        onClick={() => onOpenMemo(task.memo)}
        aria-label="Open source memo"
      >
        <ExternalLinkIcon className="size-4" />
      </Button>
    </div>
  );
};

interface TodoSectionCardProps {
  section: TodoSection;
  onToggleTask: (task: TodoTask, checked: boolean) => void;
  onOpenMemo: (memo: Memo) => void;
  updatingMemoName?: string;
}

const TodoSectionCard = ({ section, onToggleTask, onOpenMemo, updatingMemoName }: TodoSectionCardProps) => {
  const stats = getTaskStats(section.tasks);

  return (
    <section className="overflow-hidden rounded-xl border border-border bg-card">
      <div className="flex items-center justify-between gap-3 border-b border-border bg-muted/30 px-4 py-3">
        <div className="min-w-0">
          <h2 className="truncate text-base font-semibold">{section.title}</h2>
          <p className="text-xs text-muted-foreground">{section.description}</p>
        </div>
        <div className="flex shrink-0 items-center gap-2">
          <Badge variant="outline">{stats.open} open</Badge>
          <Badge variant="secondary">{stats.done} done</Badge>
        </div>
      </div>
      <div className="flex flex-col gap-2 p-3">
        {section.tasks.map((task) => (
          <TodoTaskRow
            key={`${task.memo.name}-${task.taskIndex}-${task.lineNumber}`}
            task={task}
            onToggle={onToggleTask}
            onOpenMemo={onOpenMemo}
            disabled={updatingMemoName === task.memo.name}
          />
        ))}
      </div>
    </section>
  );
};

const Todo = () => {
  const currentUser = useCurrentUser();
  const navigateTo = useNavigateTo();
  const [filter, setFilter] = useState<TodoFilter>("open");
  const [searchQuery, setSearchQuery] = useState("");
  const updateMemo = useUpdateMemo({ syncListCaches: true });
  const createMemo = useCreateMemo();
  const [quickAddValue, setQuickAddValue] = useState("");

  const memoFilter = useMemo(() => {
    const conditions = ["has_task_list"];
    if (currentUser?.name) {
      const creatorId = currentUser.name.match(/users\/(\d+)/)?.[1];
      if (creatorId) {
        conditions.unshift(`creator_id == ${creatorId}`);
      }
    }
    return conditions.join(" && ");
  }, [currentUser?.name]);

  const { data, fetchNextPage, hasNextPage, isFetchingNextPage, isLoading } = useInfiniteMemos({
    state: State.NORMAL,
    orderBy: "display_time desc",
    filter: memoFilter,
    pageSize: DEFAULT_LIST_MEMOS_PAGE_SIZE,
  });

  const memos = useMemo(() => data?.pages.flatMap((page) => page.memos) || [], [data]);
  const allTasks = useMemo(() => collectTasksFromMemos(memos), [memos]);
  const visibleTasks = useMemo(() => filterTasks(allTasks, filter, searchQuery), [allTasks, filter, searchQuery]);
  const sections = useMemo(() => groupTasksByTag(visibleTasks), [visibleTasks]);
  const stats = useMemo(() => getTaskStats(allTasks), [allTasks]);

  const handleQuickAdd = useCallback(async () => {
    const taskContent = quickAddValue.trim();
    if (!taskContent || createMemo.isPending) {
      return;
    }

    try {
      await createMemo.mutateAsync(
        create(MemoSchema, {
          content: `- [ ] ${taskContent}\n\n#todo\n`,
          visibility: Visibility.PRIVATE,
        }),
      );
      setQuickAddValue("");
      setFilter("open");
      toast.success("Todo created");
    } catch (error) {
      console.error("Failed to create todo:", error);
      toast.error("Failed to create todo");
    }
  }, [createMemo, quickAddValue]);

  const handleToggleTask = useCallback(
    async (task: TodoTask, checked: boolean) => {
      const content = toggleTaskAtIndex(task.memo.content, task.taskIndex, checked);
      if (content === task.memo.content) {
        return;
      }

      try {
        await updateMemo.mutateAsync({
          update: {
            name: task.memo.name,
            content,
          },
          updateMask: ["content"],
        });
      } catch (error) {
        console.error("Failed to update todo task:", error);
        toast.error("Failed to update todo");
      }
    },
    [updateMemo],
  );

  const handleOpenMemo = useCallback(
    (memo: Memo) => {
      navigateTo(getMemoRoute(memo), { state: { from: Routes.TODO } });
    },
    [navigateTo],
  );

  return (
    <section className="@container w-full min-h-full bg-background text-foreground">
      <MobileHeader />
      <div className="mx-auto flex w-full max-w-5xl flex-col gap-4 px-4 pb-8 pt-3 sm:px-6 md:pt-6">
        <div className="rounded-2xl border border-border bg-card px-4 py-4 sm:px-5">
          <div className="flex flex-col gap-4 lg:flex-row lg:items-end lg:justify-between">
            <div className="min-w-0">
              <div className="mb-2 flex items-center gap-2 text-muted-foreground">
                <ListTodoIcon className="size-5" />
                <span className="text-sm font-medium">Todo</span>
              </div>
              <h1 className="text-2xl font-semibold tracking-tight">Tasks from your memos</h1>
              <p className="mt-1 max-w-2xl text-sm text-muted-foreground">
                Review, search, and complete Markdown tasks without leaving the source memo model.
              </p>
            </div>
            <div className="grid grid-cols-3 gap-2 sm:min-w-80">
              <StatCard label="Open" value={stats.open} tone="primary" />
              <StatCard label="Done" value={stats.done} tone="success" />
              <StatCard label="Total" value={stats.total} />
            </div>
          </div>
        </div>

        <div className="rounded-2xl border border-border bg-card p-3">
          <div className="flex flex-col gap-3 md:flex-row md:items-center md:justify-between">
            <div className="flex w-full flex-col gap-3 md:flex-row">
              <Input
                placeholder="Quick add: follow up with Alice"
                value={quickAddValue}
                onChange={(event) => setQuickAddValue(event.target.value)}
                onKeyDown={(event) => {
                  if (event.key === "Enter") {
                    event.preventDefault();
                    void handleQuickAdd();
                  }
                }}
              />
              <Button className="md:w-auto" onClick={() => void handleQuickAdd()} disabled={!quickAddValue.trim() || createMemo.isPending}>
                {createMemo.isPending ? "Adding..." : "Add todo"}
              </Button>
            </div>
          </div>
        </div>

        <div className="rounded-2xl border border-border bg-card p-3">
          <div className="flex flex-col gap-3 md:flex-row md:items-center md:justify-between">
            <div className="relative w-full md:max-w-sm">
              <SearchIcon className="absolute left-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" />
              <Input
                className="pl-9"
                placeholder="Search tasks, tags, or memo id"
                value={searchQuery}
                onChange={(event) => setSearchQuery(event.target.value)}
              />
            </div>
            <div className="flex flex-wrap items-center gap-2">
              <Button variant={filter === "open" ? "default" : "outline"} size="sm" onClick={() => setFilter("open")}>
                <CircleIcon className="size-4" />
                Open
              </Button>
              <Button variant={filter === "all" ? "default" : "outline"} size="sm" onClick={() => setFilter("all")}>
                <ListTodoIcon className="size-4" />
                All
              </Button>
              <Button variant={filter === "done" ? "default" : "outline"} size="sm" onClick={() => setFilter("done")}>
                <CheckCircle2Icon className="size-4" />
                Done
              </Button>
            </div>
          </div>
        </div>

        {isLoading ? (
          <Skeleton count={4} />
        ) : sections.length > 0 ? (
          <div className="flex flex-col gap-4">
            {sections.map((section) => (
              <TodoSectionCard
                key={section.key}
                section={section}
                onToggleTask={handleToggleTask}
                onOpenMemo={handleOpenMemo}
                updatingMemoName={updateMemo.isPending ? updateMemo.variables?.update.name : undefined}
              />
            ))}
            {hasNextPage && (
              <div className="flex justify-center py-2">
                <Button variant="outline" onClick={() => fetchNextPage()} disabled={isFetchingNextPage}>
                  {isFetchingNextPage ? "Loading..." : "Load more memos"}
                </Button>
              </div>
            )}
          </div>
        ) : (
          <div className="rounded-2xl border border-dashed border-border bg-card py-16">
            <Empty />
            <div className="mt-4 flex flex-col items-center gap-2 text-center">
              <p className="font-medium">No tasks found</p>
              <p className="max-w-sm text-sm text-muted-foreground">
                Create Markdown tasks like `- [ ] Follow up` in a memo, then they will appear here.
              </p>
              <Button variant="outline" size="sm" onClick={() => navigateTo(Routes.ROOT)}>
                <ArchiveIcon className="size-4" />
                Back to memos
              </Button>
            </div>
          </div>
        )}
      </div>
    </section>
  );
};

export default Todo;
