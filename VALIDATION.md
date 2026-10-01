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
- Full production-provider test (`npm run test:codex:live`) passed against the actual
  Codex Switch loopback proxy, using `gpt-6.1-sol`:
  - Model discovery and a generation-based connection test.
  - Streaming Chinese translation: `降水临近预报预测未来几小时内的降雨情况。`
  - A `read_paper` function call, returning synthetic paper text via a tool result.
  - A grounded answer identifying the synthetic paper's forecast horizon as 120 minutes.
  - Multi-turn follow-up in Chinese: `2小时。`

## Proxy account configuration

The local proxy's default account is the account selected in Switch's account-management
page, independent of the GUI chat account. Selecting an account with quota in
`账户管理 → 官方账户 → 当前账户` resolved the upstream 429 and allowed the full live test to pass.
The live check uses synthetic text and does not upload library data or real PDFs.

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
