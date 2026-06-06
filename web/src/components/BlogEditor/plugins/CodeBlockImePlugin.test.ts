import { DOMParser as ProseMirrorDOMParser } from "prosemirror-model";
import { EditorState, TextSelection } from "prosemirror-state";
import { DecorationSet, EditorView } from "prosemirror-view";
import { describe, expect, it, vi } from "vitest";

class TestIntersectionObserver {
  observe = vi.fn();
  unobserve = vi.fn();
  disconnect = vi.fn();
}

globalThis.IntersectionObserver = TestIntersectionObserver as unknown as typeof IntersectionObserver;

import { blogEditorSchema } from "../lib/schema";
import { codeBlockExpandPluginKey, createCodeBlockExpandPlugin } from "./CodeBlockExpandPlugin";
import { codeFenceActivePluginKey, createCodeFenceActivePlugin } from "./CodeFenceActivePlugin";
import {
  createCompositionGuardPlugin,
  isCompositionTransaction,
  isViewComposing,
  runAfterCompositionSettled,
} from "./CompositionGuardPlugin";
import { createMermaidPlugin, mermaidPluginKey } from "./MermaidPlugin";
import { createTablePlugins } from "./TableControlsPlugin";

const createCodeBlockState = () => {
  const paragraph = blogEditorSchema.nodes.paragraph.create(null, blogEditorSchema.text("before"));
  const codeBlock = blogEditorSchema.nodes.code_block.create({ language: "" }, blogEditorSchema.text("chuang"));
  const doc = blogEditorSchema.nodes.doc.create(null, [paragraph, codeBlock]);
  const codeStart = paragraph.nodeSize + 1;
  const state = EditorState.create({
    doc,
    schema: blogEditorSchema,
    plugins: [createCompositionGuardPlugin(), createCodeFenceActivePlugin(), createCodeBlockExpandPlugin()],
  });

  return state.apply(state.tr.setSelection(TextSelection.create(doc, codeStart + codeBlock.textContent.length)));
};

const createEditorView = (plugins = [createCompositionGuardPlugin()]) => {
  const paragraph = blogEditorSchema.nodes.paragraph.create(null, blogEditorSchema.text("before"));
  const codeBlock = blogEditorSchema.nodes.code_block.create({ language: "" }, blogEditorSchema.text("chuang"));
  const doc = blogEditorSchema.nodes.doc.create(null, [paragraph, codeBlock]);
  const codeStart = paragraph.nodeSize + 1;
  const host = document.createElement("div");
  document.body.appendChild(host);

  const state = EditorState.create({
    doc,
    schema: blogEditorSchema,
    plugins,
    selection: TextSelection.create(doc, codeStart + codeBlock.textContent.length),
  });

  const view = new EditorView(host, { state });
  return { view, host };
};

const createMermaidState = () => {
  const paragraph = blogEditorSchema.nodes.paragraph.create(null, blogEditorSchema.text("before"));
  const codeBlock = blogEditorSchema.nodes.code_block.create({ language: "mermaid" }, blogEditorSchema.text("graph TD\nA-->B"));
  const doc = blogEditorSchema.nodes.doc.create(null, [paragraph, codeBlock]);
  const codeStart = paragraph.nodeSize + 1;
  const state = EditorState.create({
    doc,
    schema: blogEditorSchema,
    plugins: [createCompositionGuardPlugin(), createMermaidPlugin({ isDark: false })],
    selection: TextSelection.create(doc, codeStart + codeBlock.textContent.length),
  });

  return state.apply(state.tr.setMeta(mermaidPluginKey, { loaded: true }));
};

const wait = (ms = 0) => new Promise((resolve) => setTimeout(resolve, ms));

