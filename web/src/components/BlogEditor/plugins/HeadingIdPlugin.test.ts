import { EditorState } from "prosemirror-state";
import { EditorView } from "prosemirror-view";
import { afterEach, describe, expect, it, vi } from "vitest";
import { blogEditorSchema } from "../lib/schema";
import { createHeadingIdPlugin } from "./HeadingIdPlugin";

let activeView: EditorView | undefined;

afterEach(() => {
  activeView?.destroy();
  activeView = undefined;
  document.body.innerHTML = "";
  vi.restoreAllMocks();
});

describe("HeadingIdPlugin", () => {
  it("does not throw when clicking malformed hash links", () => {
    const doc = blogEditorSchema.nodes.doc.create(null, [
      blogEditorSchema.nodes.paragraph.create(null, [
        blogEditorSchema.text("bad hash", [blogEditorSchema.marks.link.create({ href: "#%E0%A4%A" })]),
      ]),
    ]);
    const host = document.createElement("div");
    document.body.appendChild(host);
    activeView = new EditorView(host, {
      state: EditorState.create({
        doc,
        schema: blogEditorSchema,
        plugins: [createHeadingIdPlugin()],
      }),
    });

    const link = host.querySelector("a")!;

    expect(() => link.dispatchEvent(new MouseEvent("click", { bubbles: true, cancelable: true }))).not.toThrow();
  });
});
