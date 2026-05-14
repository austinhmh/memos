import { EditorState, TextSelection } from "prosemirror-state";
import { describe, expect, it } from "vitest";
import { blogEditorSchema } from "../lib/schema";
import { codeBlockExpandPluginKey, createCodeBlockExpandPlugin } from "./CodeBlockExpandPlugin";
import { codeFenceActivePluginKey, createCodeFenceActivePlugin } from "./CodeFenceActivePlugin";

const createCodeBlockState = () => {
  const paragraph = blogEditorSchema.nodes.paragraph.create(null, blogEditorSchema.text("before"));
  const codeBlock = blogEditorSchema.nodes.code_block.create({ language: "" }, blogEditorSchema.text("chuang"));
  const doc = blogEditorSchema.nodes.doc.create(null, [paragraph, codeBlock]);
  const codeStart = paragraph.nodeSize + 1;
  const state = EditorState.create({
    doc,
    schema: blogEditorSchema,
    plugins: [createCodeFenceActivePlugin(), createCodeBlockExpandPlugin()],
  });

  return state.apply(state.tr.setSelection(TextSelection.create(doc, codeStart + codeBlock.textContent.length)));
};

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
});
