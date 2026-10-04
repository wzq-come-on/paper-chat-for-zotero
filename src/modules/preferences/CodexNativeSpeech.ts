import { getString } from "../../utils/locale";
import { getVoiceWindow } from "../../utils/voiceWindow";
import { throwIfAborted } from "../../utils/abort";
import {
  discoverCodexSwitchInstallation,
  getConfiguredSwitchRoot,
} from "../providers/CodexSwitchDiscovery";

interface NativeProcess {
  stdin: { write(text: string): Promise<void> };
  stdout: { readString(): Promise<string> };
  stderr: { readString(): Promise<string> };
  kill(timeout?: number): Promise<unknown>;
}

interface NativeSubprocess {
  call(options: {
    command: string;
    arguments: string[];
    environment: Record<string, string>;
    environmentAppend: boolean;
    stderr: string;
  }): Promise<NativeProcess>;
  getEnvironment(): Record<string, string>;
}

interface WorkspaceRouting {
  backendOrigin: string;
  chatgptAccountId: string;
  accountRoutingOverride?: string;
}

interface AccountResponse {
  account: { type: string } | null;
  workspaceRouting?: WorkspaceRouting | null;
}

interface AuthResponse {
  authMethod: string | null;
  authToken: string | null;
}

interface SwitchNetworkProxy {
  enabled?: boolean;
  proxyUrl?: string;
  proxyPort?: number;
}

/** Scope Switch's network proxy to this one dictation request. */
async function fetchNativeAudio(
  url: string,
  init: RequestInit,
  settings?: SwitchNetworkProxy,
): Promise<Response> {
  if (!settings?.enabled || !settings.proxyUrl) return fetch(url, init);
  const proxy = new URL(settings.proxyUrl);
  const type =
    proxy.protocol === "socks5:" ? "socks" : proxy.protocol.replace(":", "");
  if (!["http", "https", "socks"].includes(type))
    throw new Error(getString("chat-voice-codex-unavailable"));
  const classes = Components.classes as nsIXPCComponents_Classes & {
    "@mozilla.org/network/protocol-proxy-service;1": {
      getService(
        iid: nsJSIID<nsIProtocolProxyService>,
      ): nsIProtocolProxyService;
    };
  };
  const service = classes[
    "@mozilla.org/network/protocol-proxy-service;1"
  ].getService(Components.interfaces.nsIProtocolProxyService);
  const info = service.newProxyInfoWithAuth(
    type,
    proxy.hostname,
    Number(
      proxy.port ||
        settings.proxyPort ||
        (type === "https" ? 443 : type === "socks" ? 1080 : 80),
    ),
    decodeURIComponent(proxy.username),
    decodeURIComponent(proxy.password),
    "",
    "paperchat-dictation",
    type === "socks" ? 1 : 0,
    0,
    null!,
  );
  const filter: nsIProtocolProxyChannelFilter = {
    QueryInterface: ChromeUtils.generateQI(["nsIProtocolProxyChannelFilter"]),
    applyFilter(channel, original, callback) {
      callback.onProxyFilterResult(channel.URI.spec === url ? info : original);
    },
  };
  service.registerChannelFilter(filter, 0);
  try {
    return await fetch(url, init);
  } finally {
    service.unregisterChannelFilter(filter);
  }
}

/** Use the same app-server authentication and HTTP route as Codex Desktop.
 * Tokens never enter preferences, log output, the XPI, or a loopback server. */
