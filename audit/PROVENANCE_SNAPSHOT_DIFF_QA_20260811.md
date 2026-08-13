# Provenance snapshot/diff QA — 2026-08-11

`npm run build:provenance-snapshot` creates two deterministic local artifacts:

- `audit/provenance-source-snapshot-20260811.json`: the normalized provenance
  projection derived directly from the expanded agenda and configured sources;
- `audit/provenance-source-diff-20260811.json`: a field-for-field diff against
  the independently built provenance/SLA matrix.

The comparison covers ID, title, event date, classification date, source ID and
publisher, canonical URL and host, retrieval date, and verification state. It is
a source-to-derived-artifact reconciliation, not a temporal claim that a public
publisher has not changed its website.

The local gate expects 132 unique source rows and exactly 132 unchanged
projections, with zero add/change/remove actions. Any divergence fails the test.
Nothing is published or fetched.
