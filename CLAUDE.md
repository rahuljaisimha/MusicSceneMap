# CLAUDE.md

Project overview, architecture, file structure and design decisions live in
SUMMARY.md, imported here so every session starts with it:

@SUMMARY.md

Keep SUMMARY.md accurate when a change affects what it describes (features,
files, schema, deploy setup). Update README.md too when user-facing features change.

## Workflow

- Every change goes through a pull request into `main`: commit on a branch,
  push it, and open a PR. Never push to `main` directly.
- Squash changes of the same type into a single commit per PR. Unrelated
  changes (e.g. a UI fix and a docs rewrite) go in separate PRs.
- When `main` moves, rebase the PR branch onto it (a merge commit is not needed).
- Before pushing, run:
  ```bash
  npx tsc -b
  npm test
  npm run build
  ```
- Don't commit `tsconfig.tsbuildinfo` (build cache, gitignored).

## Previews

Cloudflare builds a preview deployment for every PR. The
`cloudflare-workers-and-pages` bot posts the preview link, and its build
status, as a comment on the GitHub PR ("Deploying Preview to Cloudflare").
The "Preview URL" at the top of that comment always points to the latest
commit on the branch; the table below it has a fixed URL per commit. Use
that link to check a change in a real browser, including on a phone. If the
build fails, the comment links to the Cloudflare build logs.

Preview builds use `wrangler.jsonc` (which needs its `previews` block) and
load the graph database from R2, not from `public/graph.db.gz`.

## Mobile

The UI must work at phone width. Check layouts at 320px and 390px with no
horizontal scroll. Phone styles are in the `@media (max-width: 640px)` block
in `src/index.css`. Components expose class hooks (`page-container`,
`page-title`, `nav-*`, …) that the media query targets. Below 640px the nav is
a hamburger menu (`src/components/Layout.tsx`).
