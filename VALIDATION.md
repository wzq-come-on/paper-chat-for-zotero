# Validation — 3.7.1-codex.1

2026-10-01, Windows, upstream commit `8f5a3b2` (Paper Chat 3.7.0).

## Passed

- TypeScript typecheck and ESLint on modified TypeScript files.
- 76 targeted tests for Codex gateway adaptation, Responses history, stream reconstruction,
  cancellation, upstream HTTP errors, ordinary OpenAI request behavior and translation routing.
- 5 tests in an isolated real Zotero instance:
  - Actual Firefox fetch against a loopback synthetic gateway: model discovery, generation test,
    streaming Chinese text, function call and tool-result round trip.
  - Existing-provider migration without changing the selected provider.
  - Keyless loopback configuration and isolated translation provider.
  - Selecting Codex protocol on an existing custom provider.
  - Rendering, editing and saving the real Zotero preferences pane.
- The actual Codex Switch `/models?client_version=0.159.1` returned model slugs including `gpt-6.1-sol`.
- Initial raw `/responses` smoke test returned HTTP 200 and `OK`; `/chat/completions` returned 404.

## Still requires verification

Full production-provider live test (`npm run test:codex:live`) could not finish:
the current proxy account returned upstream HTTP 429, `workspace_member_credits_depleted`
and `usage_limit_reached`. An earlier attempt also returned a TLS-related 502.
The completed synthetic-gateway tests do not prove real upstream multi-turn generation.
Switch the proxy to an account with available quota and rerun the live test.

GitHub destination: https://github.com/wzq-come-on/paper-chat-for-zotero
No credential is bundled in this source tree or the XPI.

## Reproduce isolated Zotero tests (Windows)

Use Node 22.8+, Python 3 and an installed Zotero. In one terminal:

```powershell
python scripts/codex-test-server.py
```

In another terminal in this repository:

```powershell
node node_modules/esbuild/bin/esbuild node_modules/chai/index.js --bundle --format=iife --global-name=chai --platform=browser --outfile=.scaffold/cache/chai.js
$env:ZOTERO_PLUGIN_ZOTERO_BIN_PATH = 'C:/Program Files/Zotero/zotero.exe'
$env:ZOTERO_PLUGIN_KILL_COMMAND = 'cmd /c exit 0'
$env:MOZ_HEADLESS = '1'
$env:PAPERCHAT_CODEX_TEST = '1'
node node_modules/zotero-plugin-scaffold/bin/zotero-plugin.mjs test --exit-on-finish
```

The test profile/data remain under `.scaffold/test/`. The kill-command override prevents the
scaffold's fallback from closing unrelated Zotero instances. Stop the synthetic gateway with Ctrl+C.
