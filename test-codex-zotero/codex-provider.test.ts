import { assert } from "chai";
import { ProviderManager } from "../src/modules/providers/ProviderManager";
import { CodexSwitchProvider } from "../src/modules/providers/CodexSwitchProvider";
import { OpenAICompatibleProvider } from "../src/modules/providers/OpenAICompatibleProvider";
import { config } from "../package.json";
import type { ApiKeyProviderConfig } from "../src/types/provider";

const key = `${config.prefsPrefix}.providersConfig`;

describe("Codex Switch in Zotero", function () {
  it("uses real Firefox fetch for model discovery, translation and tool round-trips", async function () {
    (globalThis as any).ztoolkit = { log() {} };
    const provider = new CodexSwitchProvider(
      {
        id: "codex-switch",
        name: "Test gateway",
        type: "custom",
        apiProtocol: "codex-switch",
        enabled: true,
        isBuiltin: true,
        order: 0,
        apiKey: "",
        baseUrl: "http://127.0.0.1:18741/v1",
        defaultModel: "synthetic-codex",
        availableModels: [],
        maxTokens: 8192,
        temperature: 0.7,
      },
      { sessionId: "zotero-synthetic" },
    );
    assert.deepEqual(await provider.getAvailableModels(), ["synthetic-codex"]);
    assert.isTrue(await provider.testConnection());
    const history: any[] = [
      { id: "u1", role: "user", content: "Translate rainfall", timestamp: 0 },
    ];
    let text = "";
    await provider.streamChatCompletion(history, {
      onChunk: (s) => {
        text += s;
      },
      onComplete: (s) => {
        assert.equal(text, s);
      },
      onError: (e) => {
        throw e;
      },
    });
    assert.equal(text, "降雨预报：两小时。");
    const tools: any[] = [
      {
        type: "function",
        function: {
          name: "read_paper",
          description: "Read synthetic paper",
          parameters: { type: "object", properties: {} },
        },
      },
    ];
    const call = await provider.chatCompletionWithTools(history, tools);
    assert.equal(call.toolCalls?.[0].function.name, "read_paper");
    history.push({
      id: "a1",
      role: "assistant",
      content: "",
      timestamp: 0,
      tool_calls: call.toolCalls,
    });
    history.push({
      id: "t1",
      role: "tool",
      content: "Forecast horizon: two hours",
      timestamp: 0,
      tool_call_id: call.toolCalls![0].id,
    });
    assert.equal(
      (await provider.chatCompletionWithTools(history, tools)).content,
      "降雨预报：两小时。",
    );
  });
  let original: unknown;
  let manager: ProviderManager | undefined;

  beforeEach(function () {
    (globalThis as any).ztoolkit = {
      log: (...args: unknown[]) => Zotero.debug(args.map(String).join(" ")),
    };
    (globalThis as any).addon = (Zotero as any)[config.addonInstance];
    original = Zotero.Prefs.get(key, true);
    Zotero.Prefs.set(
      key,
      JSON.stringify({
        activeProviderId: "deepseek",
        providers: [
          {
            id: "paperchat",
            name: "PaperChat",
            type: "paperchat",
            enabled: true,
            isBuiltin: true,
            order: 0,
            availableModels: [],
          },
          {
            id: "deepseek",
            name: "DeepSeek",
            type: "openai-compatible",
            enabled: true,
            isBuiltin: true,
            order: 1,
            apiKey: "synthetic-key",
            baseUrl: "https://api.example.test/v1",
            defaultModel: "synthetic",
            availableModels: ["synthetic"],
          },
        ],
      }),
      true,
    );
  });

  afterEach(function () {
    manager?.destroy();
    manager = undefined;
    if (original === undefined) Zotero.Prefs.clear(key, true);
    else Zotero.Prefs.set(key, original as string, true);
  });

  it("migrates existing preferences without changing the selected provider", function () {
    manager = new ProviderManager();
    assert.equal(manager.getActiveProviderId(), "deepseek");
    const local = manager.getProviderConfig(
      "codex-switch",
    ) as ApiKeyProviderConfig;
    assert.equal(local.apiProtocol, "codex-switch");
    assert.equal(local.baseUrl, "http://127.0.0.1:15722/v1");
    assert.instanceOf(
      manager.getProvider("deepseek"),
      OpenAICompatibleProvider,
    );
    assert.instanceOf(manager.getProvider("codex-switch"), CodexSwitchProvider);
    manager.refresh();
    assert.lengthOf(
      manager.getAllConfigs().filter((c) => c.id === "codex-switch"),
      1,
    );
  });

  it("persists keyless localhost models and gives translation an isolated local provider", function () {
    manager = new ProviderManager();
    manager.updateProviderConfig("codex-switch", {
      defaultModel: "gpt-6.1-sol",
      availableModels: ["gpt-6.1-sol"],
    });
    manager.setActiveProvider("codex-switch");
    manager.refresh();
    const provider = manager.getActiveProvider();
    assert.isTrue(provider?.isReady());
    assert.equal(provider?.config.defaultModel, "gpt-6.1-sol");
    const isolated = manager.createIsolatedActiveProvider();
    assert.instanceOf(isolated, CodexSwitchProvider);
    assert.notStrictEqual(isolated, provider);
  });

  it("supports explicitly selecting Codex protocol for existing custom entries", function () {
    manager = new ProviderManager();
    const id = manager.addCustomProvider("My local proxy");
    manager.updateProviderConfig(id, {
      apiProtocol: "codex-switch",
      baseUrl: "http://127.0.0.1:15722/v1",
      defaultModel: "gpt-6.1-sol",
    });
    assert.instanceOf(manager.getProvider(id), CodexSwitchProvider);
    assert.isTrue(manager.getProvider(id)?.isReady());
  });

  it("renders and saves Codex settings in the real Zotero preferences pane", async function () {
    const win = Zotero.Utilities.Internal.openPreferences(
      "paperchat-prefpane",
    ) as any;
    try {
      let item: HTMLElement | null = null;
      for (let i = 0; i < 100; i++) {
        item = win.document.querySelector('[data-provider-id="codex-switch"]');
        if (item) break;
        await Zotero.Promise.delay(100);
      }
      assert.exists(item, "Codex provider must appear in preferences");
      item!.click();
      const doc = win.document;
      assert.equal(
        doc.getElementById("pref-provider-baseurl").value,
        "http://127.0.0.1:15722/v1",
      );
      assert.equal(
        doc.getElementById("pref-provider-api-protocol").value,
        "codex-switch",
      );
      assert.isFalse(
        doc.getElementById("pref-provider-client-version-row").hidden,
      );
      assert.isTrue(doc.getElementById("pref-provider-temperature").disabled);
      const version = doc.getElementById("pref-provider-client-version");
      version.value = "0.160.0";
      version.dispatchEvent(new win.Event("blur"));
      const stored = JSON.parse(Zotero.Prefs.get(key, true) as string);
      assert.equal(
        stored.providers.find((p: any) => p.id === "codex-switch")
          .clientVersion,
        "0.160.0",
      );
    } finally {
      win.close();
    }
  });
});
