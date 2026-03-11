import * as React from "react";
import { ThemeProvider } from "styled-components";
import { createEditorTheme } from "@/outline-shims/app/theme";
import { richUIExtensions } from "~/editor/extensions";
import { pluginKey as mermaidPluginKey } from "@shared/editor/extensions/Mermaid";
import { isCode, isMermaid } from "@shared/editor/lib/isCode";
import { findParentNode } from "@shared/editor/queries/findParentNode";

import useDictionary from "@/outline-shims/app/hooks/useDictionary";

const LazyEditor = React.lazy(() => import("~/editor"));

export interface OutlineEditorWrapperProps {
  value: string;
  onChange?: (getValue: (asString?: boolean, trim?: boolean) => string) => void;
  onSave?: (options: { done: boolean }) => void;
  onReady?: () => void;
  readOnly?: boolean;
  autoFocus?: boolean;
  placeholder?: string;
  className?: string;
  id?: string;
}

function useIsDarkMode(): boolean {
  const [isDark, setIsDark] = React.useState(() => {
    if (typeof window === "undefined") return false;
    return (
      document.documentElement.classList.contains("dark") ||
      window.matchMedia("(prefers-color-scheme: dark)").matches
    );
  });

  React.useEffect(() => {
    const mq = window.matchMedia("(prefers-color-scheme: dark)");
    const handler = (e: MediaQueryListEvent) => setIsDark(e.matches);
    mq.addEventListener("change", handler);

    const observer = new MutationObserver(() => {
      setIsDark(document.documentElement.classList.contains("dark"));
    });
    observer.observe(document.documentElement, {
      attributes: true,
      attributeFilter: ["class"],
    });

    return () => {
      mq.removeEventListener("change", handler);
      observer.disconnect();
    };
  }, []);

  return isDark;
}

const defaultOnClickLink = (
  href: string,
  event?: MouseEvent | React.MouseEvent<HTMLButtonElement>
) => {
  if (event) {
    event.preventDefault();
  }
  window.open(href, "_blank", "noopener,noreferrer");
};

function OutlineEditorWrapper({
  value,
  onChange,
  onSave,
  onReady,
  readOnly = false,
  autoFocus = false,
  placeholder,
  className,
  id,
}: OutlineEditorWrapperProps) {
  const isDark = useIsDarkMode();
  const dictionary = useDictionary();
  const theme = React.useMemo(() => createEditorTheme(isDark), [isDark]);
  const readyCalled = React.useRef(false);
  const editorInstanceRef = React.useRef<any>(null);
  const wrapperRef = React.useRef<HTMLDivElement>(null);

  const editorRefCallback = React.useCallback(
    (instance: any) => {
      editorInstanceRef.current = instance;
      if (instance && !readyCalled.current) {
        readyCalled.current = true;
        onReady?.();
      }
    },
    [onReady]
  );

  // External mouseup listener: when user clicks a Mermaid diagram,
  // automatically set editingId so the code-active decoration is applied.
  // This adapts Outline's edit_mermaid command without modifying vendor code.
  React.useEffect(() => {
    const wrapper = wrapperRef.current;
    if (!wrapper) return;

    const handleMouseUp = (e: Event) => {
      const target = e.target as HTMLElement;
      const diagram = target?.closest?.(".mermaid-diagram-wrapper");
      if (!diagram) return;

      const pmEl = wrapper.querySelector(".ProseMirror") as HTMLElement | null;
      if (!pmEl) return;

      // Find the EditorView — Outline stores it on the editor instance
      const editor = editorInstanceRef.current;
      const view = editor?.view;
      if (!view?.state) return;

      // Wait a tick for the vendor mouseup handler to set the selection first
      requestAnimationFrame(() => {
        const state = view.state;
        const codeBlock = findParentNode(isCode)(state.selection);
        if (!codeBlock || !isMermaid(codeBlock.node)) return;

        const mermaidState = mermaidPluginKey.getState(state) as any;
        if (!mermaidState) return;

        const decorations = mermaidState.decorationSet?.find(
          codeBlock.pos,
          codeBlock.pos + codeBlock.node.nodeSize
        );
        const nodeDecoration = decorations?.find(
          (d: any) => d.spec?.diagramId && d.from === codeBlock.pos
        );
        const diagramId = nodeDecoration?.spec?.diagramId;

        if (diagramId && mermaidState.editingId !== diagramId) {
          view.dispatch(
            state.tr.setMeta(mermaidPluginKey, { editingId: diagramId })
          );
        }
      });
    };

    wrapper.addEventListener("mouseup", handleMouseUp, true);
    return () => wrapper.removeEventListener("mouseup", handleMouseUp, true);
  }, []);

  const handleChange = React.useCallback(
    (getValue: (asString?: boolean, trim?: boolean) => string) => {
      onChange?.(getValue);
    },
    [onChange]
  );

  const handleSave = React.useCallback(
    (options: { done: boolean }) => {
      onSave?.(options);
    },
    [onSave]
  );

  return (
    <ThemeProvider theme={theme}>
      <div ref={wrapperRef}>
        <React.Suspense
          fallback={
            <div style={{ padding: "16px", opacity: 0.5 }}>
              Loading editor...
            </div>
          }
        >
          <LazyEditor
            ref={editorRefCallback}
            defaultValue={value}
            dictionary={dictionary}
            extensions={richUIExtensions}
            userId="anonymous"
            onChange={handleChange}
            onSave={handleSave}
            onClickLink={defaultOnClickLink}
            readOnly={readOnly}
            autoFocus={autoFocus}
            placeholder={placeholder || "Write something..."}
            embeds={[]}
            id={id}
            className={className}
          />
        </React.Suspense>
      </div>
    </ThemeProvider>
  );
}

export default OutlineEditorWrapper;
