import { describe, expect, it } from "vitest";
import { createMarkdownParser } from "./parser";

function parse(input: string) {
  const md = createMarkdownParser();
  return md.parse(input, {});
}

function tokenTypes(input: string) {
  return parse(input).map((t) => t.type);
}

function findToken(input: string, type: string) {
  return parse(input).find((t) => t.type === type);
}

function findAllTokens(input: string, type: string) {
  return parse(input).filter((t) => t.type === type);
}

function inlineChildren(input: string) {
  const inline = parse(input).find((t) => t.type === "inline");
  return inline?.children || [];
}

// ── P0: Parser 基础解析 ──────────────────────────────

describe("createMarkdownParser", () => {
  it("returns a markdown-it instance", () => {
    const md = createMarkdownParser();
    expect(md).toBeDefined();
    expect(typeof md.parse).toBe("function");
  });

  it("returns the same cached instance", () => {
    const a = createMarkdownParser();
    const b = createMarkdownParser();
    expect(a).toBe(b);
  });
});

describe("headings", () => {
  it("parses h1", () => {
    expect(tokenTypes("# Hello")).toContain("heading_open");
    expect(findToken("# Hello", "heading_open")?.tag).toBe("h1");
  });

  it("parses h2", () => {
    expect(findToken("## World", "heading_open")?.tag).toBe("h2");
  });

  it("parses h3", () => {
    expect(findToken("### Deep", "heading_open")?.tag).toBe("h3");
  });

  it("does not parse # without space as heading", () => {
    expect(tokenTypes("#notheading")).not.toContain("heading_open");
  });
});

describe("paragraphs", () => {
  it("parses plain text as paragraph", () => {
    expect(tokenTypes("Hello world")).toContain("paragraph_open");
  });

  it("parses empty string", () => {
    const tokens = parse("");
    expect(tokens.length).toBe(0);
  });
});

describe("code blocks", () => {
  it("parses fenced code block", () => {
    const input = "```javascript\nconsole.log('hi');\n```";
    const fence = findToken(input, "fence");
    expect(fence).toBeDefined();
    expect(fence?.info).toBe("javascript");
    expect(fence?.content).toContain("console.log");
  });

  it("parses fenced code block without language", () => {
    const input = "```\nsome code\n```";
    const fence = findToken(input, "fence");
    expect(fence).toBeDefined();
    expect(fence?.info).toBe("");
  });

  it("parses mermaid code block", () => {
    const input = "```mermaid\nflowchart LR\n  A --> B\n```";
    const fence = findToken(input, "fence");
    expect(fence).toBeDefined();
    expect(fence?.info).toBe("mermaid");
    expect(fence?.content).toContain("flowchart");
  });
});

describe("lists", () => {
  it("parses bullet list", () => {
    const input = "- item 1\n- item 2";
    expect(tokenTypes(input)).toContain("bullet_list_open");
    expect(findAllTokens(input, "list_item_open").length).toBe(2);
  });

  it("parses ordered list", () => {
    const input = "1. first\n2. second";
    expect(tokenTypes(input)).toContain("ordered_list_open");
  });

  it("parses nested list", () => {
    const input = "- outer\n  - inner";
    const tokens = parse(input);
    const bulletLists = tokens.filter((t) => t.type === "bullet_list_open");
    expect(bulletLists.length).toBe(2);
  });
});

describe("blockquote", () => {
  it("parses blockquote", () => {
    const input = "> quoted text";
    expect(tokenTypes(input)).toContain("blockquote_open");
  });
});

describe("horizontal rule", () => {
  it("parses hr", () => {
    const input = "---";
    expect(tokenTypes(input)).toContain("hr");
  });
});

describe("table", () => {
  it("parses table", () => {
    const input = "| A | B |\n|---|---|\n| 1 | 2 |";
    expect(tokenTypes(input)).toContain("table_open");
    expect(tokenTypes(input)).toContain("thead_open");
    expect(tokenTypes(input)).toContain("tbody_open");
  });

  it("parses table with alignment", () => {
    const input = "| Left | Center | Right |\n|:-----|:------:|------:|\n| a | b | c |";
    const tokens = parse(input);
    const thOpen = tokens.filter((t) => t.type === "th_open");
    expect(thOpen.length).toBe(3);
  });
});

