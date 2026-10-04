import type { ApiKeyProviderConfig } from "../../types/provider";
import {
  OpenAIResponsesProvider,
  parseResponsesSSEStream,
} from "./OpenAIResponsesProvider";
import { createAbortController } from "../../utils/abort";
import {
  discoverCodexSwitchInstallation,
  getConfiguredSwitchRoot,
} from "./CodexSwitchDiscovery";

export const CODEX_SWITCH_BASE_URL = "http://127.0.0.1:15722/v1";
export const CODEX_CLIENT_VERSION = "0.159.1";

export function usesAutomaticCodexVersion(
  config: ApiKeyProviderConfig,
): boolean {
  if (config.clientVersionMode) return config.clientVersionMode === "auto";
  // Upgrade the old built-in default without replacing custom version overrides.
  return (
    !config.clientVersion?.trim() ||
    config.clientVersion === CODEX_CLIENT_VERSION
  );
}

export function isCodexSwitchConfig(config: ApiKeyProviderConfig): boolean {
  return config.apiProtocol === "codex-switch";
}

export function isLoopbackUrl(baseUrl: string): boolean {
  try {
    const url = new URL(baseUrl);
    return (
      ["http:", "https:"].includes(url.protocol) &&
      ["127.0.0.1", "localhost", "[::1]"].includes(url.hostname)
    );
  } catch {
    return false;
  }
}

/** Direct adapter for the user's Codex Switch gateway, with no second server. */
export class CodexSwitchProvider extends OpenAIResponsesProvider {
  protected async readCompletedResponse(response: Response) {
    // This gateway always streams, including versions that omit Content-Type.
    return parseResponsesSSEStream(this.getResponseReader(response), {});
  }

  isReady(): boolean {
    return (
      this._config.enabled &&
      !!this._config.defaultModel &&
      !!this._config.baseUrl &&
      (!!this._config.apiKey.trim() || isLoopbackUrl(this._config.baseUrl))
    );
  }

  protected requestUrl(): string {
    const url = new URL(this._config.baseUrl);
    url.pathname = `${url.pathname.replace(/\/+$/, "")}/responses`;
    return url.toString();
  }

  protected adaptRequestBody(
    body: Record<string, unknown>,
  ): Record<string, unknown> {
    const result = { ...body, stream: true, store: false };
    const request: Record<string, unknown> = result;
    // Codex's upstream rejects these ordinary Chat/Responses sampling limits.
    delete request.temperature;
    delete request.max_output_tokens;
    delete request.previous_response_id;
    request.instructions =
      "You are a research assistant. Follow the user's language and ground answers in the provided papers.";
    request.include = ["reasoning.encrypted_content"];
    if (
      !request.reasoning &&
      this._config.reasoningEffort &&
      this._config.reasoningEffort !== "default"
    ) {
      request.reasoning = { effort: this._config.reasoningEffort };
    }
    return request;
  }

  async getAvailableModels(): Promise<string[]> {
    const installation =
      usesAutomaticCodexVersion(this._config) &&
      isLoopbackUrl(this._config.baseUrl)
        ? await discoverCodexSwitchInstallation(getConfiguredSwitchRoot())
        : null;
    const url = new URL(this._config.baseUrl);
    url.pathname = `${url.pathname.replace(/\/+$/, "")}/models`;
    url.searchParams.set(
      "client_version",
      installation?.clientVersion ||
        this._config.clientVersion?.trim() ||
        CODEX_CLIENT_VERSION,
    );
    const response = await fetch(url.toString(), {
      headers: this.requestHeaders(),
    });
    await this.validateResponse(response);
    const data = (await response.json()) as {
      models?: Array<{ slug?: string; id?: string; visibility?: string }>;
      data?: Array<{ slug?: string; id?: string; visibility?: string }>;
    };
    const models = (data.models || data.data || [])
      .filter((m) => m.visibility !== "hide")
      .map((m) => m.slug || m.id || "")
      .filter(Boolean);
    if (!models.length)
      throw new Error("Codex Switch returned no available models.");
    return [...new Set(models)];
  }

  async testConnection(): Promise<boolean> {
    const models = await this.getAvailableModels();
    if (!models.includes(this._config.defaultModel)) {
      throw new Error(
        `Model '${this._config.defaultModel}' is unavailable. Refresh models and select an exact model ID.`,
      );
    }
    // Actually generate text, so a working /models endpoint alone cannot pass.
    const controller = createAbortController();
    // The local gateway may retry for 60 seconds before returning a useful error.
    const timeout = setTimeout(() => controller.abort(), 90000);
    try {
      const text = await this.chatCompletion(
        [
          {
            id: "connection-test",
            role: "user",
            content: "Reply only OK.",
            timestamp: 0,
          },
        ],
        controller.signal,
      );
      if (!text.trim())
        throw new Error("Codex Switch returned an empty response.");
      return true;
    } finally {
      clearTimeout(timeout);
    }
  }
}
