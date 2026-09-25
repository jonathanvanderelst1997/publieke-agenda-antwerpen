# Agent Instructions

This public repository is the canonical source for the public District Antwerpen agenda site and its public deployment configuration.

1. Treat `main` on `jonathanvanderelst1997/publieke-agenda-antwerpen` as the source of truth. Render services are runtime copies, not document archives.
2. Keep this repository public-only. Never add private hub URLs, personal local paths, mailbox content, account data, visitor data, credentials, tokens, private dossiers or unpublished political material.
3. Work on a separate branch and pull request. Check open issues and pull requests first, preserve unrelated work and do not modify a branch owned by another active task.
4. The three known Render static services currently use this repository and branch, but automatic deployment, traffic, custom links and rollback ownership are not fully verified. Treat every merge to `main` as a possible live publication.
5. Do not delete, redirect, repoint or manually deploy any service without separate explicit authorization and a confirmed rollback route.
6. `site/` is the only published directory. Keep generated public agenda data and `site/public-agenda-manifest.json` internally consistent, and never infer current event validity solely from an older generated timestamp.
7. For documentation-only changes, run `git diff --check`. For site or manifest changes, also verify the static files locally and compare the manifest count, digest and canonical public URL as appropriate.
8. After meaningful work, return only a privacy-safe handoff containing the repository, branch, commit, checks, blocker and next action. Do not include private project IDs, chat transcripts or private evidence in this public repository.
