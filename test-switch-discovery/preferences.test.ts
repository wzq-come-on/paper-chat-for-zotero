import { assert } from "chai";
import { config } from "../package.json";
import { discoverCodexSwitchInstallation } from "../src/modules/providers/CodexSwitchDiscovery";
import { CodexSwitchProvider } from "../src/modules/providers/CodexSwitchProvider";
import type { ApiKeyProviderConfig } from "../src/types/provider";

async function waitFor<T>(get: () => T | null | undefined | false): Promise<T> {
  for (let index = 0; index < 150; index++) {
    const result = get();
    if (result) return result;
    await Zotero.Promise.delay(100);
  }
  throw new Error("Timed out waiting for production preferences");
}

function storedConfig(): ApiKeyProviderConfig {
  const storage = JSON.parse(
    String(Zotero.Prefs.get(`${config.prefsPrefix}.providersConfig`, true)),
  );
  return storage.providers.find(
    (provider: ApiKeyProviderConfig) => provider.id === "codex-switch",
  );
}

describe("Automatic Switch setup in production Zotero preferences", function () {
  let detected: NonNullable<
    Awaited<ReturnType<typeof discoverCodexSwitchInstallation>>
  >;
  let win: Window & typeof globalThis;
  let doc: Document;

  it("discovers the real local installation and an executable CLI", async function () {
    const result = await discoverCodexSwitchInstallation();
    assert.exists(result);
    detected = result!;
    assert.match(detected.clientVersion!, /^\d+\.\d+\.\d+$/);
    assert.isTrue(await IOUtils.exists(detected.executable!));
    assert.notInclude(detected.executable!, "ChatGPT.exe");
  });

  it("opens the plugin's actual settings and fills version and Switch directory", async function () {
    Zotero.Utilities.Internal.openPreferences("paperchat-prefpane");
    win = await waitFor(
      () => (Zotero as any)[config.addonInstance].data.prefs?.window,
    );
    doc = win.document;
    const row = await waitFor(
      () =>
        doc.querySelector('[data-provider-id="codex-switch"]') as HTMLElement,
    );
    row.click();
    const input = doc.getElementById(
      "pref-provider-client-version",
    ) as HTMLInputElement;
    const automatic = doc.getElementById("pref-provider-auto-version") as any;
    await waitFor(
      () => input.value === detected.clientVersion && automatic.checked,
    );
    assert.isTrue(input.disabled);
    await waitFor(
      () => storedConfig().clientVersion === detected.clientVersion,
    );
    assert.equal(storedConfig().clientVersionMode, "auto");
    const rootInput = doc.getElementById(
      "pref-speech-codex-root",
    ) as HTMLInputElement;
    await waitFor(() => rootInput.value === detected.root);
    rootInput.dispatchEvent(new win.Event("blur"));
    assert.equal(
      Zotero.Prefs.get(`${config.prefsPrefix}.speechCodexSwitchRoot`, true),
      "",
    );
    assert.include(
      doc.getElementById("pref-provider-version-status")?.textContent,
      detected.clientVersion!,
    );
  });

  it("lets manual input win and returns to automatic detection on request", async function () {
    const input = doc.getElementById(
      "pref-provider-client-version",
    ) as HTMLInputElement;
    const automatic = doc.getElementById("pref-provider-auto-version") as any;
    automatic.checked = false;
    automatic.dispatchEvent(new win.Event("command", { bubbles: true }));
    assert.isFalse(input.disabled);
    input.value = "0.158.0";
    input.dispatchEvent(new win.Event("blur"));
    await Zotero.Promise.delay(150);
    assert.equal(storedConfig().clientVersionMode, "manual");
    assert.equal(storedConfig().clientVersion, "0.158.0");
    assert.equal(input.value, "0.158.0");
    automatic.checked = true;
    automatic.dispatchEvent(new win.Event("command", { bubbles: true }));
    await waitFor(() => input.value === detected.clientVersion);
    const button = doc.getElementById("pref-provider-detect-version") as any;
    assert.isFalse(button.disabled);
    button.click();
    await waitFor(
      () => storedConfig().clientVersion === detected.clientVersion,
    );
  });

  it("keeps remote endpoint versions manual and restores local detection", async function () {
    const address = doc.getElementById(
      "pref-provider-baseurl",
    ) as HTMLInputElement;
    const input = doc.getElementById(
      "pref-provider-client-version",
    ) as HTMLInputElement;
    const automatic = doc.getElementById("pref-provider-auto-version") as any;
    const original = address.value;
    address.value = "http://research-server.example.test:15722/v1";
    address.dispatchEvent(new win.Event("blur"));
    assert.isTrue(automatic.disabled);
    assert.isFalse(automatic.checked);
    assert.isFalse(input.disabled);
    input.value = "0.158.0";
    input.dispatchEvent(new win.Event("blur"));
    await Zotero.Promise.delay(150);
    assert.equal(storedConfig().clientVersion, "0.158.0");
    assert.equal(input.value, "0.158.0");
    address.value = original;
    address.dispatchEvent(new win.Event("blur"));
    automatic.checked = true;
    automatic.dispatchEvent(new win.Event("command", { bubbles: true }));
    await waitFor(() => input.value === detected.clientVersion);
  });

  it("fills an empty address and enables automatic versions for a new custom Codex provider", async function () {
    const originalPrompt = win.prompt;
    try {
      win.prompt = () => "Automatic setup fixture";
      (doc.getElementById("pref-add-provider-btn") as any).click();
    } finally {
      win.prompt = originalPrompt;
    }
    const address = doc.getElementById(
      "pref-provider-baseurl",
    ) as HTMLInputElement;
    const protocol = doc.getElementById("pref-provider-api-protocol") as any;
    assert.equal(address.value, "");
    protocol.value = "codex-switch";
    protocol.dispatchEvent(new win.Event("command", { bubbles: true }));
    const input = doc.getElementById(
      "pref-provider-client-version",
    ) as HTMLInputElement;
    const automatic = doc.getElementById("pref-provider-auto-version") as any;
    await waitFor(
      () => input.value === detected.clientVersion && automatic.checked,
    );
    assert.equal(address.value, "http://127.0.0.1:15722/v1");
    (
      doc.querySelector('[data-provider-id="codex-switch"]') as HTMLElement
    ).click();
    await waitFor(() => input.value === detected.clientVersion);
  });

  it("uses the detected version in model discovery without an API key", async function () {
    const provider = new CodexSwitchProvider(storedConfig());
    const originalFetch = globalThis.fetch;
    let requestedVersion = "";
    try {
      globalThis.fetch = (async (input) => {
        requestedVersion =
          new URL(String(input)).searchParams.get("client_version") || "";
        return new Response(
          JSON.stringify({ models: [{ slug: "synthetic-test" }] }),
        );
      }) as typeof fetch;
      assert.deepEqual(await provider.getAvailableModels(), ["synthetic-test"]);
      assert.equal(requestedVersion, detected.clientVersion);
    } finally {
      globalThis.fetch = originalFetch;
    }
  });

  it("fetches the real proxy model list using the automatically detected version", async function () {
    try {
      const models = await new CodexSwitchProvider(
        storedConfig(),
      ).getAvailableModels();
      assert.isAbove(models.length, 0);
    } finally {
      win.close();
    }
  });
});
