import { getString } from "../../../utils/locale";
import { getVoiceWindow } from "../../../utils/voiceWindow";
import { throwIfAborted } from "../../../utils/abort";

interface CaptureProcess {
  stdin: { write(text: string): Promise<void> };
  stdout: { readString(): Promise<string> };
  stderr: { readString(): Promise<string> };
  kill(timeout?: number): Promise<unknown>;
  wait(): Promise<{ exitCode: number }>;
}

interface CaptureSubprocess {
  getEnvironment(): Record<string, string>;
  call(options: {
    command: string;
    arguments: string[];
    environment: Record<string, string>;
    environmentAppend: boolean;
    stderr: string;
  }): Promise<CaptureProcess>;
}

interface CaptureStatus {
  event: string;
  code?: string;
  detail?: string;
  access?: string;
  devices?: number;
  initialized?: boolean;
}

export interface WindowsAudioRecording {
  audio: Promise<Blob>;
  stop(): Promise<void>;
  cancel(): Promise<void>;
}

function captureError(status?: CaptureStatus): Error {
  const key =
    status?.code === "permission"
      ? "chat-voice-permission-denied"
      : status?.code === "device"
        ? "chat-voice-no-device"
        : "chat-voice-windows-capture-failed";
  return new Error(
    getString(key) + (status?.detail ? ` (${status.detail})` : ""),
  );
}

function encodePowerShell(script: string): string {
  let bytes = "";
  for (let i = 0; i < script.length; i++) {
    const code = script.charCodeAt(i);
    bytes += String.fromCharCode(code & 255, code >> 8);
  }
  return getVoiceWindow().btoa(bytes);
}

async function launchWindowsAudioHelper(
  mode: "record" | "synthetic" | "probe",
  output = "",
  audioPath = "",
): Promise<CaptureProcess> {
  const { Subprocess } = ChromeUtils.importESModule(
    "resource://gre/modules/Subprocess.sys.mjs",
  ) as { Subprocess: CaptureSubprocess };
  const env = Subprocess.getEnvironment();
  const systemRoot = Object.entries(env).find(
    ([key]) => key.toLowerCase() === "systemroot",
  )?.[1];
  if (!systemRoot)
    throw captureError({ event: "error", detail: "SystemRoot is missing" });
  const script = await Zotero.File.getContentsFromURLAsync(
    "chrome://paperchat/content/windows-voice-recorder.ps1",
  );
  const process = await Subprocess.call({
    command: PathUtils.join(
      systemRoot,
      "System32",
      "WindowsPowerShell",
      "v1.0",
      "powershell.exe",
    ),
    arguments: [
      "-NoLogo",
      "-NoProfile",
      "-NonInteractive",
      "-WindowStyle",
      "Hidden",
      "-EncodedCommand",
      encodePowerShell(script),
    ],
    environment: {
      PAPERCHAT_VOICE_OUTPUT: output,
      PAPERCHAT_VOICE_PARENT: String(Services.appinfo.processID),
      PAPERCHAT_VOICE_MODE: mode,
      PAPERCHAT_VOICE_FIXTURE: audioPath,
    },
    environmentAppend: true,
    // A GUI-launched Zotero has no console stderr handle. PowerShell can exit
    // without a status when Windows Runtime initialization writes progress to
    // that invalid handle. Always supply and drain a real pipe.
    stderr: "pipe",
  });
  void (async () => {
    while (await process.stderr.readString()) {
      // The helper reports errors as structured statuses on stdout.
    }
  })().catch(() => undefined);
  return process;
}

function statusReader(
  process: CaptureProcess,
  signal: AbortSignal,
): () => Promise<CaptureStatus> {
  let buffer = "";
  return async () => {
    while (true) {
      throwIfAborted(signal);
      const newline = buffer.indexOf("\n");
      if (newline >= 0) {
        const line = buffer.slice(0, newline).trim();
        buffer = buffer.slice(newline + 1);
        if (!line) continue;
        const status = JSON.parse(line) as CaptureStatus;
        if (status.event === "error") throw captureError(status);
        return status;
      }
      const chunk = await process.stdout.readString();
      throwIfAborted(signal);
      if (!chunk) {
        const { exitCode } = await process.wait();
        throw captureError({
          event: "error",
          detail: `Recording helper exited before returning a status (exit ${exitCode})`,
        });
      }
      buffer += chunk;
      if (buffer.length > 65536)
        throw captureError({
          event: "error",
          detail: "Invalid helper response",
        });
    }
  };
}

