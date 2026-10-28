# Release 3.7.13

This release fixes the edit composer so an unchanged prompt can be submitted again after a transient provider failure. Empty prompts remain disabled.

Validation:

- TypeScript check: `npx tsc --noEmit --composite false --incremental false`
- Production XPI contains `content/scripts/paperchat.js`.
- XPI SHA256: `64b3ecf0191c2ff64f3443eef7d99771b4b71c7942846a0fecfa4038c8ee58be`
