import { getString } from "../../../utils/locale";
import { dispatchInputEvent } from "./InputEvents";
import {
  createAbortController,
  type ManagedAbortController,
} from "../../../utils/abort";
import {
  startWindowsAudioCapture,
  type WindowsAudioRecording,
} from "./WindowsAudioCapture";
import {
  getSpeechMode,
  getSpeechTranscriptionSettings,
  getSpeechRecognitionConstructor,
  transcribeAudio,
  type SpeechRecognitionLike,
} from "../../preferences/SpeechTranscriptionService";

interface VoiceInputControllerOptions {
  button: HTMLButtonElement;
  input: HTMLTextAreaElement;
  onTranscript: (text: string) => void;
  onError: (error: unknown) => void;
  /** Isolated-test seam; production always uses the real system microphone. */
  startWindowsCapture?: typeof startWindowsAudioCapture;
}

interface MediaRecorderWindow {
  MediaRecorder?: typeof MediaRecorder;
  navigator: Navigator;
}

function setButtonState(
  button: HTMLButtonElement,
  recording: boolean,
  busy = false,
): void {
  button.disabled = busy;
  button.setAttribute("aria-busy", String(busy));
  button.setAttribute("aria-pressed", recording ? "true" : "false");
  button.setAttribute(
    "aria-label",
    getString(
      busy
        ? "chat-voice-busy"
        : recording
          ? "chat-voice-stop"
          : "chat-voice-start",
    ),
  );
  button.title = getString(
    busy
      ? "chat-voice-busy"
      : recording
        ? "chat-voice-stop"
        : "chat-voice-start",
  );
  button.textContent = busy ? "⌛" : recording ? "■" : "🎙";
  button.style.background = recording ? "#fee2e2" : "transparent";
}

function getPreferredMimeType(ctor: typeof MediaRecorder): string | undefined {
  for (const mimeType of [
    "audio/webm;codecs=opus",
    "audio/ogg;codecs=opus",
    "audio/webm",
    "audio/ogg",
  ]) {
    if (
      typeof ctor.isTypeSupported !== "function" ||
      ctor.isTypeSupported(mimeType)
    ) {
      return mimeType;
    }
  }
  return undefined;
}

