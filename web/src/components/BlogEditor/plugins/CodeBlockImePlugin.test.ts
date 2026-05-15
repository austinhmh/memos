import { EditorState, TextSelection } from "prosemirror-state";
import { DecorationSet, EditorView } from "prosemirror-view";
import { describe, expect, it } from "vitest";
import { blogEditorSchema } from "../lib/schema";
import { codeBlockExpandPluginKey, createCodeBlockExpandPlugin } from "./CodeBlockExpandPlugin";
import { codeFenceActivePluginKey, createCodeFenceActivePlugin } from "./CodeFenceActivePlugin";
import { createCompositionGuardPlugin, isViewComposing, runAfterCompositionSettled } from "./CompositionGuardPlugin";
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

const wait = (ms = 0) => new Promise((resolve) => setTimeout(resolve, ms));

describe("code block IME composition handling", () => {
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

  it("maps table control decorations instead of rebuilding them during composition", () => {
    const cell = blogEditorSchema.nodes.table_cell.create(null, blogEditorSchema.text("chuang"));
    const row = blogEditorSchema.nodes.table_row.create(null, [cell]);
    const table = blogEditorSchema.nodes.table.create(null, [row]);
    const doc = blogEditorSchema.nodes.doc.create(null, [table]);
    const state = EditorState.create({
      doc,
      schema: blogEditorSchema,
      plugins: createTablePlugins({ isEditable: () => true }),
      selection: TextSelection.create(doc, 3),
    });
    const before = state.plugins[0].getState(state) as DecorationSet;

    const tr = state.tr.insertText("创建").setMeta("composition", 1);
    const nextState = state.apply(tr);
    const after = state.plugins[0].getState(nextState) as DecorationSet;

    expect(after.find()).toEqual(before.map(tr.mapping, tr.doc).find());
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
