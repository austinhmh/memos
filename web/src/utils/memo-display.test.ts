import { describe, expect, it } from "vitest";
import type { Memo } from "@/types/proto/api/v1/memo_service_pb";
import { getMemoListTextContent, shouldShowInMemoList } from "./memo-display";

const memo = (content: string, options?: { hasTaskList?: boolean; attachmentCount?: number }) =>
  ({
    content,
    attachments: Array.from({ length: options?.attachmentCount ?? 0 }, (_, index) => ({ name: `attachments/${index}` })),
    property: { hasTaskList: options?.hasTaskList ?? false },
  }) as Memo;

describe("memo display filters", () => {
  it("hides todo-only memos from the default memo list", () => {
    expect(shouldShowInMemoList(memo("- [ ] task\n\n#todo", { hasTaskList: true }))).toBe(false);
  });

  it("keeps todo memos when they contain normal text", () => {
    expect(shouldShowInMemoList(memo("normal note\n- [ ] task", { hasTaskList: true }))).toBe(true);
  });

  it("hides attachment-only memos", () => {
    expect(shouldShowInMemoList(memo("![image](/file/attachments/abc/image.png)", { attachmentCount: 1 }))).toBe(false);
  });

  it("hides memos that only contain attachments and todos", () => {
    expect(shouldShowInMemoList(memo("![image](/file/attachments/abc/image.png)\n- [ ] task\n#todo", { hasTaskList: true }))).toBe(false);
  });

  it("keeps memos with text and attachments", () => {
    expect(shouldShowInMemoList(memo("note ![image](/file/attachments/abc/image.png)", { attachmentCount: 1 }))).toBe(true);
  });

  it("keeps text-only memos", () => {
    expect(shouldShowInMemoList(memo("plain note"))).toBe(true);
  });

  it("removes absolute attachment URLs when checking text content", () => {
    expect(getMemoListTextContent("https://example.com/file/attachments/abc/image.png")).toBe("");
  });
});
