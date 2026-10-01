// Explicit opt-in live integration check: sends synthetic text only to the local proxy.
import { strict as assert } from "node:assert";
import { CodexSwitchProvider } from "../src/modules/providers/CodexSwitchProvider";
import type { ChatMessage } from "../src/types/chat";
import type { ToolDefinition } from "../src/types/tool";

(globalThis as any).ztoolkit = { log() {} };
const provider = new CodexSwitchProvider(
  {
    id: "codex-switch",
    name: "Codex Switch",
    type: "custom",
    isBuiltin: true,
    order: 0,
    enabled: true,
    apiKey: process.env.CODEX_LOCAL_KEY || "",
    baseUrl: process.env.CODEX_LOCAL_BASE_URL || "http://127.0.0.1:15722/v1",
    defaultModel: process.env.CODEX_LOCAL_MODEL || "gpt-6.1-sol",
    availableModels: [],
    apiProtocol: "codex-switch",
    temperature: 0.7,
    maxTokens: 8192,
    reasoningEffort: "low",
  },
  { sessionId: "paperchat-integration-test" },
);
const msg = (
  id: string,
  role: ChatMessage["role"],
  content: string,
): ChatMessage => ({ id, role, content, timestamp: 0 });

async function main() {
  const models = await provider.getAvailableModels();
  assert(models.includes(provider.config.defaultModel));
  console.log("PASS discovery:", models.join(", "));
  assert(await provider.testConnection());
  console.log("PASS generation-based connection test");
  const input = [
    msg(
      "translate",
      "user",
      "Translate into Chinese, output only the translation: Precipitation nowcasting predicts rainfall in the next few hours.",
    ),
  ];
  let streamed = "",
    complete = "";
  await provider.streamChatCompletion(input, {
    onChunk: (s) => {
      streamed += s;
    },
    onComplete: (s) => {
      complete = s;
    },
    onError: (e) => {
      throw e;
    },
  });
  assert.match(complete, /[\u4e00-\u9fff]/);
  assert.equal(streamed, complete);
  console.log("PASS streaming translation:", complete);
  const tools: ToolDefinition[] = [
    {
      type: "function",
      function: {
        name: "read_paper",
        description: "Read the synthetic paper content.",
        parameters: { type: "object", properties: {}, required: [] },
      },
    },
  ];
  const history = [
    msg(
      "q1",
      "user",
      "Use read_paper to read the paper, then report its forecast horizon. Do not guess.",
    ),
  ];
  const call = await provider.chatCompletionWithTools(history, tools);
  assert.equal(call.toolCalls?.[0]?.function.name, "read_paper");
  console.log("PASS tool request:", call.toolCalls![0].function.name);
  history.push({
    ...msg("a1", "assistant", call.content),
    tool_calls: call.toolCalls,
  });
  history.push({
    ...msg(
      "t1",
      "tool",
      "Synthetic test paper: the model predicts rainfall over the next 120 minutes.",
    ),
    tool_call_id: call.toolCalls![0].id,
  });
  const reply = await provider.chatCompletionWithTools(
    history,
    tools,
    undefined,
    { toolChoice: "none" },
  );
  assert.match(reply.content, /120|two hours|2 hours/);
  console.log("PASS tool result follow-up:", reply.content);
  history.push(
    msg("a2", "assistant", reply.content),
    msg("q2", "user", "How many hours is that? Answer briefly in Chinese."),
  );
  const followup = await provider.chatCompletion(history);
  assert.match(followup, /2|两|二/);
  console.log("PASS multi-turn context:", followup);
}
main().catch((error) => {
  console.error(error.message);
  process.exitCode = 1;
});
