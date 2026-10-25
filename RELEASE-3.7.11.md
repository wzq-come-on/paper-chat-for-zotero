# Release 3.7.11

This release fixes editing and resending the latest user message when the edited text is unchanged. The resend action now rebuilds the turn and sends it again instead of returning silently without a request.

Validation:

- TypeScript check: `npx tsc --noEmit --composite false --incremental false`
- Production XPI build completed.
- XPI SHA256: `0b837d0706756d4a7a3d98504da1b5adad8c747c7a75e95e3f5c17395933f247`
