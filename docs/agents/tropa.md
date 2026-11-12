# Tropa

Machine config lives in [`tropa.toml`](tropa.toml). This file holds what the TOML cannot say.

## Check

`bash scripts/check` defines green: `npm run typecheck`, `npm test` (Vitest, including the architecture test in `tests/unit/architecture/`), the collector's `python -m pytest -q` and `tropa quality` against [`quality-baseline.json`](quality-baseline.json). It runs offline against local test doubles. CRAP is unmeasured: the repo has no coverage provider.

`scripts/git-hooks/pre-push` reruns the check unless it already passed on the pushed tree. Enable it in a new clone with `git config core.hooksPath scripts/git-hooks`.

## Tracker

GitHub Issues of the front repository, as in [`issue-tracker.md`](issue-tracker.md).

## Autonomy

Work goes on a `feat/...` or `fix/...` branch with a PR. Nothing is pushed without the owner's explicit authorization: UFCIM has users running it. `[deploy]` makes the tropa pre-tool hook ask before a Worker deploy, a `wrangler secret` change or any `wrangler d1` command without `--local`.

## Night shift

Not eligible (`[night] eligible = false`), as in the front repository.
