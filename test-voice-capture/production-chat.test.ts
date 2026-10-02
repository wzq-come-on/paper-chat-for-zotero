import { assert } from "chai";

async function waitFor(check: () => boolean, message: string) {
  for (let i = 0; i < 160; i++) {
    if (check()) return;
    await Zotero.Promise.delay(100);
  }
  const errors = Services.console
    .getMessageArray()
    .map((item: any) => String(item.message || item))
    .filter((item: string) =>
      /paperchat|AbortController|ReferenceError|TypeError/.test(item),
    )
    .slice(-20);
  const history =
    Zotero.getMainWindow().document.querySelector("#chat-history")?.textContent;
  Zotero.debug(
    "Production chat diagnostics: " +
      JSON.stringify({
        message,
        model: Zotero.getMainWindow().document.querySelector(
          "#chat-model-selector-text",
        )?.textContent,
        errors,
      }),
  );
  await IOUtils.writeUTF8(
    PathUtils.join(PathUtils.tempDir, "paperchat-ui-regression.json"),
    JSON.stringify(
      {
        message,
        model: Zotero.getMainWindow().document.querySelector(
          "#chat-model-selector-text",
        )?.textContent,
        history,
        errors,
      },
      null,
      2,
    ),
  );
  assert.fail(message);
}

describe("Production plugin chat with voice installed", function () {
  it("opens the actual plugin panel, selects a model and sends by button and Enter", async function () {
    // Drive the plugin's own menu listener, not a duplicate module imported
    // into Mocha's DOM-rich sandbox. Production has no AbortController global.
    const win = Zotero.getMainWindow() as Window & typeof globalThis;
    const doc = win.document;
    const menu = doc.getElementById("paperchat-chat-menuitem") as any;
    assert.exists(menu);
    menu.doCommand();
    await waitFor(
      () => !!doc.querySelector("#chat-message-input"),
      "Plugin panel did not open",
    );
    const input = doc.querySelector(
      "#chat-message-input",
    ) as HTMLTextAreaElement;
    const container = input.closest("[data-chat-ready]") as HTMLElement;
    assert.exists(container);
    await waitFor(
      () => container.dataset.chatReady === "true",
      "Chat session initialization must finish",
    );
    const model = container.querySelector(
      "#chat-model-selector-btn",
    ) as HTMLButtonElement;
    const modelText = container.querySelector(
      "#chat-model-selector-text",
    ) as HTMLElement;
    await waitFor(
      () => modelText.textContent?.includes("Synthetic Codex") === true,
      "Production panel initialization did not finish",
    );
    model.click();
    const dropdown = container.querySelector(
      "#chat-model-dropdown",
    ) as HTMLElement;
    await waitFor(
      () =>
        !!dropdown &&
        dropdown.style.display !== "none" &&
        dropdown.textContent?.includes("synthetic-codex") === true,
      "Model dropdown must open",
    );
    const entry = Array.from(dropdown.querySelectorAll("span")).find(
      (el) => el.textContent === "synthetic-codex",
    )?.parentElement as HTMLElement;
    assert.exists(entry, "Model must be selectable");
    entry.click();
    await waitFor(
      () => dropdown.style.display === "none",
      "Model selection must finish",
    );
    const send = container.querySelector(
      "#chat-send-button",
    ) as HTMLButtonElement;
    assert.exists(send);
    const history = container.querySelector("#chat-history") as HTMLElement;
    input.value = "UI chat regression: reply briefly, do not call tools.";
    input.dispatchEvent(new win.Event("input", { bubbles: true }));
    await waitFor(() => !send.disabled, "Send button must enable for a draft");
    send.click();
    await waitFor(
      () => history.textContent?.includes("降雨预报：两小时。") === true,
      "Send button must produce an assistant reply",
    );
    await waitFor(
      () => !send.disabled,
      "Composer must become ready after a reply",
    );
    input.value =
      "UI chat regression follow-up: reply briefly, do not call tools.";
    input.dispatchEvent(new win.Event("input", { bubbles: true }));
    input.dispatchEvent(
      new win.KeyboardEvent("keydown", {
        key: "Enter",
        bubbles: true,
        cancelable: true,
      }),
    );
    await waitFor(
      () =>
        (history.textContent?.match(/降雨预报：两小时。/g)?.length || 0) >= 2,
      "Enter must produce the follow-up assistant reply",
    );
    assert.exists(
      container.querySelector("#chat-voice-button"),
      "Voice stays installed beside working text chat",
    );
  });
});
