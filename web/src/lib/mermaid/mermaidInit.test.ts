import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { renderMermaid } from "./mermaidInit";

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

const installSvgMeasurementStubs = () => {
  const svgPrototype = SVGElement.prototype as SVGElement & {
    getBBox?: () => DOMRect;
    getComputedTextLength?: () => number;
  };

  if (!svgPrototype.getBBox) {
    svgPrototype.getBBox = function getBBox() {
      const text = this.textContent ?? "";
      return { x: 0, y: 0, width: Math.max(20, text.length * 7), height: 20 } as DOMRect;
    };
  }

  if (!svgPrototype.getComputedTextLength) {
    svgPrototype.getComputedTextLength = function getComputedTextLength() {
      return Math.max(20, (this.textContent ?? "").length * 7);
    };
  }
};

describe("renderMermaid", () => {
  beforeEach(() => {
    installSvgMeasurementStubs();
    vi.spyOn(Math, "random").mockReturnValue(0.123456789);
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("renders C++ callchain flowcharts with multiline labels", async () => {
    const { svg } = await renderMermaid(cppCallchainMermaid, { theme: "default", fontFamily: "inherit" });

    expect(svg).toContain("ByteExpressContext::Init()");
    expect(svg).toContain("byte_express_context.cpp:95");
    expect(svg.toLowerCase()).toContain("foreignobject");
  });
});
