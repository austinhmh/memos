import { EditorState } from "prosemirror-state";
import { EditorView } from "prosemirror-view";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import insertFiles from "@/outline-vendor/shared/editor/commands/insertFiles";
import FileHelper from "@/outline-vendor/shared/editor/lib/FileHelper";
import uploadPlaceholderPlugin from "@/outline-vendor/shared/editor/lib/uploadPlaceholder";
import { blogEditorSchema } from "./schema";

class PendingImageMock {
  onload: (() => void) | null = null;
  onerror: (() => void) | null = null;
  naturalWidth = 0;
  naturalHeight = 0;
  width = 0;
  height = 0;
  src = "";
}

const createView = () => {
  const container = document.createElement("div");
  document.body.appendChild(container);

  const view = new EditorView(container, {
    state: EditorState.create({
      doc: blogEditorSchema.nodes.doc.create(null, blogEditorSchema.nodes.paragraph.create()),
      schema: blogEditorSchema,
      plugins: [uploadPlaceholderPlugin],
    }),
  });

  return { view, container };
};

describe("insertFiles", () => {
  const originalCreateObjectURL = URL.createObjectURL;
  const originalRevokeObjectURL = URL.revokeObjectURL;
  const originalImage = globalThis.Image;

  beforeEach(() => {
    URL.createObjectURL = vi.fn(() => "blob:local-image");
    URL.revokeObjectURL = vi.fn();
    vi.spyOn(FileHelper, "getImageSourceAttr").mockResolvedValue(undefined);
  });

  afterEach(() => {
    URL.createObjectURL = originalCreateObjectURL;
    URL.revokeObjectURL = originalRevokeObjectURL;
    globalThis.Image = originalImage;
    vi.restoreAllMocks();
    document.body.innerHTML = "";
  });

  it("inserts an uploaded image immediately when local dimensions are known", async () => {
    globalThis.Image = PendingImageMock as unknown as typeof Image;
    vi.spyOn(FileHelper, "getImageDimensions").mockResolvedValue({ width: 1, height: 1 });
    const { view } = createView();
    const file = new File([new Uint8Array([1, 2, 3])], "pasted.png", { type: "image/png" });
    const event = new Event("paste");

    await insertFiles(view, event, 1, [file], {
      dictionary: { fileUploadError: "Upload failed", untitled: "Untitled" },
      uploadFile: async () => "/file/attachments/test/pasted.png",
    });
    await new Promise((resolve) => setTimeout(resolve, 0));

    expect(view.state.doc.firstChild?.firstChild?.type.name).toBe("image");
    expect(view.state.doc.firstChild?.firstChild?.attrs.src).toBe("/file/attachments/test/pasted.png");
    expect(view.state.doc.firstChild?.firstChild?.attrs.width).toBe(1);
    expect(view.state.doc.firstChild?.firstChild?.attrs.height).toBe(1);
    expect(document.querySelector(".image.placeholder")).toBeNull();

    view.destroy();
  });

  it("still inserts an uploaded image when the final image URL cannot be loaded", async () => {
    vi.spyOn(FileHelper, "getImageDimensions").mockResolvedValue(undefined);
    const instances: PendingImageMock[] = [];
    globalThis.Image = class extends PendingImageMock {
      constructor() {
        super();
        instances.push(this);
      }
    } as unknown as typeof Image;

    const { view } = createView();
    const file = new File([new Uint8Array([1, 2, 3])], "pasted.webp", { type: "image/webp" });
    const event = new Event("paste");

    await insertFiles(view, event, 1, [file], {
      dictionary: { fileUploadError: "Upload failed", untitled: "Untitled" },
      uploadFile: async () => "/file/attachments/test/pasted.webp",
    });
    await new Promise((resolve) => setTimeout(resolve, 0));

    expect(view.state.doc.firstChild?.firstChild).toBeNull();
    expect(document.querySelector(".image.placeholder")).not.toBeNull();

    instances.at(-1)?.onerror?.();

    expect(view.state.doc.firstChild?.firstChild?.type.name).toBe("image");
    expect(view.state.doc.firstChild?.firstChild?.attrs.src).toBe("/file/attachments/test/pasted.webp");
    expect(document.querySelector(".image.placeholder")).toBeNull();

    view.destroy();
  });
});
