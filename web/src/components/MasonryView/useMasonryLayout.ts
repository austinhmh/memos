import { useCallback, useEffect, useState } from "react";
import { Memo } from "@/types/proto/api/v1/memo_service_pb";
import { MINIMUM_MEMO_VIEWPORT_WIDTH } from "./constants";

export function useMasonryLayout(
  memoList: Memo[],
  listMode: boolean,
  containerRef: React.RefObject<HTMLDivElement>,
) {
  const [columns, setColumns] = useState(1);
  const [distribution, setDistribution] = useState<number[][]>([[]]);

  const calculateColumns = useCallback(() => {
    if (!containerRef.current || listMode) return 1;

    const containerWidth = containerRef.current.offsetWidth;
    const scale = containerWidth / MINIMUM_MEMO_VIEWPORT_WIDTH;
    
    // Maximum 2 columns for better visibility
    if (scale >= 2.0) return 2;
    if (scale >= 1.2) return 2;
    return 1;
  }, [containerRef, listMode]);

  // Simplified distribution: round-robin assignment to columns
  // Since all cards have the same fixed height, we don't need complex balancing
  const distributeMemos = useCallback(() => {
    const cols: number[][] = Array.from({ length: columns }, () => []);

    memoList.forEach((_, index) => {
      const columnIndex = index % columns;
      cols[columnIndex].push(index);
    });

    return cols;
  }, [memoList, columns]);

  useEffect(() => {
    const handleResize = () => {
      if (!containerRef.current) return;

      const newColumns = calculateColumns();
      if (newColumns !== columns) {
        setColumns(newColumns);
      }
    };

    handleResize();
    window.addEventListener("resize", handleResize);
    return () => window.removeEventListener("resize", handleResize);
  }, [calculateColumns, columns, containerRef]);

  useEffect(() => {
    setDistribution(distributeMemos());
  }, [columns, memoList, distributeMemos]);

  return {
    columns,
    distribution,
    // No longer needed for fixed-height cards
    handleHeightChange: () => {},
  };
}