export async function transcribeWithCodex(
  audio: Blob,
  language: string,
  signal: AbortSignal,
): Promise<string> {
  const { Subprocess } = ChromeUtils.importESModule(
    "resource://gre/modules/Subprocess.sys.mjs",
  ) as { Subprocess: NativeSubprocess };
  const installation = await discoverCodexSwitchInstallation(
    getConfiguredSwitchRoot(),
  );
  if (!installation) {
    throw new Error(getString("chat-voice-codex-path-missing"));
  }
  const { root, executable } = installation;
  const settings = (await IOUtils.readJSON(
    PathUtils.join(root, "settings.json"),
  )) as {
    codexHome?: string;
    networkProxy?: SwitchNetworkProxy;
  };
  if (!settings.codexHome) {
    throw new Error(getString("chat-voice-codex-login-needed"));
  }
  if (!executable) throw new Error(getString("chat-voice-codex-cli-missing"));
  throwIfAborted(signal);
  const process = await Subprocess.call({
    command: executable,
    arguments: [
      "-c",
      'model_provider="openai"',
      "app-server",
      "--listen",
      "stdio://",
    ],
    environment: { CODEX_HOME: settings.codexHome },
    environmentAppend: true,
    // GUI-launched Zotero has no valid inherited stderr handle. The native
    // app-server can terminate before reading initialize unless it gets a pipe.
    stderr: "pipe",
  });
  void (async () => {
    while (await process.stderr.readString()) {
      // Native diagnostics may contain account information; never log them.
    }
  })().catch(() => undefined);
  const stop = (): void => {
    void process.kill();
  };
  signal.addEventListener("abort", stop, { once: true });
  let nextId = 0;
  let buffer = "";
  const rpc = async <T>(method: string, params: unknown): Promise<T> => {
    throwIfAborted(signal);
    const id = ++nextId;
    await process.stdin.write(JSON.stringify({ id, method, params }) + "\n");
    const timer = setTimeout(stop, 25000);
    try {
      while (true) {
        const newline = buffer.indexOf("\n");
        if (newline < 0) {
          const chunk = await process.stdout.readString();
          throwIfAborted(signal);
          if (!chunk)
            throw new Error(getString("chat-voice-codex-unavailable"));
          buffer += chunk;
          if (buffer.length > 8 * 1024 * 1024)
            throw new Error(getString("chat-voice-codex-unavailable"));
          continue;
        }
        const line = buffer.slice(0, newline);
        buffer = buffer.slice(newline + 1);
        const message = JSON.parse(line) as {
          id?: number;
          result?: T;
          error?: { code?: number };
        };
        if (message.id !== id) continue;
        // RPC errors can contain account details: expose only the error code.
        if (message.error)
          throw new Error(
            `${getString("chat-voice-codex-unavailable")} (RPC ${message.error.code})`,
          );
        return message.result as T;
      }
    } finally {
      clearTimeout(timer);
    }
  };
  try {
    await rpc("initialize", {
      clientInfo: { name: "paperchat_voice", version: "1.0" },
      capabilities: { experimentalApi: true },
    });
    await process.stdin.write(JSON.stringify({ method: "initialized" }) + "\n");
    let previousAccount: string | undefined;
    for (let attempt = 0; attempt < 2; attempt++) {
      const auth = await rpc<AuthResponse>("getAuthStatus", {
        includeToken: true,
        refreshToken: attempt > 0,
      });
      if (
        !auth.authToken ||
        !["chatgpt", "chatgptAuthTokens"].includes(auth.authMethod || "")
      ) {
        throw new Error(getString("chat-voice-codex-login-needed"));
      }
      const account = await rpc<AccountResponse>("account/read", {
        refreshToken: false,
      });
      const routing = account.workspaceRouting;
      const claims = JSON.parse(
        getVoiceWindow().atob(
          auth.authToken.split(".")[1].replace(/-/g, "+").replace(/_/g, "/"),
        ),
      ) as {
        "https://api.openai.com/auth"?: { chatgpt_account_id?: string };
      };
      const accountId =
        routing?.chatgptAccountId ||
        claims["https://api.openai.com/auth"]?.chatgpt_account_id;
      if (previousAccount && accountId !== previousAccount)
        throw new Error(getString("chat-voice-codex-account-changed"));
      previousAccount = accountId;
      const endpoint = new URL(
        "/backend-api/transcribe",
        routing?.backendOrigin || "https://chatgpt.com",
      );
      if (
        endpoint.protocol !== "https:" ||
        !(
          endpoint.hostname === "chatgpt.com" ||
          endpoint.hostname.endsWith(".chatgpt.com") ||
          endpoint.hostname.endsWith(".openai.com")
        )
      ) {
        throw new Error(getString("chat-voice-codex-unavailable"));
      }
      const headers: Record<string, string> = {
        Authorization: `Bearer ${auth.authToken}`,
        originator: "Codex Desktop",
        "User-Agent": "Codex Desktop/26.928.3736 (Windows NT 10.0; x64)",
      };
      if (accountId) headers["ChatGPT-Account-Id"] = accountId;
      if (
        routing?.accountRoutingOverride &&
        routing.accountRoutingOverride !== "NO_CONSTRAINT"
      ) {
        headers["X-OpenAI-Account-Routing-Override"] =
          routing.accountRoutingOverride;
      }
      const body = new (getVoiceWindow().FormData)();
      const mime = audio.type.split(";")[0] || "audio/webm";
      const extension =
        mime === "audio/ogg" ? "ogg" : mime.includes("wav") ? "wav" : "webm";
      body.append("file", audio, `codex.${extension}`);
      if (language) body.append("language", language);
      const response = await fetchNativeAudio(
        endpoint.href,
        {
          method: "POST",
          body,
          headers,
          signal,
          redirect: "error",
        },
        settings.networkProxy,
      );
      if (response.status === 401 && attempt === 0) {
        await response.body?.cancel();
        continue;
      }
      if (!response.ok) {
        await response.body?.cancel();
        const key =
          response.status === 429
            ? "chat-voice-codex-quota"
            : response.status === 401
              ? "chat-voice-codex-login-needed"
              : "chat-voice-codex-unavailable";
        throw new Error(`${getString(key)} (HTTP ${response.status})`);
      }
      const result = (await response.json()) as { text?: unknown };
      if (typeof result.text !== "string" || !result.text.trim())
        throw new Error(getString("chat-voice-no-text"));
      return result.text.trim();
    }
    throw new Error(getString("chat-voice-codex-login-needed"));
  } finally {
    signal.removeEventListener("abort", stop);
    await process.kill().catch(() => undefined);
  }
}
