# Open Showcaller — Project Rules

Read this before doing anything in this repo. These rules are permanent.

## Confidentiality of reference material — HARD RULE

This project is modeled on a commercial reference platform. **Nothing that identifies that platform may ever reach GitHub** — not in files, commit messages, branch names, code comments, issue/PR text, or the changelog. This includes the vendor's name, product names, demo URLs, and the reference screenshots.

All vendor-identifying material lives ONLY in local-only files, which are listed in `.gitignore` and must stay there:

- `Images/` — reference screenshots (never commit)
- `DEMO_NOTES.md` — detailed product research from the vendor's interactive demos (never commit)
- `CLAUDE.local.md` — vendor-specific pointers and URLs (never commit)

Before every commit and push, verify nothing staged references the vendor (`git diff --cached | grep -i` against the terms listed in `CLAUDE.local.md`). When in doubt, leave it out of the repo.

## Source of truth

- **[BUILD_PROMPT.md](BUILD_PROMPT.md)** — the product spec and kickoff prompt. Update it when the product direction changes.
- **`DEMO_NOTES.md`** (local-only) — ongoing feature research and UX details for the product we're building toward. Add to it whenever new product behavior is learned; it is the design reference during implementation.

## Development log — keep it current

**`DEVLOG.md`** (local-only, gitignored) is the running development journal. Append an entry for every unit of work **as you go** — what was built, decisions made, gotchas hit, verification results, and current dev workflow. Future sessions rely on it for context the public repo can't carry. Candid notes and vendor names are fine there; never commit it.

## Changelog discipline

**[CHANGELOG.md](CHANGELOG.md)** must be updated in the same commit as any meaningful change (spec updates, new features, structural changes, tooling). Keep a Changelog format, newest first, under an `[Unreleased]` heading until versions exist. Entries are written generically — no vendor references.

## Repo hygiene

- Remote: `https://github.com/robertcmorton/open-showcaller.git` (HTTPS via `gh`; this machine has no SSH keys).
- Commit and push after each completed unit of work so GitHub stays the backup.
- The local working folder contains files that must never be committed (see above); never use `git add -A`/`git add .` without checking what it would stage.
