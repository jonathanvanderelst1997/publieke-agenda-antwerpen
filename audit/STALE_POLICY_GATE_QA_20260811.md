# Fail-closed stale-policy gate — 2026-08-11

The pure gate in `scripts/stale-policy.mjs` is now the single decision point used
by the provenance/SLA matrix. `npm run test:stale-policy` proves that an official
verified HTTPS source is eligible on its exact recheck due date and blocked one
calendar day later.

The same gate blocks an expired, review-required, unknown, unverified,
non-official, non-HTTPS, missing-retrieval, invalid-retrieval, missing-due,
invalid-due, or invalid-as-of input. Every blocked result explicitly returns
`publishEligible: false` and `failClosed: true`.

These are local deterministic policy tests. They do not refresh a public source,
publish an agenda, or establish that any hosted copy uses this candidate.
