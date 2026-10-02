import { assert } from "chai";
import { config } from "../package.json";
import { getString } from "../src/utils/locale";
import type * as VoiceRuntime from "./sandbox-entry";
let transcribeAudio: typeof VoiceRuntime.transcribeAudio;
let attachVoiceInput: typeof VoiceRuntime.attachVoiceInput;
let appendVoiceTranscript: typeof VoiceRuntime.appendVoiceTranscript;
let startWindowsAudioCapture: typeof VoiceRuntime.startWindowsAudioCapture;

describe("Native Codex dictation inside Zotero", function () {
  before(function () {
    (globalThis as any).addon = (Zotero as any)[config.addonInstance];
    const ctx: any = {
      Zotero,
      Services,
      ChromeUtils,
      Components,
      IOUtils,
      PathUtils,
      setTimeout: setTimeout.bind(globalThis),
      clearTimeout: clearTimeout.bind(globalThis),
      fetch: fetch.bind(globalThis),
      URL,
      TextDecoder,
      addon: (Zotero as any)[config.addonInstance],
      ztoolkit: (Zotero as any)[config.addonInstance].data.ztoolkit,
    };
    // Match the missing Web API constructors in Zotero's bootstrap context.
    assert.notProperty(ctx, "AbortController");
    assert.notProperty(ctx, "Blob");
    assert.notProperty(ctx, "FormData");
    Services.scriptloader.loadSubScript(
      "chrome://paperchat/content/scripts/voice-sandbox-probe.js",
      ctx,
    );
    ({
      transcribeAudio,
      attachVoiceInput,
      appendVoiceTranscript,
      startWindowsAudioCapture,
    } = ctx.PaperChatVoiceProbe);
  });

  it("has readable voice labels and saves a transcript as a draft", function () {
    assert.notInclude(getString("chat-voice-start"), "paperchat-");
    const doc = Zotero.getMainWindow().document;
    const input = doc.createElementNS(
      "http://www.w3.org/1999/xhtml",
      "textarea",
    ) as HTMLTextAreaElement;
    input.value = "Existing draft\n";
    let events = 0;
    input.addEventListener("input", () => {
      events++;
    });
    appendVoiceTranscript(input, "Recognized speech");
    assert.equal(input.value, "Existing draft\nRecognized speech");
    assert.equal(events, 1);
  });

  it("cancels before starting authentication", async function () {
    const abort = new AbortController();
    abort.abort();
    let failed = false;
    try {
      await transcribeAudio(
        new Blob(["synthetic"], { type: "audio/wav" }),
        abort.signal,
      );
    } catch {
      failed = true;
    }
    assert.isTrue(failed);
  });

  it("captures a synthetic WAV through the Windows helper and fills the composer via the real native account", async function () {
    let phase = "read fixture preference";
    try {
      const win = Zotero.getMainWindow() as Window;
      const doc = win.document;
      const audioPath = Zotero.Prefs.get(
        `${config.prefsPrefix}.voiceProbeAudio`,
        true,
      ) as string;
      assert.isNotEmpty(audioPath);
      let acquisitions = 0;
      const button = doc.createElementNS(
        "http://www.w3.org/1999/xhtml",
        "button",
      ) as HTMLButtonElement;
      const input = doc.createElementNS(
        "http://www.w3.org/1999/xhtml",
        "textarea",
      ) as HTMLTextAreaElement;
      input.id = "voice-probe-input";
      doc.documentElement.append(button, input);
      let resolve!: (text: string) => void;
      let reject!: (error: unknown) => void;
      const transcript = new Promise<string>((r, j) => {
        resolve = r;
        reject = j;
      });
      phase = "attach voice input in sandbox";
      const dispose = attachVoiceInput({
        button,
        input,
        startWindowsCapture: (signal) => {
          acquisitions++;
          return startWindowsAudioCapture(signal, {
            synthetic: true,
            audioPath,
          });
        },
        onTranscript: (text) => {
          appendVoiceTranscript(input, text);
          resolve(text);
        },
        onError: (error) => {
          void IOUtils.writeUTF8(
            PathUtils.join(
              PathUtils.tempDir,
              "paperchat-voice-regression-error.txt",
            ),
            String(error),
          );
          reject(new Error(String(error)));
        },
      });
      try {
        phase = "start synthetic capture";
        button.click();
        phase = "await transcript";
        button.click();
        for (
          let i = 0;
          i < 200 && button.getAttribute("aria-pressed") !== "true";
          i++
        )
          await Zotero.Promise.delay(100);
        assert.equal(
          button.getAttribute("aria-pressed"),
          "true",
          "Capture must start",
        );
        assert.equal(
          acquisitions,
          1,
          "A second click while acquiring media must not open another recorder",
        );
        button.click();
        assert.isTrue(
          button.disabled,
          "The button must stay busy while transcribing",
        );
        const text = await transcript;
        assert.match(text.toLowerCase(), /speech transcription test/);
        assert.equal(input.value, text);
        Zotero.debug("Native voice smoke test passed: " + text);
      } finally {
        dispose();
        button.remove();
        input.remove();
      }
    } catch (error) {
      await IOUtils.writeUTF8(
        PathUtils.join(
          PathUtils.tempDir,
          "paperchat-voice-regression-error.txt",
        ),
        phase + "\n" + String(error) + "\n" + String((error as any)?.stack),
      );
      throw new Error(phase + ": " + String(error));
    }
  });

  it("renders native and remote model settings in the real preferences pane", async function () {
    const win = Zotero.Utilities.Internal.openPreferences(
      "paperchat-prefpane",
    ) as any;
    try {
      for (
        let i = 0;
        i < 100 && !win.document.getElementById("pref-speech-mode");
        i++
      )
        await Zotero.Promise.delay(100);
      const doc = win.document;
      const mode = doc.getElementById("pref-speech-mode");
      assert.equal(mode.value, "codex-native");
      const options = Array.from(
        doc.querySelectorAll("#pref-speech-mode-popup > menuitem"),
      ) as Element[];
      for (
        let i = 0;
        i < 50 && options.some((item) => !item.getAttribute("label"));
        i++
      )
        await Zotero.Promise.delay(100);
      assert.lengthOf(options, 5);
      for (const option of options)
        assert.isNotEmpty(
          option.getAttribute("label"),
          `Voice option ${option.getAttribute("value")} must have a visible label`,
        );
      assert.equal(mode.label, options[0].getAttribute("label"));
      assert.isFalse(doc.getElementById("pref-voice-native-fields").hidden);
      mode.value = "custom-remote";
      mode.dispatchEvent(new win.Event("command"));
      assert.isFalse(doc.getElementById("pref-voice-remote-fields").hidden);
      assert.equal(
        doc.getElementById("pref-speech-remote-model").value,
        "gpt-4o-mini-transcribe",
      );
      mode.value = "codex-native";
      mode.dispatchEvent(new win.Event("command"));
    } finally {
      win.close();
    }
  });
});
