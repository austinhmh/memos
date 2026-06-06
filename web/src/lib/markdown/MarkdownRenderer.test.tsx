import { create } from "@bufbuild/protobuf";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { afterEach, describe, expect, it, vi } from "vitest";
import { MemoViewContext } from "@/components/MemoView/MemoViewContext";
import { MemoFilterProvider } from "@/contexts/MemoFilterContext";
import { State } from "@/types/proto/api/v1/common_pb";
import { MemoSchema, Visibility } from "@/types/proto/api/v1/memo_service_pb";
import { MarkdownRenderer } from "./MarkdownRenderer";

const { renderMermaidMock } = vi.hoisted(() => ({
  renderMermaidMock: vi.fn(),
}));

vi.mock("@/contexts/AuthContext", () => ({
  useAuth: () => ({
    userGeneralSetting: { theme: "default" },
  }),
}));

vi.mock("@/lib/mermaid/mermaidInit", () => ({
  renderMermaid: renderMermaidMock,
}));

const cppCallchainMermaid = `flowchart TD
 ByteExpressContext_Init["ByteExpressContext::Init()
 byte_express_context.cpp:95"] --> RdmaEventDispatcher_ctor["RdmaEventDispatcher::RdmaEventDispatcher()
 rdma_event_dispatcher.cpp:26"]

 RdmaEventDispatcher_ctor --> RdmaEventDispatcher_CreateIdentifier["RdmaEventDispatcher::CreateIdentifier()
 rdma_event_dispatcher.cpp:64"]
 RdmaEventDispatcher_ctor --> RdmaContext_GetContexts["RdmaContext::GetContexts()
 rdma_context.cpp:13"]

 RdmaContext_GetContexts --> RdmaContext_ctor["RdmaContext::RdmaContext()
 rdma_context.cpp:41"]
 RdmaContext_ctor --> Worker_Context_ctor["Worker::Context::Context()
 worker.cpp:178"]
 Worker_Context_ctor --> Worker_EventContext_ctor["Worker::EventContext::EventContext()
 worker.cpp:327"]

 RdmaEventDispatcher_CreateIdentifier --> ClientEngine_DoResolveAddress["ClientEngine::DoResolveAddress()
 client_engine.cpp:70"]
 ClientEngine_DoResolveAddress --> ClientEngine_OnAddrResolvedEvent["ClientEngine::OnAddrResolvedEvent()
 client_engine.cpp:133"]
 ClientEngine_OnAddrResolvedEvent --> Engine_CreateResources["Engine::CreateResources()
 engine.cpp:714"]

 RdmaEventDispatcher_CreateIdentifier --> RdmaListener_BindListen["RdmaListener::Bind()/Listen()
 rdma_listener.cpp:29"]
 RdmaListener_BindListen --> RdmaListener_OnConnectRequestEvent["RdmaListener::OnConnectRequestEvent()
 rdma_listener.cpp:96"]

 Engine_CreateResources --> Engine_CreateQP["Engine::CreateQP()
 engine.cpp:737"]
 Engine_CreateQP --> ReceiveQueue_DoReload["Shared/UniqueRdmaReceiveQueue::DoReload()
 rdma_receive_queue.cpp:73/183"]

 Engine_CreateQP --> ClientEngine_DoConnect["ClientEngine::DoConnect()
 client_engine.cpp:217"]
 ClientEngine_DoConnect --> ServerEngine_DoAccept["ServerEngine::DoAccept()
 server_engine.cpp:72"]
 ServerEngine_DoAccept --> Engine_ActivateQP["Engine::ActivateQP()
 engine.cpp:633"]
 ServerEngine_DoAccept --> ClientEngine_OnConnectResponseEvent["ClientEngine::OnConnectResponseEvent()
 client_engine.cpp:182"]
 ClientEngine_OnConnectResponseEvent --> Engine_ActivateQP

 Engine_ActivateQP --> Engine_DoSend["Engine::DoSend()
 engine.cpp:1188"]
 Engine_DoSend --> Engine_Transmit["Engine::Transmit()
 engine.cpp:383"]
 Engine_Transmit --> Worker_Context_Poll["Worker::Context::Poll()
 worker.cpp:246"]
 Worker_Context_Poll --> Engine_HandleWorkCompletion["Engine::HandleWorkCompletion()
 engine.cpp:446"]`;

const mermaidSvgWithForeignObject = `<svg xmlns="http://www.w3.org/2000/svg" role="graphics-document document">
  <g class="node">
    <foreignObject width="240" height="48">
      <div xmlns="http://www.w3.org/1999/xhtml">ByteExpressContext::Init()<br />byte_express_context.cpp:95</div>
    </foreignObject>
  </g>
</svg>`;

const renderReadonlyMemoMarkdown = (content: string) => {
  const queryClient = new QueryClient({
    defaultOptions: {
      queries: { retry: false },
      mutations: { retry: false },
    },
  });
  const memo = create(MemoSchema, {
    name: "memos/test",
    creator: "users/test",
    state: State.NORMAL,
    content,
    visibility: Visibility.PUBLIC,
  });

  return render(
    <QueryClientProvider client={queryClient}>
      <MemoryRouter initialEntries={["/blog/test"]}>
        <MemoFilterProvider>
          <MemoViewContext.Provider
            value={{
              memo,
              creator: undefined,
              currentUser: undefined,
              parentPage: "/writing",
              isArchived: false,
              readonly: true,
              showNSFWContent: true,
              nsfw: false,
            }}
          >
            <MarkdownRenderer content={content} />
          </MemoViewContext.Provider>
        </MemoFilterProvider>
      </MemoryRouter>
    </QueryClientProvider>,
  );
};

afterEach(() => {
  renderMermaidMock.mockReset();
});

describe("MarkdownRenderer", () => {
  it("does not throw when clicking malformed hash links", () => {
    render(<MarkdownRenderer content="[bad hash](#%E0%A4%A)" />);

    expect(() => fireEvent.click(screen.getByRole("link", { name: "bad hash" }))).not.toThrow();
  });

  it("renders readonly blog markdown tables with tag and checkbox renderers inside MemoViewContext", () => {
    const { container } = renderReadonlyMemoMarkdown(
      "#blog\n\n- [ ] todo\n\n| File | Note |\n|---|---|\n| [edit-link.pdf 123](/file/attachments/test/edit-link.pdf) | ok |",
    );

    expect(screen.getByText("#blog")).toBeTruthy();
    expect(screen.getByText("todo")).toBeTruthy();
    expect(container.querySelector("table")).not.toBeNull();
    expect(container.textContent).toContain("edit-link.pdf 123");
    expect(container.textContent).not.toContain("编辑链接");
  });

  it("keeps Mermaid foreignObject labels for C++ callchain flowcharts", async () => {
    renderMermaidMock.mockResolvedValue({ svg: mermaidSvgWithForeignObject });

    const { container } = render(<MarkdownRenderer content={`\`\`\`mermaid\n${cppCallchainMermaid}\n\`\`\``} />);

    await waitFor(() => expect(renderMermaidMock).toHaveBeenCalledWith(cppCallchainMermaid, { theme: "default" }));
    await waitFor(() => expect(container.innerHTML).toContain("ByteExpressContext::Init()"));

    expect(container.innerHTML.toLowerCase()).toContain("foreignobject");
    expect(container.textContent).toContain("byte_express_context.cpp:95");
  });
});
