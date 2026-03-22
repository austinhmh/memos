import mermaid from "mermaid";
import elkLayouts from "@mermaid-js/layout-elk";

let elkRegistered = false;

export async function ensureElkRegistered() {
  if (!elkRegistered) {
    mermaid.registerLayoutLoaders(elkLayouts);
    elkRegistered = true;
  }
}

export function initMermaid(options: { theme: "default" | "dark"; fontFamily?: string }) {
  mermaid.initialize({
    startOnLoad: false,
    theme: options.theme,
    securityLevel: "strict",
    fontFamily: options.fontFamily ?? "inherit",
    layout: "elk",
    flowchart: {
      padding: 20,
      nodeSpacing: 80,
      rankSpacing: 60,
      useMaxWidth: true,
      htmlLabels: true,
      curve: "basis",
      defaultRenderer: "elk",
    },
    block: {
      padding: 20,
    },
    sequence: {
      useMaxWidth: true,
    },
    elk: {
      mergeEdges: true,
      nodePlacementStrategy: "BRANDES_KOEPF",
    },
  });
}

export async function renderMermaid(code: string, options: { theme: "default" | "dark"; fontFamily?: string }) {
  await ensureElkRegistered();
  initMermaid(options);

  const id = `mermaid-${Math.random().toString(36).substring(7)}`;
  return mermaid.render(id, code);
}
