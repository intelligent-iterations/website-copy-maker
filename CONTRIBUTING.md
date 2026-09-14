# Contributing

Thanks for considering a contribution.

## Ground rules

- **Tests first.** New behavior arrives with a failing vitest test that the change makes pass. PRs without tests will be asked to add them before review.
- **Functional core.** Pure functions where possible. Side effects (Playwright, fs, child processes) get injected as dependencies so the pure logic remains unit-testable.
- **No live URL tests in CI.** Integration tests render local HTML fixtures via a tiny static server. If you need to verify a real-world site, do it manually and keep captures in your task workspace; add only generic synthetic fixtures here.
- **Cleanup is a feature.** Every browser, page, and child process must be torn down in `finally`. A leaked Chromium on the runner counts as a bug, not a quirk.

## Local setup

```bash
pnpm install
pnpm test:unit
pnpm lint
pnpm check:instructions
```

## Submitting changes

1. Create a branch from the latest `main`.
2. Add or update tests under `tests/`.
3. Run the fast checks above. Run `pnpm test:integration` and `pnpm build` in an approved isolated runtime; record results and cleanup.
4. Open a PR with a one-paragraph description: what changed, why, and how it's tested.

## Code style

- TypeScript strict mode.
- Prettier-formatted (`pnpm format`).
- Prefer `const`, named exports, and explicit return types on exported functions.
- No default exports outside `app/page.tsx` style framework conventions.
