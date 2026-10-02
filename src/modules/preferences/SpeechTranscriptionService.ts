import { getPref } from "../../utils/prefs";
import { getProviderManager } from "../providers";
import type { ApiKeyProviderConfig } from "../../types/provider";
import { transcribeWithCodex } from "./CodexNativeSpeech";
import { getVoiceWindow } from "../../utils/voiceWindow";
import {
  createAbortController,
  isAbortRequested,
  throwIfAborted,
} from "../../utils/abort";

/** Speech input is separate from chat providers because text support does not
 * imply that a provider exposes an audio endpoint. */
export type SpeechTranscriptionMode =
  | "local"
  | "codex-native"
  | "codex-switch"
  | "custom-remote"
  | "system";

export interface SpeechRecognitionLike extends EventTarget {
  lang: string;
  continuous: boolean;
  interimResults: boolean;
  onresult: ((event: Event) => void) | null;
  onerror: ((event: Event) => void) | null;
  onend: (() => void) | null;
  start(): void;
  stop(): void;
  abort(): void;
}

export type SpeechRecognitionConstructor = new () => SpeechRecognitionLike;

export interface SpeechTranscriptionSettings {
  mode: SpeechTranscriptionMode;
  localBaseUrl: string;
  localModel: string;
  remoteBaseUrl: string;
  remoteApiKey: string;
  remoteModel: string;
  language: string;
}

const DEFAULT_LOCAL_BASE_URL = "http://127.0.0.1:9000/v1";
const DEFAULT_LOCAL_MODEL = "whisper-1";
const DEFAULT_REMOTE_BASE_URL = "https://api.openai.com/v1";

function normalizeMode(value: unknown): SpeechTranscriptionMode {
  switch (value) {
    case "local":
    case "codex-native":
    case "codex-switch":
    case "custom-remote":
    case "system":
      return value;
    default:
      return "codex-native";
  }
}

export function getSpeechTranscriptionSettings(): SpeechTranscriptionSettings {
  return {
    mode: normalizeMode(getPref("speechTranscriptionMode")),
    localBaseUrl: String(
      getPref("speechLocalBaseUrl") || DEFAULT_LOCAL_BASE_URL,
    ).trim(),
    localModel: String(
      getPref("speechLocalModel") || DEFAULT_LOCAL_MODEL,
    ).trim(),
    remoteBaseUrl: String(
      getPref("speechRemoteBaseUrl") || DEFAULT_REMOTE_BASE_URL,
    ).trim(),
    remoteApiKey: String(getPref("speechRemoteApiKey") || "").trim(),
    remoteModel: String(
      getPref("speechRemoteModel") || "gpt-4o-mini-transcribe",
    ).trim(),
    language: String(getPref("speechLanguage") || "").trim(),
  };
}

export function getSpeechMode(): SpeechTranscriptionMode {
  return getSpeechTranscriptionSettings().mode;
}

function transcriptionEndpoint(baseUrl: string): string {
  const normalized = baseUrl.trim().replace(/\/+$/, "");
  if (!normalized) throw new Error("Speech transcription URL is empty.");
  return /\/audio\/transcriptions$/i.test(normalized)
    ? normalized
    : `${normalized}/audio/transcriptions`;
}

function getCodexSwitchConfig(): ApiKeyProviderConfig {
  const config = getProviderManager().getProviderConfig("codex-switch");
  if (!config || config.type === "paperchat") {
    throw new Error("Codex Switch provider is not configured.");
  }
  return config;
}

function parseTranscriptionResponse(text: string): string {
  const trimmed = text.trim();
  if (!trimmed) return "";
  let parsed: unknown;
  try {
    parsed = JSON.parse(trimmed);
  } catch {
    // Some local Whisper servers return plain text instead of JSON.
    return trimmed;
  }
  const data = parsed as {
    text?: unknown;
    transcript?: unknown;
    result?: { text?: unknown };
    choices?: Array<{ text?: unknown; message?: { content?: unknown } }>;
  };
  const candidates: unknown[] = [
    data.text,
    data.transcript,
    data.result?.text,
    data.choices?.[0]?.text,
    data.choices?.[0]?.message?.content,
  ];
  const value = candidates.find(
    (candidate): candidate is string =>
      typeof candidate === "string" && candidate.trim().length > 0,
  );
  if (!value) throw new Error("Speech transcription returned no text.");
  return value.trim();
}

