export type RenderLimit = {
  label: string;
  maxChars: number;
  maxLines: number;
};

export const MERMAID_RENDER_LIMIT: RenderLimit = {
  label: "Mermaid diagram",
  maxChars: 12_000,
  maxLines: 220,
};

export const MATH_RENDER_LIMIT: RenderLimit = {
  label: "Math expression",
  maxChars: 4_000,
  maxLines: 80,
};

const FALLBACK_TEXT_MAX_CHARS = 2_000;

export function getRenderLimitMessage(content: string, limit: RenderLimit): string {
  if (content.length > limit.maxChars) {
    return `${limit.label} is too large to render safely (${content.length}/${limit.maxChars} characters).`;
  }

  let lineCount = 1;
  for (let index = 0; index < content.length; index++) {
    if (content.charCodeAt(index) === 10) {
      lineCount++;
      if (lineCount > limit.maxLines) {
        return `${limit.label} is too large to render safely (${lineCount}/${limit.maxLines} lines).`;
      }
    }
  }

  return "";
}

export function getRenderFallbackText(content: string): string {
  if (content.length <= FALLBACK_TEXT_MAX_CHARS) {
    return content;
  }

  return `${content.slice(0, FALLBACK_TEXT_MAX_CHARS)}\n…`;
}
