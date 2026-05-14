import { defaultSchema } from "rehype-sanitize";

export const MAX_DISPLAY_HEIGHT = 256;

export const COMPACT_STATES: Record<"ALL" | "SNIPPET", { textKey: string; next: "ALL" | "SNIPPET" }> = {
  ALL: { textKey: "memo.show-more", next: "SNIPPET" },
  SNIPPET: { textKey: "memo.show-less", next: "ALL" },
};

/**
 * Sanitization schema for markdown HTML content.
 * Extends the default schema only for KaTeX math rendering elements and attributes.
 * Raw iframe embeds are intentionally not allowed in editor previews.
 */
export const SANITIZE_SCHEMA = {
  ...defaultSchema,
  attributes: {
    ...defaultSchema.attributes,
    div: [...(defaultSchema.attributes?.div || []), "className"],
    span: [...(defaultSchema.attributes?.span || []), "className", ["aria*"], ["data*"]],
    annotation: ["encoding"],
    math: ["xmlns"],
    mi: [],
    mn: [],
    mo: [],
    mrow: [],
    mspace: [],
    mstyle: [],
    msup: [],
    msub: [],
    msubsup: [],
    mfrac: [],
    mtext: [],
    semantics: [],
  },
  tagNames: [
    ...(defaultSchema.tagNames || []),
    "math",
    "annotation",
    "semantics",
    "mi",
    "mn",
    "mo",
    "mrow",
    "mspace",
    "mstyle",
    "msup",
    "msub",
    "msubsup",
    "mfrac",
    "mtext",
  ],
};