/** Attach a record/transcribe button to the Paper Chat composer. */
export function attachVoiceInput(
  options: VoiceInputControllerOptions,
): () => void {
  const { button, input, onTranscript, onError } = options;
  const ownerWindow = button.ownerDocument?.defaultView || null;
  const mediaWindow = ownerWindow as MediaRecorderWindow | null;
  let recorder: MediaRecorder | null = null;
  let stream: MediaStream | null = null;
  let windowsRecording: WindowsAudioRecording | null = null;
  let captureRequest: ManagedAbortController | null = null;
  let recognition: SpeechRecognitionLike | null = null;
  let chunks: BlobPart[] = [];
  let disposed = false;
  let busy = false;
  let request: ManagedAbortController | null = null;
  let recordingTimer: ReturnType<typeof setTimeout> | undefined;

  button.setAttribute("aria-controls", input.id);
  setButtonState(button, false);

  const stopTracks = (): void => {
    clearTimeout(recordingTimer);
    stream?.getTracks().forEach((track) => track.stop());
    stream = null;
  };

  const finish = (text: string): void => {
    if (disposed) return;
    busy = false;
    if (text.trim()) onTranscript(text.trim());
    setButtonState(button, false);
  };

  const fail = (error: unknown): void => {
    if (disposed) return;
    busy = false;
    setButtonState(button, false);
    onError(error);
  };

  const transcribeRecording = (recorded: Blob): void => {
    if (disposed) return;
    if (recorded.size === 0) {
      fail(new Error(getString("chat-voice-no-text")));
      return;
    }
    busy = true;
    setButtonState(button, false, true);
    request = createAbortController();
    void transcribeAudio(recorded, request.signal)
      .then(finish)
      .catch(fail)
      .finally(() => {
        request = null;
      });
  };

  const stopWindowsRecording = (): void => {
    if (!windowsRecording) return;
    busy = true;
    setButtonState(button, false, true);
    void windowsRecording.stop().catch(fail);
  };

  const startWindowsRecorder = async (): Promise<void> => {
    const capture = options.startWindowsCapture || startWindowsAudioCapture;
    captureRequest = createAbortController();
    if (!captureRequest.signal)
      throw new Error(getString("chat-voice-recorder-unavailable"));
    const session = await capture(captureRequest.signal);
    if (disposed) {
      await session.cancel();
      return;
    }
    windowsRecording = session;
    busy = false;
    setButtonState(button, true);
    recordingTimer = setTimeout(stopWindowsRecording, 120000);
    void session.audio
      .then((recorded) => {
        clearTimeout(recordingTimer);
        windowsRecording = null;
        transcribeRecording(recorded);
      })
      .catch((error) => {
        clearTimeout(recordingTimer);
        windowsRecording = null;
        fail(error);
      });
  };

  const startSystemRecognition = (): void => {
    const Recognition = getSpeechRecognitionConstructor(ownerWindow);
    if (!Recognition) {
      onError(new Error(getString("chat-voice-system-unavailable")));
      return;
    }
    recognition = new Recognition();
    recognition.lang =
      getSpeechTranscriptionSettings().language ||
      ownerWindow?.navigator.language?.trim() ||
      "zh-CN";
    recognition.continuous = false;
    recognition.interimResults = false;
    recognition.onresult = (event: Event) => {
      const resultEvent = event as Event & {
        results?: ArrayLike<ArrayLike<{ transcript?: string }>>;
      };
      const text = Array.from(resultEvent.results || [])
        .map((result) => result[0]?.transcript || "")
        .join(" ");
      finish(text);
    };
    recognition.onerror = (event: Event) => {
      const error = event as Event & { error?: string };
      onError(new Error(error.error || getString("chat-voice-failed")));
      setButtonState(button, false);
    };
    recognition.onend = () => {
      clearTimeout(recordingTimer);
      recognition = null;
      setButtonState(button, false);
    };
    recognition.start();
    setButtonState(button, true);
    recordingTimer = setTimeout(() => recognition?.stop(), 120000);
  };

  const startRecorder = async (): Promise<void> => {
    const MediaRecorderCtor = mediaWindow?.MediaRecorder;
    const mediaDevices = mediaWindow?.navigator?.mediaDevices;
    if (!MediaRecorderCtor || !mediaDevices?.getUserMedia) {
      throw new Error(getString("chat-voice-recorder-unavailable"));
    }
    stream = await mediaDevices.getUserMedia({ audio: true });
    if (disposed) {
      stopTracks();
      return;
    }
    chunks = [];
    const mimeType = getPreferredMimeType(MediaRecorderCtor);
    recorder = mimeType
      ? new MediaRecorderCtor(stream, { mimeType })
      : new MediaRecorderCtor(stream);
    recorder.ondataavailable = (event: BlobEvent) => {
      if (event.data.size > 0) chunks.push(event.data);
    };
    recorder.onerror = () => {
      if (recorder) recorder.onstop = null;
      stopTracks();
      recorder = null;
      setButtonState(button, false);
      fail(new Error(getString("chat-voice-failed")));
    };
    recorder.onstop = () => {
      const BlobCtor = (ownerWindow as Window & typeof globalThis).Blob;
      const recorded = new BlobCtor(chunks, {
        type: recorder?.mimeType || "audio/webm",
      });
      stopTracks();
      recorder = null;
      chunks = [];
      transcribeRecording(recorded);
    };
    recorder.start();
    busy = false;
    setButtonState(button, true);
    recordingTimer = setTimeout(() => {
      if (recorder?.state === "recording") recorder.stop();
    }, 120000);
  };

  const toggle = (): void => {
    if (disposed || busy) return;
    if (getSpeechMode() === "system") {
      if (recognition) {
        recognition.stop();
        return;
      }
      try {
        startSystemRecognition();
      } catch (error) {
        onError(error);
        setButtonState(button, false);
      }
      return;
    }
    if (windowsRecording) {
      stopWindowsRecording();
      return;
    }
    if (recorder) {
      busy = true;
      setButtonState(button, false, true);
      recorder.stop();
      return;
    }
    busy = true;
    setButtonState(button, false, true);
    void (Zotero.isWin ? startWindowsRecorder() : startRecorder()).catch(
      (error) => {
        stopTracks();
        recorder = null;
        setButtonState(button, false);
        fail(error);
      },
    );
  };

  button.addEventListener("click", toggle);

  return () => {
    disposed = true;
    captureRequest?.abort();
    void windowsRecording?.cancel();
    windowsRecording = null;
    request?.abort();
    button.removeEventListener("click", toggle);
    if (recognition) {
      recognition.onresult = null;
      recognition.onerror = null;
      recognition.onend = null;
      recognition.abort();
      recognition = null;
    }
    if (recorder) {
      recorder.ondataavailable = null;
      recorder.onstop = null;
      recorder.onerror = null;
      if (recorder.state !== "inactive") recorder.stop();
      recorder = null;
    }
    stopTracks();
  };
}

export function appendVoiceTranscript(
  input: HTMLTextAreaElement,
  transcript: string,
): void {
  input.value +=
    (input.value && !/\s$/.test(input.value) ? " " : "") + transcript;
  dispatchInputEvent(input);
  input.focus();
  input.setSelectionRange(input.value.length, input.value.length);
}
