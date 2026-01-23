import type { Memo } from "@/types/proto/api/v1/memo_service_pb";

export interface MemoViewProps {
  memo: Memo;
  compact?: boolean;
  compactLines?: number;
  showCreator?: boolean;
  showVisibility?: boolean;
  showPinned?: boolean;
  showNsfwContent?: boolean;
  className?: string;
  parentPage?: string;
  fullHeight?: boolean; // 是否显示完整高度（详情页用）
}

export interface MemoHeaderProps {
  showCreator?: boolean;
  showVisibility?: boolean;
  showPinned?: boolean;
  onEdit: () => void;
  onGotoDetail: () => void;
  onUnpin: () => void;
  onToggleNsfwVisibility?: () => void;
}

export interface MemoBodyProps {
  compact?: boolean;
  compactLines?: number;
  onContentClick: (e: React.MouseEvent) => void;
  onContentDoubleClick: (e: React.MouseEvent) => void;
  onToggleNsfwVisibility: () => void;
}
