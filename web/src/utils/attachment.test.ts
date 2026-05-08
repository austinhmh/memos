import { create } from "@bufbuild/protobuf";
import { describe, expect, it } from "vitest";
import { AttachmentSchema } from "@/types/proto/api/v1/attachment_service_pb";
import { getAttachmentThumbnailUrl, getAttachmentUrl } from "./attachment";

describe("attachment urls", () => {
  it("builds relative file URLs for local attachments", () => {
    const attachment = create(AttachmentSchema, {
      name: "attachments/paste-image",
      filename: "pasted image.png",
    });

    expect(getAttachmentUrl(attachment)).toBe("/file/attachments/paste-image/pasted%20image.png");
  });

  it("builds relative thumbnail URLs for local attachments", () => {
    const attachment = create(AttachmentSchema, {
      name: "attachments/paste-image",
      filename: "pasted image.png",
    });

    expect(getAttachmentThumbnailUrl(attachment)).toBe("/file/attachments/paste-image/pasted%20image.png?thumbnail=true");
  });

  it("keeps external attachment links unchanged", () => {
    const attachment = create(AttachmentSchema, {
      externalLink: "https://example.com/pasted-image.png",
    });

    expect(getAttachmentUrl(attachment)).toBe("https://example.com/pasted-image.png");
    expect(getAttachmentThumbnailUrl(attachment)).toBe("https://example.com/pasted-image.png");
  });
});