/** Initialize native permissions and audio format without recording any sound. */
export async function probeWindowsAudioCapture(
  signal: AbortSignal,
): Promise<{ access: string; devices: number; initialized: boolean }> {
  throwIfAborted(signal);
  const process = await launchWindowsAudioHelper("probe");
  const cancel = () => void process.kill();
  signal.addEventListener("abort", cancel, { once: true });
  const timer = setTimeout(cancel, 20000);
  try {
    const status = await statusReader(process, signal)();
    if (status.event !== "probe" || !status.initialized)
      throw captureError({
        event: "error",
        detail: `Unexpected ${status.event} status`,
      });
    await process.wait();
    return {
      access: status.access || "",
      devices: status.devices || 0,
      initialized: status.initialized,
    };
  } finally {
    clearTimeout(timer);
    signal.removeEventListener("abort", cancel);
    await process.kill().catch(() => undefined);
  }
}

/** Use Windows recording independently of Zotero's WebRTC backend. The helper
 * checks native microphone permission, has no network or credentials, and exits
 * on cancel, parent exit, or the two-minute limit. No settings are changed. */
export async function startWindowsAudioCapture(
  signal: AbortSignal,
  testOptions?: { synthetic: true; audioPath?: string },
): Promise<WindowsAudioRecording> {
  throwIfAborted(signal);
  const dir = PathUtils.join(
    PathUtils.tempDir,
    "paperchat-voice-" + Services.uuid.generateUUID().toString(),
  );
  const output = PathUtils.join(dir, "recording.wav");
  throwIfAborted(signal);
  await IOUtils.makeDirectory(dir);
  let process: CaptureProcess | undefined;
  const cancel = (): void => {
    void process?.kill();
  };
  const cleanup = async (): Promise<void> => {
    signal.removeEventListener("abort", cancel);
    if (process) await process.kill().catch(() => undefined);
    await IOUtils.remove(output, { ignoreAbsent: true });
    await IOUtils.remove(dir, { ignoreAbsent: true });
  };
  try {
    throwIfAborted(signal);
    process = await launchWindowsAudioHelper(
      testOptions ? "synthetic" : "record",
      output,
      testOptions?.audioPath,
    );
    signal.addEventListener("abort", cancel, { once: true });
    throwIfAborted(signal);
    const activeProcess = process;
    const readStatus = statusReader(activeProcess, signal);
    const startupTimer = setTimeout(cancel, 20000);
    try {
      const status = await readStatus();
      if (status.event !== "ready")
        throw captureError({
          event: "error",
          detail: `Expected ready, received ${status.event}`,
        });
    } finally {
      clearTimeout(startupTimer);
    }
    const audio = (async (): Promise<Blob> => {
      try {
        const status = await readStatus();
        if (status.event !== "complete")
          throw captureError({
            event: "error",
            detail: `Expected complete, received ${status.event}`,
          });
        await activeProcess.wait();
        throwIfAborted(signal);
        const bytes = await IOUtils.read(output);
        if (bytes.length <= 44 || bytes.length > 8 * 1024 * 1024)
          throw captureError();
        return new (getVoiceWindow().Blob)([bytes as Uint8Array<ArrayBuffer>], {
          type: "audio/wav",
        });
      } finally {
        await cleanup();
      }
    })();
    // Cancellation can occur before the composer subscribes.
    void audio.catch(() => undefined);
    let stopped = false;
    return {
      audio,
      async stop() {
        if (stopped) return;
        stopped = true;
        await activeProcess.stdin.write("stop\n");
      },
      async cancel() {
        if (!stopped) {
          stopped = true;
          await activeProcess.stdin.write("cancel\n").catch(() => undefined);
        }
        await activeProcess.kill().catch(() => undefined);
        await audio.catch(() => undefined);
      },
    };
  } catch (error) {
    await cleanup();
    throw error;
  }
}
