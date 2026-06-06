import { create } from "@bufbuild/protobuf";
import { render, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { attachmentServiceClient } from "@/connect";
import { UserSchema } from "@/types/proto/api/v1/user_service_pb";
import RandomBackground from "./RandomBackground";
import { STORAGE_KEY } from "./Settings/BackgroundSection";

vi.mock("@/connect", () => ({
  attachmentServiceClient: {
    listAttachments: vi.fn(),
  },
}));

const listAttachments = vi.mocked(attachmentServiceClient.listAttachments);

beforeEach(() => {
  localStorage.clear();
  document.documentElement.classList.remove("has-bg-image");
  vi.spyOn(console, "error").mockImplementation(() => undefined);
});

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
  document.documentElement.classList.remove("has-bg-image");
});

describe("RandomBackground", () => {
  it("renders public background for anonymous users without listing attachments", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue({
        ok: true,
        json: async () => [{ url: "/file/backgrounds/bg/_bg_wallpaper.png", name: "backgrounds/bg", filename: "wallpaper.png" }],
      }),
    );

    const { container } = render(<RandomBackground />);

    await waitFor(() => expect(container.querySelector("img")?.getAttribute("src")).toBe("/file/backgrounds/bg/_bg_wallpaper.png"));
    expect(document.documentElement.classList.contains("has-bg-image")).toBe(true);
    expect(fetch).toHaveBeenCalledWith("/file/backgrounds", { credentials: "omit" });
    expect(listAttachments).not.toHaveBeenCalled();
  });

  it("does not read private cached backgrounds while anonymous", async () => {
    localStorage.setItem(
      STORAGE_KEY,
      JSON.stringify([{ url: "/file/attachments/private/_bg_private.png", name: "attachments/private", filename: "private.png" }]),
    );
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue({
        ok: true,
        json: async () => [],
      }),
    );

    const { container } = render(<RandomBackground />);

    await waitFor(() => expect(fetch).toHaveBeenCalledWith("/file/backgrounds", { credentials: "omit" }));
    expect(container.querySelector("img")).toBeNull();
    expect(document.documentElement.classList.contains("has-bg-image")).toBe(false);
    expect(listAttachments).not.toHaveBeenCalled();
  });

  it("ignores private cache change events while anonymous", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue({
        ok: true,
        json: async () => [],
      }),
    );

    const { container } = render(<RandomBackground />);

    await waitFor(() => expect(fetch).toHaveBeenCalled());
    localStorage.setItem(
      STORAGE_KEY,
      JSON.stringify([{ url: "/file/attachments/private/_bg_private.png", name: "attachments/private", filename: "private.png" }]),
    );
    window.dispatchEvent(new CustomEvent("background-images-changed"));

    expect(container.querySelector("img")).toBeNull();
    expect(document.documentElement.classList.contains("has-bg-image")).toBe(false);
  });

  it("switches from public loading to private user loading after sign in", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue({
        ok: true,
        json: async () => [{ url: "/file/backgrounds/bg/_bg_wallpaper.png", name: "backgrounds/bg", filename: "wallpaper.png" }],
      }),
    );
    listAttachments.mockResolvedValue({
      attachments: [{ name: "attachments/user-bg", filename: "_bg_user.png" }],
      nextPageToken: "",
      totalSize: 1,
    } as Awaited<ReturnType<typeof attachmentServiceClient.listAttachments>>);

    const { container, rerender } = render(<RandomBackground />);
    await waitFor(() => expect(container.querySelector("img")?.getAttribute("src")).toBe("/file/backgrounds/bg/_bg_wallpaper.png"));

    rerender(<RandomBackground currentUser={create(UserSchema, { name: "users/1", username: "alice" })} />);

    await waitFor(() => expect(listAttachments).toHaveBeenCalledWith({ pageSize: 1000, pageToken: "" }));
    await waitFor(() => expect(container.querySelector("img")?.getAttribute("src")).toBe("/file/attachments/user-bg/_bg_user.png"));
  });
});
