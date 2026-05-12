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

  it("keeps safe external attachment links", () => {
    const attachment = create(AttachmentSchema, {
      externalLink: "https://example.com/pasted-image.png",
    });

    expect(getAttachmentUrl(attachment)).toBe("https://example.com/pasted-image.png");
    expect(getAttachmentThumbnailUrl(attachment)).toBe("https://example.com/pasted-image.png");
  });

  it("drops unsafe external attachment links", () => {
    const attachment = create(AttachmentSchema, {
      externalLink: "data:text/html,<script>alert(1)</script>",
    });

    expect(getAttachmentUrl(attachment)).toBe("");
    expect(getAttachmentThumbnailUrl(attachment)).toBe("");
  });

  it("allows image data URLs only for thumbnail image contexts", () => {
    const attachment = create(AttachmentSchema, {
      externalLink: "data:image/png;base64,aGVsbG8=",
    });

    expect(getAttachmentUrl(attachment)).toBe("");
    expect(getAttachmentThumbnailUrl(attachment)).toBe("data:image/png;base64,aGVsbG8=");
  });
});
