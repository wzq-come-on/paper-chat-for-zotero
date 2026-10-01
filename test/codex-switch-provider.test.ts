import { assert } from "chai";
import {
  CodexSwitchProvider,
  isLoopbackUrl,
} from "../src/modules/providers/CodexSwitchProvider";
import {
  parseResponsesSSEStream,
  resetOpenAIResponsesStateForTests,
} from "../src/modules/providers/OpenAIResponsesProvider";
import type { ApiKeyProviderConfig } from "../src/types/provider";

const originalFetch = globalThis.fetch;
const config = (
  overrides: Partial<ApiKeyProviderConfig> = {},
): ApiKeyProviderConfig => ({
  id: "codex-switch",
  name: "Codex Switch",
  type: "custom",
  enabled: true,
  isBuiltin: true,
  order: 0,
  apiKey: "",
  baseUrl: "http://127.0.0.1:15722/v1/",
  defaultModel: "gpt-6.1-sol",
  availableModels: [],
  apiProtocol: "codex-switch",
  temperature: 0.7,
  maxTokens: 8192,
  ...overrides,
});
const message = {
  id: "u",
  role: "user" as const,
  content: "Translate rainfall",
  timestamp: 0,
};
const outputItem = {
  id: "msg_1",
  type: "message",
  role: "assistant",
  phase: "final_answer",
  status: "completed",
  content: [{ type: "output_text", text: "降雨" }],
};
function sse(events: unknown[]): Response {
  return new Response(
    events.map((e) => `data: ${JSON.stringify(e)}\n\n`).join(""),
    { headers: { "Content-Type": "text/event-stream" } },
  );
}
function reply(): Response {
  return sse([
    { type: "response.created", response: { id: "r1", store: false } },
    { type: "response.output_text.delta", delta: "降雨" },
    { type: "response.output_item.done", output_index: 0, item: outputItem },
    {
      type: "response.completed",
      response: { id: "r1", status: "completed", output: [] },
    },
  ]);
}

describe("Codex Switch local gateway", function () {
  it("decodes the gateway SSE even when Content-Type is missing", async function () {
    (globalThis as any).ztoolkit = { log() {} };
    globalThis.fetch = (async () => {
      const response = reply();
      response.headers.delete("Content-Type");
      return response;
    }) as typeof fetch;
    assert.equal(
      await new CodexSwitchProvider(config()).chatCompletion([message]),
      "降雨",
    );
  });

  beforeEach(function () {
    (globalThis as any).ztoolkit = { log() {} };
    resetOpenAIResponsesStateForTests();
  });

  afterEach(function () {
    globalThis.fetch = originalFetch;
  });

  it("permits keyless loopback but requires a key for remote access", function () {
    assert.isTrue(new CodexSwitchProvider(config()).isReady());
    assert.isFalse(
      new CodexSwitchProvider(
        config({ baseUrl: "http://192.168.1.2:15722/v1" }),
      ).isReady(),
    );
    assert.isTrue(
      new CodexSwitchProvider(
        config({ baseUrl: "http://192.168.1.2:15722/v1", apiKey: "test-key" }),
      ).isReady(),
    );
    assert.isFalse(isLoopbackUrl("http://localhost.example.org/v1"));
    assert.isFalse(isLoopbackUrl("file:///tmp"));
  });

  it("adds client_version only to models and reads exact visible model slugs", async function () {
    globalThis.fetch = (async (input) => {
      const url = new URL(String(input));
      assert.equal(url.pathname, "/v1/models");
      assert.equal(url.searchParams.get("client_version"), "0.160.0");
      return new Response(
        JSON.stringify({
          models: [
            { slug: "gpt-6.1-sol", display_name: "GPT-6.1-Sol" },
            { slug: "hidden", visibility: "hide" },
          ],
        }),
      );
    }) as typeof fetch;
    assert.deepEqual(
      await new CodexSwitchProvider(
        config({ clientVersion: "0.160.0" }),
      ).getAvailableModels(),
      ["gpt-6.1-sol"],
    );
  });

  it("surfaces HTTP model errors instead of returning a misleading cached list", async function () {
    globalThis.fetch = (async () =>
      new Response('{"error":{"message":"bad key"}}', {
        status: 401,
      })) as typeof fetch;
    try {
      await new CodexSwitchProvider(config()).getAvailableModels();
      assert.fail("expected rejection");
    } catch (error) {
      assert.match(String(error), /401|bad key/);
    }
  });

  it("uses streaming Responses for non-streaming callers and removes unsupported parameters", async function () {
    globalThis.fetch = (async (input, init) => {
      assert.equal(String(input), "http://127.0.0.1:15722/v1/responses");
      const body = JSON.parse(String(init?.body));
      assert.equal(body.stream, true);
      assert.equal(body.store, false);
      assert.notProperty(body, "temperature");
      assert.notProperty(body, "max_output_tokens");
      assert.include(body.include, "reasoning.encrypted_content");
      assert.notProperty(init?.headers, "Authorization");
      return reply();
    }) as typeof fetch;
    assert.equal(
      await new CodexSwitchProvider(config()).chatCompletion([message]),
      "降雨",
    );
  });

  it("streams translation deltas and preserves completion text", async function () {
    globalThis.fetch = (async () => reply()) as typeof fetch;
    let chunks = "",
      full = "";
    await new CodexSwitchProvider(config()).streamChatCompletion([message], {
      onChunk: (s) => {
        chunks += s;
      },
      onComplete: (s) => {
        full = s;
      },
      onError: (e) => {
        throw e;
      },
    });
    assert.equal(chunks, "降雨");
    assert.equal(full, chunks);
  });

  it("retains encrypted reasoning, tool IDs and message phases from item events when terminal output is empty", async function () {
    const reasoning = {
      type: "reasoning",
      id: "rs_1",
      encrypted_content: "opaque-test-value",
      summary: [],
    };
    const tool = {
      type: "function_call",
      id: "fc_1",
      call_id: "call_1",
      name: "read_paper",
      arguments: "{}",
    };
    const response = sse([
      { type: "response.output_item.done", output_index: 2, item: outputItem },
      { type: "response.output_item.done", output_index: 0, item: reasoning },
      { type: "response.output_item.done", output_index: 1, item: tool },
      {
        type: "response.completed",
        response: { id: "r1", status: "completed", output: [] },
      },
    ]);
    const result = await parseResponsesSSEStream(
      response.body!.getReader(),
      {},
    );
    assert.deepEqual(result.output, [reasoning, tool, outputItem]);
  });

  it("fails testConnection when generation fails even though discovery succeeds", async function () {
    globalThis.fetch = (async (input) =>
      String(input).includes("/models")
        ? new Response(JSON.stringify({ models: [{ slug: "gpt-6.1-sol" }] }))
        : new Response('{"error":{"message":"upstream offline"}}', {
            status: 502,
          })) as typeof fetch;
    try {
      await new CodexSwitchProvider(config()).testConnection();
      assert.fail("expected rejection");
    } catch (error) {
      assert.match(String(error), /502|upstream offline/);
    }
  });

  it("propagates cancellation to the gateway fetch", async function () {
    const controller = new AbortController();
    controller.abort();
    globalThis.fetch = (async (_input, init) => {
      assert.equal(init?.signal, controller.signal);
      throw new DOMException("aborted", "AbortError");
    }) as typeof fetch;
    try {
      await new CodexSwitchProvider(config()).chatCompletion(
        [message],
        controller.signal,
      );
      assert.fail("expected rejection");
    } catch (error) {
      assert.equal((error as Error).name, "AbortError");
    }
  });
});
