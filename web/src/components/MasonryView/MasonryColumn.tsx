import { MasonryItem } from "./MasonryItem";
import { MasonryColumnProps } from "./types";

export function MasonryColumn({
  memoIndices,
  memoList,
  renderer,
  renderContext,
}: MasonryColumnProps) {
  return (
    <div className="min-w-0 w-full">
      {/* Render all memos assigned to this column */}
      {memoIndices?.map((memoIndex) => {
        const memo = memoList[memoIndex];
        return memo ? (
          <MasonryItem
            key={`${memo.name}-${memo.displayTime}`}
            memo={memo}
            renderer={renderer}
            renderContext={renderContext}
          />
        ) : null;
      })}
    </div>
  );
}
