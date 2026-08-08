# Differential parity suite

`npm run test:parity` compares this CLI against a reference stacked-branch CLI
by running both against identical Git repositories and diffing everything
observable: exit status, functional stdout/stderr, active/detached state,
rebase state, porcelain status, branch trees, commit counts, and the ancestry
matrix.

**A non-zero exit from this suite is expected.** The sections below explain
which failures are known, why they happen, and how to tell a real regression
apart from the baseline noise.

## Prerequisites

The suite only runs on a machine that has the reference CLI installed and
authenticated:

- the reference executable at the path configured in `tests/parity/parity-fixture.ts`;
- its credentials in `~/.config/<reference>`, which the fixture copies into a
  temporary `HOME` per repository;
- Python 3 for `tests/helpers/pty-driver.py`, used by the interactive TTY tests.

This is why the parity suite cannot run in CI, and why `npm run check` covers
only typecheck, the unit suite, and formatting.

## Current baseline

Measured 2026-08-08 against reference CLI 1.8.6:

```
Test Files  5 failed | 25 passed | 1 skipped (31)
     Tests  10 failed | 171 passed | 2 skipped (183)
```

Treat **10 failing** as the baseline, not zero. The same 10 fail on a clean
checkout of `main`.

### The known failures

| Test                                                                            | Cause                                                                                                                                                          |
| ------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `alias-parity` — help through the `s`, `tr`, `utr` aliases                      | The reference CLI rewrote its command descriptions. Ours are now stale copies.                                                                                 |
| `submit-errors-parity` — repository without a GitHub remote                     | The two CLIs word the repository-identity error differently. The test already carries a `normalizeRepositoryIdentityError` helper for part of this divergence. |
| `modify-options-parity` — modifying a downstack branch with `--into`            | Output divergence on the `--into` path.                                                                                                                        |
| `tty-abort-parity` — confirming, declining, and cancelling an interactive abort | Divergence in interactive prompt rendering.                                                                                                                    |
| `tty-mutation-parity` — child selection when inserting a branch                 | Divergence in interactive prompt rendering.                                                                                                                    |

The help-text drift is the clearest of these. The reference CLI now describes
`submit` in terms of its own interactive metadata prompts and config menu,
while ours describes the narrower behavior this CLI actually implements. The
diff is real and the reference text describes features this CLI does not have,
so closing it means deciding how much of the reference wording to keep rather
than fixing a bug.

## Flakiness

The suite runs with `fileParallelism: true`. Under load, vitest can emit:

```
Error: [vitest-worker]: Timeout calling "onTaskUpdate"
```

These are worker RPC timeouts caused by contention, not product failures. When
they appear the failure count drifts, typically between 9 and 11. Each parity
test spawns real Git repositories and two full CLI processes, and the TTY tests
additionally emulate a terminal, so the suite is sensitive to whatever else the
machine is doing.

Because of this, **the failure count alone is not a signal.** Compare the set
of failing test names instead.

## Verifying that a change did not regress the suite

Run the suite on a clean checkout in a separate worktree and diff the failing
test names against your branch. This isolates your change from both the known
failures and the contention noise:

```sh
# Baseline, without touching your working tree
git worktree add -q --detach /tmp/baseline-parity HEAD
ln -s "$PWD/node_modules" /tmp/baseline-parity/node_modules
(cd /tmp/baseline-parity && npm run test:parity) > /tmp/parity-baseline.log 2>&1

# Your branch
npm run test:parity > /tmp/parity-mine.log 2>&1

# Compare the failing test names, not the counts
extract() { grep -E "^\s+× " "$1" | sed 's/^[[:space:]]*× //; s/ [0-9]*ms$//' | sort -u; }
diff <(extract /tmp/parity-baseline.log) <(extract /tmp/parity-mine.log)

git worktree remove /tmp/baseline-parity
```

An empty diff means the change is clean. Anything else is a real regression, or
a real fix.

## Getting to zero

Closing the gap is a fixture and normalizer problem, not a product problem. It
means either updating the expected help text to match the reference CLI's
current wording, or extending `replaceReferenceVocabulary` in
`tests/parity/parity-fixture.ts` to normalize the parts that describe features
this CLI deliberately does not implement.

Until then, keep this document's baseline in sync when the reference CLI is
upgraded.
