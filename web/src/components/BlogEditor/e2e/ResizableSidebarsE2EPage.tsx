import { createRoot } from "react-dom/client";
import { useResizableSidebars } from "@/hooks/useResizableSidebars";
import "@/index.css";

const ResizableSidebarsE2EPage = () => {
  const { containerRef, leftWidth, rightWidth, leftResizeHandleProps, rightResizeHandleProps } = useResizableSidebars({
    storageKey: "e2e-resizable-sidebars",
  });

  return (
    <main className="h-screen w-screen bg-background text-foreground p-6">
      <section ref={containerRef} className="flex h-full w-full min-w-0 items-stretch overflow-hidden border border-border rounded-lg">
        <aside data-testid="left-panel" className="shrink-0 bg-sidebar p-4" style={{ width: `${leftWidth}%` }}>
          Left panel
        </aside>
        <div
          data-testid="left-resize-handle"
          className="group relative z-10 -mx-2 w-4 shrink-0 cursor-col-resize self-stretch touch-none select-none"
          {...leftResizeHandleProps}
        >
          <div className="mx-auto h-full w-px bg-border/60 transition-colors group-hover:bg-primary/60 group-active:bg-primary" />
        </div>
        <article data-testid="center-panel" className="min-w-0 flex-1 p-4">
          Center panel
        </article>
        <div
          data-testid="right-resize-handle"
          className="group relative z-10 -mx-2 w-4 shrink-0 cursor-col-resize self-stretch touch-none select-none"
          {...rightResizeHandleProps}
        >
          <div className="mx-auto h-full w-px bg-border/60 transition-colors group-hover:bg-primary/60 group-active:bg-primary" />
        </div>
        <aside data-testid="right-panel" className="shrink-0 bg-sidebar p-4" style={{ width: `${rightWidth}%` }}>
          Right panel
        </aside>
      </section>
    </main>
  );
};

createRoot(document.getElementById("root")!).render(<ResizableSidebarsE2EPage />);