describe("code block IME composition handling", () => {
  it("parses code block DOM content from the inner code element only", () => {
    const wrapper = document.createElement("div");
    const codeBlock = document.createElement("div");
    codeBlock.className = "code-block";
    codeBlock.dataset.language = "";

    const control = document.createElement("button");
    control.textContent = "创建";
    control.setAttribute("contenteditable", "false");

    const pre = document.createElement("pre");
    const code = document.createElement("code");
    code.textContent = "创建";
    pre.appendChild(code);
    codeBlock.append(control, pre);
    wrapper.appendChild(codeBlock);

    const doc = ProseMirrorDOMParser.fromSchema(blogEditorSchema).parse(wrapper);
    const parsedCodeBlock = doc.firstChild;

    expect(parsedCodeBlock?.type.name).toBe("code_block");
    expect(parsedCodeBlock?.textContent).toBe("创建");
  });

  it("keeps code block decoration sets mapped instead of rebuilt during composition transactions", () => {
    const state = createCodeBlockState();
    const activeBefore = codeFenceActivePluginKey.getState(state);
    const expandBefore = codeBlockExpandPluginKey.getState(state);

    const tr = state.tr.insertText("创建").setMeta("composition", 1);
    const nextState = state.apply(tr);

    const activeAfter = codeFenceActivePluginKey.getState(nextState);
    const expandAfter = codeBlockExpandPluginKey.getState(nextState);

    expect(activeAfter?.find()).toEqual(activeBefore?.map(tr.mapping, tr.doc).find());
    expect(expandAfter?.decorations.find()).toEqual(expandBefore?.decorations.map(tr.mapping, tr.doc).find());
  });

  it("recognizes composition transactions even when the meta value is falsy", () => {
    const state = createCodeBlockState();
    const activeBefore = codeFenceActivePluginKey.getState(state);
    const expandBefore = codeBlockExpandPluginKey.getState(state);

    const tr = state.tr.insertText("创建").setMeta("composition", 0);
    expect(isCompositionTransaction(tr)).toBe(true);

    const nextState = state.apply(tr);
    const activeAfter = codeFenceActivePluginKey.getState(nextState);
    const expandAfter = codeBlockExpandPluginKey.getState(nextState);

    expect(activeAfter?.find()).toEqual(activeBefore?.map(tr.mapping, tr.doc).find());
    expect(expandAfter?.decorations.find()).toEqual(expandBefore?.decorations.map(tr.mapping, tr.doc).find());
  });

  it("keeps non-composition code block edits on mapped decoration sets", () => {
    const state = createCodeBlockState();
    const activeBefore = codeFenceActivePluginKey.getState(state);
    const expandBefore = codeBlockExpandPluginKey.getState(state);

    const tr = state.tr.insertText("创建");
    const nextState = state.apply(tr);

    const activeAfter = codeFenceActivePluginKey.getState(nextState);
    const expandAfter = codeBlockExpandPluginKey.getState(nextState);

    expect(activeAfter?.find()).toEqual(activeBefore?.map(tr.mapping, tr.doc).find());
    expect(expandAfter?.decorations.find()).toEqual(expandBefore?.decorations.map(tr.mapping, tr.doc).find());
  });

  it("tracks DOM composition through the settle window", async () => {
    const { view, host } = createEditorView();
    try {
      view.dom.dispatchEvent(new CompositionEvent("compositionstart", { bubbles: true }));
      expect(isViewComposing(view)).toBe(true);

      view.dom.dispatchEvent(new CompositionEvent("compositionend", { bubbles: true }));
      expect(isViewComposing(view)).toBe(true);

      await wait(70);
      expect(isViewComposing(view)).toBe(false);
    } finally {
      view.destroy();
      host.remove();
    }
  });

  it("runs deferred callbacks only after composition settles", async () => {
    const { view, host } = createEditorView();
    try {
      let ran = false;
      view.dom.dispatchEvent(new CompositionEvent("compositionstart", { bubbles: true }));
      runAfterCompositionSettled(view, () => {
        ran = true;
      });

      await wait(70);
      expect(ran).toBe(false);

      view.dom.dispatchEvent(new CompositionEvent("compositionend", { bubbles: true }));
      await wait(90);
      expect(ran).toBe(true);
    } finally {
      view.destroy();
      host.remove();
    }
  });

  it("cancels deferred callbacks before composition settles", async () => {
    const { view, host } = createEditorView();
    try {
      let ran = false;
      view.dom.dispatchEvent(new CompositionEvent("compositionstart", { bubbles: true }));
      const cancel = runAfterCompositionSettled(view, () => {
        ran = true;
      });

      cancel();
      view.dom.dispatchEvent(new CompositionEvent("compositionend", { bubbles: true }));
      await wait(90);
      expect(ran).toBe(false);
    } finally {
      view.destroy();
      host.remove();
    }
  });

  it("maps table control decorations instead of rebuilding them during composition", () => {
    const cell = blogEditorSchema.nodes.table_cell.create(
      null,
      blogEditorSchema.nodes.paragraph.create(null, blogEditorSchema.text("chuang")),
    );
    const row = blogEditorSchema.nodes.table_row.create(null, [cell]);
    const table = blogEditorSchema.nodes.table.create(null, [row]);
    const doc = blogEditorSchema.nodes.doc.create(null, [table]);
    const state = EditorState.create({
      doc,
      schema: blogEditorSchema,
      plugins: createTablePlugins({ isEditable: () => true }),
      selection: TextSelection.create(doc, 3 + "chuang".length),
    });
    const before = state.plugins[0].getState(state) as DecorationSet;

    const tr = state.tr.insertText("创建").setMeta("composition", 1);
    const nextState = state.apply(tr);
    const after = state.plugins[0].getState(nextState) as DecorationSet;

    expect(after.find()).toEqual(before.map(tr.mapping, tr.doc).find());
  });

  it("does not rebuild code block expand widgets for empty mapped sets during composition", () => {
    const paragraph = blogEditorSchema.nodes.paragraph.create(null, blogEditorSchema.text("before"));
    const doc = blogEditorSchema.nodes.doc.create(null, [paragraph]);
    const state = EditorState.create({
      doc,
      schema: blogEditorSchema,
      plugins: [createCodeBlockExpandPlugin()],
    });

    const tr = state.tr.insertText("创建").setMeta("composition", undefined);
    const nextState = state.apply(tr);
    const after = codeBlockExpandPluginKey.getState(nextState);

    expect(isCompositionTransaction(tr)).toBe(true);
    expect(after?.decorations.find()).toEqual([]);
  });

  it("does not rebuild table widgets for empty mapped sets during composition", () => {
    const paragraph = blogEditorSchema.nodes.paragraph.create(null, blogEditorSchema.text("before"));
    const doc = blogEditorSchema.nodes.doc.create(null, [paragraph]);
    const state = EditorState.create({
      doc,
      schema: blogEditorSchema,
      plugins: createTablePlugins({ isEditable: () => true }),
    });

    const tr = state.tr.insertText("创建").setMeta("composition", undefined);
    const nextState = state.apply(tr);
    const after = state.plugins[0].getState(nextState) as DecorationSet;

    expect(isCompositionTransaction(tr)).toBe(true);
    expect(after.find()).toEqual([]);
  });

  it("keeps mermaid widgets mapped instead of rebuilt during composition", () => {
    const state = createMermaidState();
    const before = mermaidPluginKey.getState(state);
    const beforeRenderer = before?.decorationSet.find(0, state.doc.content.size, (spec) => !!spec.renderer)[0]?.spec.renderer;

    const tr = state.tr.insertText("创建").setMeta("composition", 1);
    const nextState = state.apply(tr);
    const after = mermaidPluginKey.getState(nextState);
    const afterRenderer = after?.decorationSet.find(0, nextState.doc.content.size, (spec) => !!spec.renderer)[0]?.spec.renderer;

    expect(after?.decorationSet.find()).toEqual(before?.decorationSet.map(tr.mapping, tr.doc).find());
    expect(afterRenderer).toBe(beforeRenderer);
  });

  it("does not dispatch delayed slash-menu cleanup while composition is active", async () => {
    const { view, host } = createEditorView();
    try {
      const dispatch = vi.spyOn(view, "dispatch");
      view.dom.dispatchEvent(new CompositionEvent("compositionstart", { bubbles: true }));
      runAfterCompositionSettled(view, () => {
        if (!isViewComposing(view)) {
          view.dispatch(view.state.tr.insertText("after"));
        }
      });

      await wait(70);
      expect(dispatch).not.toHaveBeenCalled();

      view.dom.dispatchEvent(new CompositionEvent("compositionend", { bubbles: true }));
      await wait(90);
      expect(dispatch).toHaveBeenCalledTimes(1);
    } finally {
      view.destroy();
      host.remove();
    }
  });

  it("delays autosave scheduling while code block composition is active", async () => {
    const { view, host } = createEditorView();
    try {
      let scheduled = false;
      view.dom.dispatchEvent(new CompositionEvent("compositionstart", { bubbles: true }));
      runAfterCompositionSettled(view, () => {
        scheduled = true;
      });

      const tr = view.state.tr.insertText("创建").setMeta("composition", 1);
      view.dispatch(tr);
      expect(view.state.doc.textContent).toContain("chuang创建");
      expect(scheduled).toBe(false);

      view.dom.dispatchEvent(new CompositionEvent("compositionend", { bubbles: true }));
      await wait(130);
      expect(scheduled).toBe(true);
    } finally {
      view.destroy();
      host.remove();
    }
  });
});
