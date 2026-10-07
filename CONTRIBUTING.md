# Contributing

## Setup

```bash
npm install
cp .env.example .env   # add your own ANTHROPIC_API_KEY (or GEMINI_API_KEY)
npm run dev
```

**Known quirk: don't mix operating systems on one `node_modules`.** Some dependencies ship
platform-specific native binaries (Tailwind's `lightningcss`, Next's SWC compiler). If you ran
`npm install` on Windows and then `npm run dev` from WSL (or the reverse), the page fails with
`Cannot find module '../lightningcss.linux-x64-gnu.node'`. Install and run in the same
environment. On WSL, clone into the Linux filesystem (for example `~/advisory-brief`) rather than
`/mnt/c/...`, which is also much slower: a cold `next dev` took minutes there.

## Branch / PR flow

1. Fork the repo (or branch directly if you have write access).
2. Create a branch: `git checkout -b your-feature-name`.
3. Make your change, with tests for anything in `src/`.
4. Run the full local check before pushing: `npm run lint && npm run typecheck && npm run test && npm run build`.
5. Open a PR against `main`. CI runs the same four checks; all must pass before merge.

## Code style

TypeScript strict mode, ESLint's Next.js config (`npm run lint` to check, most issues
auto-fixable with `npm run lint -- --fix`). No unrelated formatting-only diffs in a
feature/fix PR, please — keep them separable.

## Running tests

`npm run test` runs the full Vitest suite. No network access or API key is required — every
test that would otherwise need the Anthropic API or GitHub's API mocks it (see
`src/brief/generate.test.ts` and `src/sources/github-releases.test.ts` for the pattern).

The brief view is rendered in tests (`app/page.test.tsx`), which is what pulled in the UI-side
devDependencies: `jsdom` (a DOM for React to render into — the rest of the suite stays on
Node's environment, and that file opts in with a `// @vitest-environment jsdom` comment),
`@testing-library/react` + `@testing-library/dom` + `@testing-library/user-event` (to drive the
form, the audience buttons and the keyboard-only flow as a person would, rather than by calling
handler props directly), and `axe-core` (the automated accessibility check — see
[`docs/ARCHITECTURE.md`](docs/ARCHITECTURE.md#accessibility-on-the-brief-view)). They are all
dev-only: nothing in `dependencies` changed, so a deployed app ships the same bundles it did
before. `@testing-library/jest-dom` was deliberately not added; the assertions used are
`toBeTruthy()`/`textContent`, and the matcher sugar did not justify another package.

Copying is asserted by reading `navigator.clipboard.readText()`. Don't replace that with a stub of
`writeText` attached in `beforeAll`: `userEvent.setup()` installs its own clipboard stub on
`window.navigator` afterwards and shadows it, so the component writes to user-event's clipboard and
the mock records nothing.

## How issues are rated

Every issue in [`ISSUES_BACKLOG.md`](ISSUES_BACKLOG.md) is tagged **Trivial**, **Medium**, or
**High**:

- **Trivial** — typos, small bug fixes, minor copy changes, a new audience profile, a new
  fixture, clearer error messages.
- **Medium** — a standard feature or a more involved bug fix: a new source plugin, dark mode,
  i18n scaffolding, persisted history, an accessibility pass.
- **High** — a complex feature, a refactor, or a new integration: shareable permalinks, rate
  limiting/abuse protection, an evaluation harness comparing briefs against hand-written gold
  briefs, a Slack/Discord webhook export.

If you're picking up a High-complexity issue for the first time, it's fine to open a draft PR
early and ask questions — better than a large PR landing with no discussion along the way.

## Adding a source or an audience

Both are designed to be additive, not core changes — see
[`docs/ADDING_A_SOURCE.md`](docs/ADDING_A_SOURCE.md) and
[`docs/ADDING_AN_AUDIENCE.md`](docs/ADDING_AN_AUDIENCE.md).

## How maintainers work here

- There is currently one maintainer. Response times are best effort; there is no guaranteed
  turnaround.
- A bug report is reproduced before a fix is accepted. A feature is discussed in its issue
  before a PR is opened.
- CI (lint, typecheck, tests, build) must pass before merge.
- A change to the grounding verifier (`src/brief/grounding.ts`) needs tests, and the README's
  "What grounded means here" section must stay accurate about what is and isn't checked.
- A change that affects a documented claim updates the docs in the same PR.
- This repository is an application, not a published package, so it has no release tags.
- Security reports: see [`SECURITY.md`](SECURITY.md).