async function requestTranscription(
  blob: Blob,
  baseUrl: string,
  apiKey: string,
  model: string,
  language: string,
  signal: AbortSignal,
): Promise<string> {
  const body = new (getVoiceWindow().FormData)();
  const extension = blob.type.includes("ogg")
    ? "ogg"
    : blob.type.includes("wav")
      ? "wav"
      : "webm";
  body.append("file", blob, `paper-chat-voice.${extension}`);
  body.append("model", model || DEFAULT_LOCAL_MODEL);
  if (language) body.append("language", language);

  const headers: Record<string, string> = {};
  if (apiKey) headers.Authorization = `Bearer ${apiKey}`;
  const response = await fetch(transcriptionEndpoint(baseUrl), {
    method: "POST",
    headers,
    body,
    signal,
  });
  const responseText = await response.text();
  if (!response.ok) {
    const detail = responseText.trim().slice(0, 300);
    throw new Error(
      `Speech transcription request failed (${response.status})${
        detail ? `: ${detail}` : ""
      }`,
    );
  }

  const result = parseTranscriptionResponse(responseText);
  if (!result) throw new Error("Speech transcription returned no text.");
  return result;
}

/** Transcribe a recorded audio blob using the selected settings. */
async function transcribeSelectedAudio(
  blob: Blob,
  signal: AbortSignal,
): Promise<string> {
  const settings = getSpeechTranscriptionSettings();
  if (settings.mode === "codex-native")
    return transcribeWithCodex(blob, settings.language, signal);
  if (settings.mode === "system") {
    throw new Error("System speech recognition does not use recorded audio.");
  }

  if (settings.mode === "local") {
    return requestTranscription(
      blob,
      settings.localBaseUrl,
      "",
      settings.localModel,
      settings.language,
      signal,
    );
  }

  if (settings.mode === "custom-remote") {
    if (!settings.remoteApiKey) {
      throw new Error("A remote speech API key is required.");
    }
    return requestTranscription(
      blob,
      settings.remoteBaseUrl,
      settings.remoteApiKey,
      settings.remoteModel,
      settings.language,
      signal,
    );
  }

  const codex = getCodexSwitchConfig();
  try {
    return await requestTranscription(
      blob,
      codex.baseUrl,
      codex.apiKey.trim(),
      settings.localModel,
      settings.language,
      signal,
    );
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    if (/\(404\)/.test(message)) {
      throw new Error(
        "这个代理没有提供标准音频接口。请在语音设置中选择“Codex 原生听写（复用登录账号）”。",
      );
    }
    throw error;
  }
}

export async function transcribeAudio(
  blob: Blob,
  signal?: AbortSignal,
): Promise<string> {
  if (!blob.size || blob.size > 20 * 1024 * 1024)
    throw new Error("录音为空或超过 20 MB，请缩短录音后重试。");
  const controller = createAbortController();
  if (!controller.signal)
    throw new Error("Speech recording is unavailable in this runtime.");
  const requestSignal = controller.signal;
  const abort = (): void => controller.abort();
  signal?.addEventListener("abort", abort, { once: true });
  if (isAbortRequested(signal)) abort();
  const timer = setTimeout(() => controller.abort(), 90000);
  try {
    throwIfAborted(requestSignal);
    return await transcribeSelectedAudio(blob, requestSignal);
  } finally {
    clearTimeout(timer);
    signal?.removeEventListener("abort", abort);
  }
}

export function getSpeechRecognitionConstructor(
  win: Window | null | undefined,
): SpeechRecognitionConstructor | null {
  if (!win) return null;
  const candidate = win as Window & {
    SpeechRecognition?: SpeechRecognitionConstructor;
    webkitSpeechRecognition?: SpeechRecognitionConstructor;
  };
  return (
    candidate.SpeechRecognition || candidate.webkitSpeechRecognition || null
  );
}

export const speechTranscriptionDefaults = {
  localBaseUrl: DEFAULT_LOCAL_BASE_URL,
  localModel: DEFAULT_LOCAL_MODEL,
  remoteBaseUrl: DEFAULT_REMOTE_BASE_URL,
};
