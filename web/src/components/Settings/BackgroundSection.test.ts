import { create } from "@bufbuild/protobuf";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { attachmentServiceClient } from "@/connect";
import { AttachmentSchema, ListAttachmentsResponseSchema } from "@/types/proto/api/v1/attachment_service_pb";
import { fetchBgImagesFromServer, STORAGE_KEY } from "./BackgroundSection";

vi.mock("@/connect", () => ({
  attachmentServiceClient: {
    listAttachments: vi.fn(),
  },
}));

const listAttachments = vi.mocked(attachmentServiceClient.listAttachments);

beforeEach(() => {
  localStorage.clear();
  vi.spyOn(console, "error").mockImplementation(() => undefined);
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe("BackgroundSection background image loading", () => {
  it("loads background attachments across every attachment page", async () => {
    listAttachments
      .mockResolvedValueOnce(
        create(ListAttachmentsResponseSchema, {
          attachments: [
            create(AttachmentSchema, { name: "attachments/regular", filename: "regular.png" }),
            create(AttachmentSchema, { name: "attachments/bg-old", filename: "_bg_old image.png" }),
          ],
          nextPageToken: "1000",
          totalSize: 2,
        }),
      )
      .mockResolvedValueOnce(
        create(ListAttachmentsResponseSchema, {
          attachments: [create(AttachmentSchema, { name: "attachments/bg-new", filename: "_bg_new.png" })],
          nextPageToken: "",
          totalSize: 1,
        }),
      );

    await expect(fetchBgImagesFromServer()).resolves.toEqual([
      {
        url: "/file/attachments/bg-old/_bg_old%20image.png",
        name: "attachments/bg-old",
        filename: "old image.png",
      },
      {
        url: "/file/attachments/bg-new/_bg_new.png",
        name: "attachments/bg-new",
        filename: "new.png",
      },
    ]);

    expect(listAttachments).toHaveBeenNthCalledWith(1, { pageSize: 1000, pageToken: "" });
    expect(listAttachments).toHaveBeenNthCalledWith(2, { pageSize: 1000, pageToken: "1000" });
  });

  it("does not rewrite cached background images while fetching fails", async () => {
    localStorage.setItem(STORAGE_KEY, JSON.stringify([{ url: "/old.png", name: "attachments/old", filename: "old.png" }]));
    listAttachments.mockRejectedValueOnce(new Error("network failed"));

    await expect(fetchBgImagesFromServer()).rejects.toThrow("network failed");

    expect(localStorage.getItem(STORAGE_KEY)).toBe(JSON.stringify([{ url: "/old.png", name: "attachments/old", filename: "old.png" }]));
  });
});
