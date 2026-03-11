import * as React from "react";

export function Emoji({ emoji, size, children }: { emoji?: string; size?: number; children?: React.ReactNode }) {
  return <span style={{ fontSize: size || 16 }}>{children || emoji}</span>;
}
