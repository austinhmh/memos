export enum MentionType {
  User = "user",
  Document = "document",
}

export function determineMentionType(_url: string): MentionType | null {
  return null;
}

export function isURLMentionable(_url: string): boolean {
  return false;
}
