const attachmentPathPattern = (attachmentName: string) => {
  const uid = attachmentName.replace(/^attachments\//, "");
  return new RegExp(
    `!?\\[[^\\]]*\\]\\((?:https?:\\/\\/[^\\s)]+)?\\/file\\/attachments\\/${escapeRegExp(uid)}\\/[^)]+\\)|(?:https?:\\/\\/[^\\s)]+)?\\/file\\/attachments\\/${escapeRegExp(uid)}\\/\\S+`,
    "g",
  );
};

const escapeRegExp = (value: string) => value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

export const removeAttachmentReferencesFromContent = (content: string, attachmentName: string): string => {
  const pattern = attachmentPathPattern(attachmentName);
  return content
    .replace(pattern, "")
    .replace(/[ \t]{2,}/g, " ")
    .replace(/[ \t]+\n/g, "\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
};

export const hasAttachmentReferencesInContent = (content: string, attachmentName: string): boolean => {
  return attachmentPathPattern(attachmentName).test(content);
};
