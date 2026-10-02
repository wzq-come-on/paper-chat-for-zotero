# Validation — 3.7.8

## Native dictation GUI process repair — 3.7.8 (2026-10-02)

- Captured two actual `[object Object]` errors from the user's main Zotero window.
  In that same GUI-launched process, a synthetic WAV completed Windows capture,
  stop and file loading, then native dictation rejected with a Firefox worker
  object: message `File closed`, errorCode `4286185473`, stdin write stack.
- The previous isolated test process had valid inherited stdio, so that test
  alone did not establish that dictation worked in the GUI-launched application.
- Changed native app-server stderr from inherited/ignore to a pipe and drained
  it without logging native account diagnostics. Cleanup no longer masks an
  earlier error if process termination fails. Voice UI reads known message and
  errorCode fields for plain worker objects and errors from other realms.
- Built the repaired code and ran it in the user's actual Zotero. Synthetic WAV
  capture, stop, loading and real native transcription passed. The returned text
  was `This is a speech transcription test for Paper Chat.`
- No live microphone audio or user paper was captured or uploaded.
- In the user's live GUI process, exercised the voice controller with synthetic
  audio: click start, wait for recording state, click stop, real transcription,
  editable draft insertion and return to the idle button state all passed.
  The test used separate temporary controls and left the user's composer alone.
- Three error-display regression tests passed, including worker rejection fields,
  another JavaScript realm and avoiding arbitrary account payload serialization.
  The five isolated capture/production-chat tests passed. TypeScript, ESLint on
  changed code and `git diff --check` passed.
- Installed the production 3.7.8 XPI, verified it is enabled and active, and
  matched the installed profile file to the release SHA-256:
  `106134358e0f3c75193de26195ffa3b2d60ecfb421109574f3df39c526da5c0a`.
- After the graceful restart, reopened the existing PDF/chat panel and verified
  the model dropdown opens with eight Codex models. Repeated the synthetic
  voice-controller flow in the restarted GUI process: native transcription,
  editable draft insertion and idle-button restoration passed again.

## GUI-launched Windows recording repair — 3.7.7 (2026-10-02)

- Captured the user's actual Zotero window and confirmed two generic Windows
  recording errors. These messages did not establish that a device was occupied.
- In that same running Zotero process, the installed helper in non-recording
  probe mode exited with code 0 and empty stdout using `stderr: "ignore"`.
  Changing only stderr to a pipe returned `access: Allowed`, two devices and
  successful initialization. stderr contained PowerShell Windows Runtime
  initialization progress serialized as CLIXML.
- Fixed the missing console stderr handle by always supplying and draining a
  pipe. Suppressed PowerShell progress and added specific helper-exit and
  unexpected-status details. SystemRoot lookup now accepts Windows key casing.
- The repaired TypeScript capture code was loaded into a plain script context
  in the user's live Zotero. Its non-recording probe passed with Allowed access,
  two devices and successful initialization. A separate native waveInOpen probe
  opened and closed the default 16-kHz mono input without starting recording.
- Isolated Zotero capture/UI regressions: **5 passed**, including the previously
  untested Windows Runtime microphone initialization branch, helper stop/cancel,
  temporary-file cleanup, model selection and both button/Enter send paths.
- No user microphone audio or real paper was captured or uploaded by these checks.
- Native-account voice regressions: **4 passed**. A synthetic speech WAV passed
  through the real Windows helper and native Codex transcription service into
  an editable composer draft. Production TypeScript, changed-file ESLint and
  `git diff --check` passed.
- Installed production XPI 3.7.7 in the user's profile and verified it is active
  and enabled. The installed file matches the release SHA-256:
  `034abc89717ead480ffaf5a66985399679e99530127ebc83754e2bc2c70f4ce0`.
- After a graceful Zotero restart, verified 3.7.7 is active, the packaged helper
  suppresses progress, the model selector opens, and the same non-recording
  capture probe passes in the user's actual process. The existing PDF reopened.

## Chat initialization repair — 3.7.6 (2026-10-02)

- Replaced sandbox-global AbortController construction with the existing managed
  controller utility. Recording acquisition stays deferred until a user click.
- Resolved Blob, FormData, atob and btoa through a real Zotero window.
- Isolated optional voice initialization errors so model, send and keyboard
  handlers still bind if recording initialization fails.
- Added an actual production-plugin UI regression test: invoke the plugin menu,
  wait for session readiness, open the model selector, choose a model, then send
  two synthetic messages with the button and Enter. This exercises the installed
  plugin instance rather than UI modules imported into Mocha's window.
- Isolated Zotero capture/UI suite: **4 passed**. Model selection, both send
  paths, helper stop/cancel, temporary-file cleanup and acquisition disposal passed.
- Native voice suite: **4 passed**, including synthetic WAV capture, real Codex
  transcription and editable draft insertion. Voice functions were loaded into
  a plain script context without global AbortController, Blob or FormData.
- No live user microphone recording or paper upload was performed by these tests.
- Installed the production 3.7.6 XPI into the user's Zotero and verified that
  the installed file matches the release SHA-256. A graceful Zotero restart was
  needed to replace the previously loaded plugin code. The PDF tab reopened;
  the user's composer draft was backed up and restored without sending it.
- In the live restarted Zotero window, the model selector displays
  `Codex Switch · gpt-6.1-sol` and opens the eight configured Codex models.
