import { useMemo, useRef } from "react";
import { useView } from "@/contexts/ViewContext";
import { cn } from "@/lib/utils";
import { MasonryColumn } from "./MasonryColumn";
import { MasonryViewProps, MemoRenderContext } from "./types";
import { useMasonryLayout } from "./useMasonryLayout";

const MasonryView = ({ memoList, renderer, prefixElement, listMode = false }: MasonryViewProps) => {
  const containerRef = useRef<HTMLDivElement>(null);
  const prefixElementRef = useRef<HTMLDivElement>(null);
  const { compactMode, compactLines } = useView();

  const { columns, distribution } = useMasonryLayout(memoList, listMode, containerRef);

  // Create render context: always show full content (no compact mode)
  const renderContext: MemoRenderContext = useMemo(
    () => {
      // Always show full content, ignore compact mode
      const compact = false;

      return {
        compact,
        columns,
        compactLines,
      };
    },
    [columns, compactLines],
  );

  return (
    <div className="w-full flex flex-col gap-2">
      {/* Prefix element (editor, filters) spans full width */}
      {prefixElement && (
        <div ref={prefixElementRef} className="w-full">
          {prefixElement}
        </div>
      )}

      {/* Memo cards in grid layout */}
      <div
        ref={containerRef}
        className="w-full grid gap-2"
        style={{
          gridTemplateColumns: `repeat(${columns}, 1fr)`,
        }}
      >
        {Array.from({ length: columns }).map((_, columnIndex) => (
          <MasonryColumn
            key={columnIndex}
            memoIndices={distribution[columnIndex] || []}
            memoList={memoList}
            renderer={renderer}
            renderContext={renderContext}
          />
        ))}
      </div>
    </div>
  );
};

export default MasonryView;
