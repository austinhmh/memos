import { create } from "@bufbuild/protobuf";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { useMemo, useState } from "react";
import { createRoot } from "react-dom/client";
import { MemoryRouter } from "react-router-dom";
import { MemoViewContext } from "@/components/MemoView/MemoViewContext";
import { AuthProvider } from "@/contexts/AuthContext";
import { MemoFilterProvider } from "@/contexts/MemoFilterContext";
import { MarkdownRenderer } from "@/lib/markdown/MarkdownRenderer";
import { State } from "@/types/proto/api/v1/common_pb";
import { MemoSchema, Visibility } from "@/types/proto/api/v1/memo_service_pb";
import { User_Role, UserSchema } from "@/types/proto/api/v1/user_service_pb";
import BlogEditor from "../index";
import "@/index.css";

const initialContent = `# gcache整体介绍

主要

| File | Note |
|---|---|
| Seed | Ready |

https://docs.nvidia.com/example.pdf`;

const queryClient = new QueryClient({
  defaultOptions: {
    queries: { retry: false },
    mutations: { retry: false },
  },
});

const currentUser = create(UserSchema, {
  name: "users/e2e",
  username: "e2e",
  role: User_Role.USER,
});

const createMemo = (content: string) =>
  create(MemoSchema, {
    name: "memos/e2e-table",
    creator: currentUser.name,
    state: State.NORMAL,
    content,
    visibility: Visibility.PUBLIC,
  });

const App = () => {
  const [content, setContent] = useState(initialContent);
  const memo = useMemo(() => createMemo(content), [content]);
  const contextValue = useMemo(
    () => ({
      memo,
      creator: currentUser,
      currentUser,
      parentPage: "/writing",
      isArchived: false,
      readonly: false,
      showNSFWContent: true,
      nsfw: false,
    }),
    [memo],
  );

  return (
    <QueryClientProvider client={queryClient}>
      <MemoryRouter initialEntries={["/__e2e__/blog-editor-table"]}>
        <AuthProvider>
          <MemoFilterProvider>
            <MemoViewContext.Provider value={contextValue}>
              <main style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 24, padding: 24 }}>
                <section aria-label="editor-section">
                  <h1>BlogEditor Table E2E</h1>
                  <BlogEditor
                    memo={memo}
                    readonly={false}
                    normalizeBeforeSave={(nextContent) => {
                      setContent(nextContent);
                      return nextContent;
                    }}
                  />
                </section>
                <section aria-label="readonly-section">
                  <h2>Readonly output</h2>
                  <div className="blog-editor">
                    <div className="blog-editor-content ProseMirror" data-testid="readonly-output">
                      <MarkdownRenderer content={content} />
                    </div>
                  </div>
                  <pre data-testid="saved-markdown">{content}</pre>
                </section>
              </main>
            </MemoViewContext.Provider>
          </MemoFilterProvider>
        </AuthProvider>
      </MemoryRouter>
    </QueryClientProvider>
  );
};

createRoot(document.getElementById("root")!).render(<App />);
