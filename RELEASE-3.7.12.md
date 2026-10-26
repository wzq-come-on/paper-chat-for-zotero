# Release 3.7.12

This release fixes the 3.7.11 packaging regression. The XPI now includes the bundled Paper Chat startup script and all browser-side bundles, so Zotero can load the AI Chat menu and right-side panel after installation.

Validation:

- TypeScript check: `npx tsc --noEmit --composite false --incremental false`
- Production XPI contains `content/scripts/paperchat.js`.
- XPI SHA256: `f4c4ad1983d751a1caa437f56ab72fd38e90c951ebdde89c698c0f823b98fdf3`
