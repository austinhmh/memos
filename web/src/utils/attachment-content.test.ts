import { describe, expect, it } from "vitest";
import { hasAttachmentReferencesInContent, removeAttachmentReferencesFromContent } from "./attachment-content";

describe("attachment content references", () => {
  it("removes markdown image references for the selected attachment", () => {
    const content = "before ![image.png](/file/attachments/abc123/image.png) after";
    expect(removeAttachmentReferencesFromContent(content, "attachments/abc123")).toBe("before after");
  });

  it("removes absolute attachment URLs for the selected attachment", () => {
    const content = "before https://example.com/file/attachments/abc123/image.png after";
    expect(removeAttachmentReferencesFromContent(content, "attachments/abc123")).toBe("before after");
  });

  it("keeps references for other attachments", () => {
    const content = "![image.png](/file/attachments/other/image.png)";
    expect(removeAttachmentReferencesFromContent(content, "attachments/abc123")).toBe(content);
  });

  it("detects selected attachment references", () => {
    expect(hasAttachmentReferencesInContent("![image.png](/file/attachments/abc123/image.png)", "attachments/abc123")).toBe(true);
    expect(hasAttachmentReferencesInContent("![image.png](/file/attachments/other/image.png)", "attachments/abc123")).toBe(false);
  });
});