// ── P0: 自定义 inline 规则 ───────────────────────────

describe("tag rule", () => {
  it("parses #tag as tag token", () => {
    const children = inlineChildren("Hello #world");
    const tagToken = children.find((t) => t.type === "tag");
    expect(tagToken).toBeDefined();
    expect(tagToken?.content).toBe("world");
  });

  it("parses Chinese tags", () => {
    const children = inlineChildren("#整体架构概览");
    const tagToken = children.find((t) => t.type === "tag");
    expect(tagToken).toBeDefined();
    expect(tagToken?.content).toBe("整体架构概览");
  });

  it("does not parse ## as tag", () => {
    const children = inlineChildren("## heading");
    const tagToken = children.find((t) => t.type === "tag");
    expect(tagToken).toBeUndefined();
  });

  it("does not parse # followed by space as tag", () => {
    const children = inlineChildren("# heading");
    const tagToken = children.find((t) => t.type === "tag");
    expect(tagToken).toBeUndefined();
  });

  it("parses tag with slash", () => {
    const children = inlineChildren("#parent/child");
    const tagToken = children.find((t) => t.type === "tag");
    expect(tagToken).toBeDefined();
    expect(tagToken?.content).toBe("parent/child");
  });

  it("parses tag with underscore and dash", () => {
    const children = inlineChildren("#my_tag-name");
    const tagToken = children.find((t) => t.type === "tag");
    expect(tagToken?.content).toBe("my_tag-name");
  });
});

describe("highlight rule (==text==)", () => {
  it("parses highlight markup", () => {
    const children = inlineChildren("==highlighted==");
    const types = children.map((t) => t.type);
    expect(types).toContain("highlight_open");
    expect(types).toContain("highlight_close");
  });

  it("parses colored highlight markup", () => {
    const children = inlineChildren("=={color:FDEA9B}highlighted==");
    const highlight = children.find((t) => t.type === "highlight_open");
    const text = children.find((t) => t.type === "text");

    expect(highlight?.attrGet("data-color")).toBe("#FDEA9B");
    expect(text?.content).toBe("highlighted");
  });
});

describe("text color rule ({{color:RRGGBB|text}})", () => {
  it("parses text color markup", () => {
    const children = inlineChildren("{{color:DC2626|red text}}");
    const types = children.map((t) => t.type);

    expect(types).toContain("text_color_open");
    expect(types).toContain("text_color_close");
  });

  it("parses text color attrs", () => {
    const children = inlineChildren("{{color:DC2626|red text}}");
    const textColor = children.find((t) => t.type === "text_color_open");
    const text = children.find((t) => t.type === "text");

    expect(textColor?.attrGet("data-color")).toBe("#DC2626");
    expect(text?.content).toBe("red text");
  });

  it("does not parse color syntax as a tag", () => {
    const children = inlineChildren("{{color:DC2626|red text}} =={color:FDEA9B}highlighted==");

    expect(children.some((t) => t.type === "tag")).toBe(false);
  });
});

describe("underline rule (__text__)", () => {
  it("converts __ markup to underline", () => {
    const children = inlineChildren("__underlined__");
    const types = children.map((t) => t.type);
    expect(types).toContain("underline_open");
    expect(types).toContain("underline_close");
  });

  it("keeps * markup as emphasis (not underline)", () => {
    const children = inlineChildren("*italic*");
    const types = children.map((t) => t.type);
    expect(types).toContain("em_open");
    expect(types).not.toContain("underline_open");
  });
});

describe("math rule", () => {
  it("parses inline math $...$", () => {
    const children = inlineChildren("$E=mc^2$");
    const mathToken = children.find((t) => t.type === "math_inline");
    expect(mathToken).toBeDefined();
    expect(mathToken?.content).toBe("E=mc^2");
  });

  it("parses block math $$...$$", () => {
    const input = "$$\nx^2 + y^2 = z^2\n$$";
    const mathBlock = findToken(input, "math_block");
    expect(mathBlock).toBeDefined();
    expect(mathBlock?.content).toContain("x^2");
  });
});

