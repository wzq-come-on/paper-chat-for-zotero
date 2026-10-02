import { assert } from "chai";
import { config } from "../package.json";
import {
  startWindowsAudioCapture,
  probeWindowsAudioCapture,
} from "../src/modules/ui/chat-panel/WindowsAudioCapture";
import { attachVoiceInput } from "../src/modules/ui/chat-panel/VoiceInputController";

describe("Windows microphone capture lifecycle", function () {
  before(function () {
    (globalThis as any).addon = (Zotero as any)[config.addonInstance];
  });

  it("initializes the real Windows Runtime microphone helper without recording", async function () {
    const result = await probeWindowsAudioCapture(new AbortController().signal);
    assert.equal(result.access, "Allowed");
    assert.isAtLeast(result.devices, 1);
    assert.isTrue(result.initialized);
  });

  it("uses the real helper protocol for synthetic audio and removes temporary files", async function () {
    const before = (await IOUtils.getChildren(PathUtils.tempDir)).filter((p) =>
      PathUtils.filename(p).startsWith("paperchat-voice-"),
    );
    const abort = new AbortController();
    const session = await startWindowsAudioCapture(abort.signal, {
      synthetic: true,
    });
    await session.stop();
    const blob = await session.audio;
    assert.equal(blob.type, "audio/wav");
    const bytes = new Uint8Array(await blob.arrayBuffer());
    assert.equal(new TextDecoder().decode(bytes.slice(0, 4)), "RIFF");
    assert.equal(new DataView(bytes.buffer).getUint32(24, true), 16000);
    assert.isAbove(bytes.length, 44);
    const after = (await IOUtils.getChildren(PathUtils.tempDir)).filter((p) =>
      PathUtils.filename(p).startsWith("paperchat-voice-"),
    );
    assert.sameMembers(after, before);
  });

  it("cancels an active helper and cleans its temporary recording", async function () {
    const before = (await IOUtils.getChildren(PathUtils.tempDir)).filter((p) =>
      PathUtils.filename(p).startsWith("paperchat-voice-"),
    );
    const abort = new AbortController();
    const session = await startWindowsAudioCapture(abort.signal, {
      synthetic: true,
    });
    const result = session.audio.then(
      () => false,
      () => true,
    );
    abort.abort();
    await session.cancel();
    assert.isTrue(await result);
    const after = (await IOUtils.getChildren(PathUtils.tempDir)).filter((p) =>
      PathUtils.filename(p).startsWith("paperchat-voice-"),
    );
    assert.sameMembers(after, before);
  });

  it("disposes while acquiring audio without transcribing or reopening a recorder", async function () {
    const doc = Zotero.getMainWindow().document;
    const button = doc.createElementNS(
      "http://www.w3.org/1999/xhtml",
      "button",
    ) as HTMLButtonElement;
    const input = doc.createElementNS(
      "http://www.w3.org/1999/xhtml",
      "textarea",
    ) as HTMLTextAreaElement;
    doc.documentElement.append(button, input);
    let acquisitions = 0;
    let cancelled = false;
    let transcriptCalls = 0;
    let errors = 0;
    let signal!: AbortSignal;
    let resolve!: (value: any) => void;
    const pending = new Promise<any>((r) => {
      resolve = r;
    });
    const dispose = attachVoiceInput({
      button,
      input,
      startWindowsCapture: (value) => {
        signal = value;
        acquisitions++;
        return pending;
      },
      onTranscript: () => {
        transcriptCalls++;
      },
      onError: () => {
        errors++;
      },
    });
    try {
      button.click();
      button.click();
      assert.equal(acquisitions, 1);
      dispose();
      assert.isTrue(signal.aborted);
      resolve({
        audio: new Promise(() => {}),
        cancel: async () => {
          cancelled = true;
        },
        stop: async () => {},
      });
      await Zotero.Promise.delay(100);
      assert.isTrue(cancelled);
      assert.equal(transcriptCalls, 0);
      assert.equal(errors, 0);
    } finally {
      dispose();
      button.remove();
      input.remove();
    }
  });
});
