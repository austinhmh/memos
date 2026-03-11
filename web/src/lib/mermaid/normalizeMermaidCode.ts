/**
 * 规范化 Mermaid 代码，修正常见笔误，避免 "No diagram type detected" 等错误。
 * 在调用 mermaid.render 前对 code 调用一次。
 */
export function normalizeMermaidCode(code: string): string {
  if (!code || typeof code !== "string") return code;
  let s = code.trimStart();
  // 常见笔误：dfaflowchart -> flowchart（Mermaid 只识别 flowchart/graph 等）
  const diagramTypeFixes: [RegExp, string][] = [
    [/\bdfaflowchart\b/gi, "flowchart"],
    [/\bflowcharte?\b/gi, "flowchart"],
    [/\bflowchartt\b/gi, "flowchart"],
  ];
  for (const [re, replacement] of diagramTypeFixes) {
    s = s.replace(re, replacement);
  }
  return s;
}
