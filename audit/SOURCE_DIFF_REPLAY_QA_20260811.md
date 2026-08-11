# Deterministic source-diff replay QA - 2026-08-11

Scope: synthetic local snapshots only. No public agenda, source website, account, publication or deployment was changed.

The replay engine compares a previous and next source snapshot by stable item ID. It emits one deterministic action per ID:

- `add` for a new item;
- `change` for changed source content;
- `expire` when a previously eligible item crosses its explicit expiry date;
- `remove` when an ID disappears from the next source snapshot;
- `unchanged` otherwise.

The test matrix contains one of each action. Reversing both input arrays produces byte-equivalent digests and action order. Duplicate identities fail closed. Source arrays remain unchanged.

Run `npm run test:source-diff-replay` or the complete `npm run check`. The output is local audit evidence and is not a publish instruction.