describe("checkbox rule", () => {
  it("parses checked checkbox", () => {
    const input = "- [x] task done";
    const tokens = parse(input);
    const cbOpen = tokens.find((t) => t.type === "checkbox_item_open");
    expect(cbOpen).toBeDefined();
    expect(cbOpen?.attrGet("checked")).toBe("true");
  });

  it("parses unchecked checkbox", () => {
    const input = "- [ ] task todo";
    const tokens = parse(input);
    const cbOpen = tokens.find((t) => t.type === "checkbox_item_open");
    expect(cbOpen).toBeDefined();
    expect(cbOpen?.attrGet("checked")).toBeNull();
  });

  it("wraps checkbox list with checkbox_list_open/close", () => {
    const input = "- [x] done\n- [ ] todo";
    const tokens = parse(input);
    expect(tokens.some((t) => t.type === "checkbox_list_open")).toBe(true);
    expect(tokens.some((t) => t.type === "checkbox_list_close")).toBe(true);
  });

  it("does not affect regular bullet list", () => {
    const input = "- item 1\n- item 2";
    const tokens = parse(input);
    expect(tokens.some((t) => t.type === "checkbox_list_open")).toBe(false);
    expect(tokens.some((t) => t.type === "bullet_list_open")).toBe(true);
  });
});

describe("emoji", () => {
  it("parses emoji shortcodes", () => {
    const children = inlineChildren(":smile:");
    const emoji = children.find((t) => t.type === "emoji");
    expect(emoji).toBeDefined();
  });
});

// ── P0: inline 格式 ───────────────────────────────────

describe("inline formatting", () => {
  it("parses bold **text**", () => {
    const children = inlineChildren("**bold**");
    expect(children.some((t) => t.type === "strong_open")).toBe(true);
  });

  it("parses italic *text*", () => {
    const children = inlineChildren("*italic*");
    expect(children.some((t) => t.type === "em_open")).toBe(true);
  });

  it("parses strikethrough ~~text~~", () => {
    const children = inlineChildren("~~deleted~~");
    expect(children.some((t) => t.type === "s_open")).toBe(true);
  });

  it("parses inline code", () => {
    const children = inlineChildren("`code`");
    expect(children.some((t) => t.type === "code_inline")).toBe(true);
  });

  it("parses link", () => {
    const children = inlineChildren("[title](http://example.com)");
    const link = children.find((t) => t.type === "link_open");
    expect(link).toBeDefined();
    expect(link?.attrGet("href")).toBe("http://example.com");
  });

  it("parses image", () => {
    const children = inlineChildren("![alt](http://img.png)");
    const img = children.find((t) => t.type === "image");
    expect(img).toBeDefined();
    expect(img?.attrGet("src")).toBe("http://img.png");
  });
});

// ── P1: 边界情况与大文档 ──────────────────────────────

describe("edge cases", () => {
  it("handles very long input without crashing", () => {
    const longContent = "# Title\n\n" + "Hello world. ".repeat(10000) + "\n\n## End";
    const tokens = parse(longContent);
    expect(tokens.length).toBeGreaterThan(0);
    expect(tokens.some((t) => t.type === "heading_open")).toBe(true);
  });

  it("handles mixed content", () => {
    const input = `# Title

Some **bold** and *italic* text with \`code\` and a [link](http://x.com).

- list item 1
- list item 2

> blockquote

\`\`\`javascript
const x = 1;
\`\`\`

---

| A | B |
|---|---|
| 1 | 2 |

- [x] done
- [ ] todo

#tag1 #tag2
`;
    const tokens = parse(input);
    const types = tokens.map((t) => t.type);
    expect(types).toContain("heading_open");
    expect(types).toContain("paragraph_open");
    expect(types).toContain("bullet_list_open");
    expect(types).toContain("blockquote_open");
    expect(types).toContain("fence");
    expect(types).toContain("hr");
    expect(types).toContain("table_open");
    expect(types).toContain("checkbox_list_open");
  });

  it("treats HTML blocks as plain text", () => {
    const input = "<div>hello</div>";
    const tokens = parse(input);
    expect(tokens.some((t) => t.type === "html_block")).toBe(false);
    expect(tokens.some((t) => t.type === "paragraph_open")).toBe(true);
  });
});