- Production build, TypeScript, ESLint on changed code and `git diff --check` passed.
- Release XPI SHA-256:
  `667e18787f0e024009a46c42892cd05ebdfbc512b8513f495becd33a2106a6e5`.
- Live proxy discovery returned all eight models. The first real generation
  attempt reached the service but returned HTTP 429 `usage_limit_reached` for
  the local proxy's selected account. This is separate from panel initialization.
- Retried after the service's reported quota-reset time. The existing live
  synthetic integration script passed model discovery, generation, Chinese
  streaming translation, tool request/result round-trip and multi-turn context.

## Windows capture repair — 3.7.5 (2026-10-02)

- Reproduced `NotAllowedError` using the actual Zotero 10.0.5 `getUserMedia`
  API with `fake: true`, in the main window, HTML iframe, XUL browser, and
  standalone addon HTML window, both with and without headless mode.
- MediaManager logs locate the failure at device initialization
  (`Request to camera access failed`), after document policy checks and before
  microphone enumeration. Windows native AudioCapture access status is Allowed.
  The exact cause inside Zotero's media backend has not been established.
- Windows now uses a bundled PowerShell/.NET helper with Win32 waveform audio.
  It checks native microphone access before opening a device, exits on cancel,
  parent exit or the two-minute limit, and never changes permission settings.
- Native device preflight detected two input devices and successfully opened,
  configured and closed the MCI recorder at 16 kHz mono PCM. Preflight did not
  start recording or upload microphone audio.
- Three isolated Zotero tests pass: helper stop returns a valid synthetic WAV
  and deletes temporary files, abort closes the helper and cleans files, and
  disposing during acquisition prevents transcription and duplicate recording.
- Four end-to-end Zotero tests passed, including synthetic speech through the
  helper's real process protocol and the actual native Codex account. The text
  was filled into the composer. Actual user speech capture remains a manual
  check after installation.
- Installed the 3.7.5 production XPI into the user's running Zotero through
  Plugins Manager and verified Version 3.7.5 and Enable selected. The main PDF
  remained open. Artifact SHA-256:
  `d1a852adc782721ebf886ba8be931e92b7b00d8987fb808d1a4263bbc78204e4`.

To reproduce capture lifecycle tests, set `PAPERCHAT_VOICE_CAPTURE_TEST=1` and
`PAPERCHAT_VOICE_TEST=0` with the same scaffold command below. To reproduce the
native-account integration, set capture to 0, voice to 1 and point
`PAPERCHAT_VOICE_AUDIO` to a synthetic speech WAV.

## Voice validation — 3.7.4 (2026-10-02)

- Native Codex Desktop authentication (`getAuthStatus`, `account/read`) and the
  workspace-routed dictation endpoint returned HTTP 200 for synthetic speech.
- Four tests passed in an isolated Zotero 10.0.5 profile: readable localization
  and draft insertion, cancellation before authentication, a real Firefox
  MediaRecorder recording synthesized speech and filling the composer through
  the real native account, and rendering/persisting speech preferences.
- Voice-mode menu items use Fluent `.label` attributes, with assertions for all
  five visible option labels and the selected label in the real preferences pane.
- The recording test recognized “This is a speech transcription test for Paper Chat.”
  It used a synthesized audio stream; no user microphone or paper was uploaded.
- Production build, TypeScript, ESLint and whitespace validation passed.
- Reproduce with `PAPERCHAT_VOICE_TEST=1` and `PAPERCHAT_VOICE_AUDIO` pointing to a
  synthetic English WAV when running the scaffold test command shown below.

## Earlier text integration validation

2026-10-01, Windows, upstream commit `8f5a3b2` (Paper Chat 3.7.0).

## Passed

- 3 permanent-install regression tests in Zotero 10.0.5:
  - Reproduced the 3.7.1-codex.1 install failure: omitting Zotero's required
    `applications.zotero.update_url` yields `ERROR_CORRUPT_FILE`.
  - Restoring only that field makes the same release pass manifest validation.
  - Installed the exact 3.7.2 production XPI via `AddonManager.getInstallForFile`
    and `install()`, verified it is active and permanently installed, and opened
    its real preferences pane to verify the Codex Switch provider.
  - The update URL now points exclusively to this fork's `updates.json`.

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

## Reproduce packaged installation tests

Build a production XPI first, then prepare the test fixtures before the scaffold
clears its build directory:

```powershell
$env:NODE_ENV = 'production'
node node_modules/zotero-plugin-scaffold/bin/zotero-plugin.mjs build
python scripts/prepare-install-test.py .scaffold/build/ai-paper-chat-codex-switch.xpi
$env:NODE_ENV = 'test'
$env:ZOTERO_PLUGIN_ZOTERO_BIN_PATH = 'C:/Program Files/Zotero/zotero.exe'
$env:ZOTERO_PLUGIN_KILL_COMMAND = 'cmd /c exit 0'
$env:MOZ_HEADLESS = '1'
$env:PAPERCHAT_CODEX_TEST = '0'
$env:PAPERCHAT_INSTALL_TEST = '1'
node node_modules/zotero-plugin-scaffold/bin/zotero-plugin.mjs test --exit-on-finish
```

Use the same local Chai preparation shown above. These tests permanently install
the release only inside `.scaffold/test/`, never inside the user's live profile.
