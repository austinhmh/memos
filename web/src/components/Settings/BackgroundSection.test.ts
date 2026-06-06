import { create } from "@bufbuild/protobuf";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { attachmentServiceClient } from "@/connect";
import { AttachmentSchema, ListAttachmentsResponseSchema } from "@/types/proto/api/v1/attachment_service_pb";
import { fetchBgImagesFromServer, fetchPublicBgImagesFromServer, STORAGE_KEY } from "./BackgroundSection";

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
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe("BackgroundSection background image loading", () => {
  it("loads public background images without using the attachment list", async () => {
    localStorage.setItem(STORAGE_KEY, JSON.stringify([{ url: "/private.png", name: "attachments/private", filename: "private.png" }]));
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue({
        ok: true,
        json: async () => [
          { url: "/file/backgrounds/bg/_bg_wallpaper.png", name: "backgrounds/bg", filename: "wallpaper.png" },
          { url: "/invalid.png", name: "missing-filename" },
        ],
      }),
    );

    await expect(fetchPublicBgImagesFromServer()).resolves.toEqual([
      { url: "/file/backgrounds/bg/_bg_wallpaper.png", name: "backgrounds/bg", filename: "wallpaper.png" },
    ]);

    expect(fetch).toHaveBeenCalledWith("/file/backgrounds", { credentials: "omit" });
    expect(listAttachments).not.toHaveBeenCalled();
    expect(localStorage.getItem(STORAGE_KEY)).toBe(
      JSON.stringify([{ url: "/private.png", name: "attachments/private", filename: "private.png" }]),
    );
  });

  it("keeps private background cache untouched when public loading fails", async () => {
    localStorage.setItem(STORAGE_KEY, JSON.stringify([{ url: "/private.png", name: "attachments/private", filename: "private.png" }]));
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue({
        ok: false,
        status: 500,
      }),
    );

    await expect(fetchPublicBgImagesFromServer()).rejects.toThrow("Failed to fetch public background images: 500");

    expect(listAttachments).not.toHaveBeenCalled();
    expect(localStorage.getItem(STORAGE_KEY)).toBe(
      JSON.stringify([{ url: "/private.png", name: "attachments/private", filename: "private.png" }]),
    );
  });

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
