"""Probe Codex Desktop's dictation route using app-server authentication.

Uses a synthetic WAV, never a microphone or library document. The OAuth token
stays in memory and is never included in output or an artifact.
"""

import json
import os
import queue
import subprocess
import threading
import time
import urllib.error
import urllib.parse
import urllib.request
import uuid
from pathlib import Path


SWITCH_ROOT = Path(r"E:\AppData\Roaming\dev.codex.switch")


class AppServer:
    def __init__(self, executable, home):
        env = dict(os.environ, CODEX_HOME=str(home))
        self.process = subprocess.Popen(
            [str(executable), "-c", 'model_provider="openai"', "app-server", "--listen", "stdio://"],
            env=env,
            stdin=subprocess.PIPE,
            stdout=subprocess.PIPE,
            stderr=subprocess.DEVNULL,
            text=True,
            encoding="utf-8",
            creationflags=subprocess.CREATE_NO_WINDOW,
        )
        self.messages = queue.Queue()
        self.next_id = 0
        threading.Thread(target=self._read, daemon=True).start()
        self.call("initialize", {
            "clientInfo": {"name": "paperchat_voice_probe", "version": "1.0"},
            "capabilities": {"experimentalApi": True},
        })
        self.send({"method": "initialized"})

    def _read(self):
        for line in self.process.stdout:
            try:
                self.messages.put(json.loads(line))
            except ValueError:
                pass

    def send(self, message):
        self.process.stdin.write(json.dumps(message) + "\n")
        self.process.stdin.flush()

    def call(self, method, params, timeout=25):
        self.next_id += 1
        request_id = self.next_id
        self.send({"id": request_id, "method": method, "params": params})
        deadline = time.monotonic() + timeout
        while time.monotonic() < deadline:
            message = self.messages.get(timeout=max(0.1, deadline - time.monotonic()))
            if message.get("id") == request_id:
                if "error" in message:
                    raise RuntimeError(f"{method} failed (RPC {message['error'].get('code')})")
                return message["result"]
        raise TimeoutError(f"{method} timed out")

    def close(self):
        self.process.terminate()
        try:
            self.process.wait(timeout=5)
        except subprocess.TimeoutExpired:
            self.process.kill()
            self.process.wait()


def main():
    settings = json.loads((SWITCH_ROOT / "settings.json").read_text(encoding="utf-8"))
    state = json.loads((SWITCH_ROOT / "state.json").read_text(encoding="utf-8"))
    executable = Path(state.get("local_codex_path") or "")
    if not executable.is_file():
        executable = SWITCH_ROOT / "codex-cli" / "0.159.3" / "bin" / "codex.exe"
    home = Path(settings["codexHome"])
    audio = Path(os.environ["TEMP"]) / "paperchat-voice-smoke.wav"
    proxy_settings = settings.get("networkProxy", {})
    proxy = os.environ.get("PAPERCHAT_NETWORK_PROXY") or (
        proxy_settings.get("proxyUrl") if proxy_settings.get("enabled") else None
    )
    if proxy:
        parsed_proxy = urllib.parse.urlparse(proxy)
        if parsed_proxy.hostname and parsed_proxy.port is None and proxy_settings.get("proxyPort"):
            proxy = proxy.rstrip("/") + ":" + str(proxy_settings["proxyPort"])
    opener = urllib.request.build_opener(
        urllib.request.ProxyHandler({"https": proxy} if proxy else {})
    )
    server = AppServer(executable, home)
    try:
        auth = server.call("getAuthStatus", {"includeToken": True, "refreshToken": False})
        print("auth method:", auth.get("authMethod"), flush=True)
        if auth.get("authMethod") not in ("chatgpt", "chatgptAuthTokens") or not auth.get("authToken"):
            raise RuntimeError("Selected Codex Home has no native ChatGPT login")
        account = server.call("account/read", {"refreshToken": False})
        routing = account.get("workspaceRouting")
        print("routing:", "workspace" if routing else "legacy", flush=True)
        endpoint = "https://chatgpt.com/backend-api/transcribe"
        headers = {
            "Authorization": "Bearer " + auth["authToken"],
            "originator": "Codex Desktop",
            "User-Agent": "Codex Desktop/26.928.3736 (Windows NT 10.0; x64)",
        }
        if routing:
            origin = routing["backendOrigin"].rstrip("/")
            parsed = urllib.parse.urlparse(origin)
            if parsed.scheme != "https" or not parsed.hostname or not (
                parsed.hostname == "chatgpt.com"
                or parsed.hostname.endswith(".chatgpt.com")
                or parsed.hostname.endswith(".openai.com")
            ):
                raise RuntimeError("Unexpected workspace routing origin")
            endpoint = origin + "/backend-api/transcribe"
            headers["ChatGPT-Account-Id"] = routing["chatgptAccountId"]
            override = routing.get("accountRoutingOverride")
            if override and override != "NO_CONSTRAINT":
                headers["X-OpenAI-Account-Routing-Override"] = override
        else:
            # The account ID is a token claim, not a new credential.
            import base64
            payload = auth["authToken"].split(".")[1]
            claims = json.loads(base64.urlsafe_b64decode(payload + "=" * (-len(payload) % 4)))
            account_id = claims.get("https://api.openai.com/auth", {}).get("chatgpt_account_id")
            if account_id:
                headers["ChatGPT-Account-Id"] = account_id
        boundary = "paperchat-" + uuid.uuid4().hex
        body = (
            f'--{boundary}\r\nContent-Disposition: form-data; name="file"; filename="codex.wav"\r\n'
            'Content-Type: audio/wav\r\n\r\n'
        ).encode() + audio.read_bytes() + (
            f'\r\n--{boundary}\r\nContent-Disposition: form-data; name="language"\r\n\r\nen\r\n--{boundary}--\r\n'
        ).encode()
        headers["Content-Type"] = f"multipart/form-data; boundary={boundary}"
        request = urllib.request.Request(endpoint, data=body, headers=headers, method="POST")
        try:
            with opener.open(request, timeout=35) as response:
                result = json.load(response)
                print("HTTP", response.status, "transcript:", result.get("text"), flush=True)
        except urllib.error.HTTPError as error:
            raw = error.read()
            try:
                data = json.loads(raw)
                detail = data.get("detail", data.get("error", {}))
                if isinstance(detail, dict):
                    detail = {k: detail[k] for k in ("code", "type", "message") if k in detail}
                elif isinstance(detail, list):
                    detail = [{k: d[k] for k in ("type", "loc", "msg") if k in d} for d in detail]
                print("HTTP", error.code, "detail:", str(detail)[:500], flush=True)
            except ValueError:
                print("HTTP", error.code, "non-JSON error", flush=True)
    finally:
        server.close()


if __name__ == "__main__":
    main()
