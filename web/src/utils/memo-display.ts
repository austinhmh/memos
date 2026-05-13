import type { Memo } from "@/types/proto/api/v1/memo_service_pb";

const attachmentReferencePattern =
  /!?\[[^\]]*\]\((?:https?:\/\/[^\s)]+)?\/file\/attachments\/[^\s)]+\/[^)]+\)|(?:https?:\/\/[^\s)]+)?\/file\/attachments\/[^\s)]+\/\S+/g;
const taskListLinePattern = /^\s*[-*+]\s+\[[ xX]\]\s+.*$/gm;
const tagOnlyLinePattern = /^\s*(#[^\s#]+\s*)+$/gm;

export const getMemoListTextContent = (content: string): string => {
  return content
    .replace(attachmentReferencePattern, "")
    .replace(taskListLinePattern, "")
    .replace(tagOnlyLinePattern, "")
    .replace(/[ \t]{2,}/g, " ")
    .replace(/[ \t]+\n/g, "\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
};

export const shouldShowInMemoList = (memo: Memo): boolean => {
  const hasAttachmentContent = memo.attachments.length > 0 || attachmentReferencePattern.test(memo.content);
  attachmentReferencePattern.lastIndex = 0;
  const hasTodoContent = memo.property?.hasTaskList ?? taskListLinePattern.test(memo.content);
  taskListLinePattern.lastIndex = 0;

  if (!hasAttachmentContent && !hasTodoContent) {
    return true;
  }

  return getMemoListTextContent(memo.content).length > 0;
};
