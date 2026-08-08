# Differential parity suite

`npm run test:parity` compares this CLI against a reference stacked-branch CLI
by running both against identical Git repositories and diffing everything
observable: exit status, functional stdout/stderr, active/detached state,
rebase state, porcelain status, branch trees, commit counts, and the ancestry
matrix.

The suite is expected to report **no failures**. Eight comparisons that the
reference CLI has drifted away from are skipped rather than left red, so that a
red run means something actually broke. The sections below list what is skipped
and why.

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
Test Files  30 passed | 1 skipped (31)
     Tests  173 passed | 10 skipped (183)
```

### What is skipped, and why

Each of the four entries below was confirmed to fail deterministically when run
in isolation with no parallelism, so none of them is contention noise. Every
skip repeats its reason as a comment in the test file. The two remaining skips
predate this list and live in `submit-noop-apply-parity.test.ts`.

| Test                                                                            | Cause                                                                                                                                                          |
| ------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `alias-parity` — help through the `s`, `tr`, `utr` aliases                      | The reference CLI rewrote these command descriptions to document features this CLI deliberately does not implement, so the help text can no longer match.      |
| `submit-errors-parity` — repository without a GitHub remote                     | The two CLIs word the repository-identity error differently. The test already carries a `normalizeRepositoryIdentityError` helper for part of this divergence. |
| `modify-options-parity` — modifying a downstack branch with `--into`            | Output divergence on the `--into` path.                                                                                                                        |
| `tty-abort-parity` — confirming, declining, and cancelling an interactive abort | Divergence in interactive prompt rendering.                                                                                                                    |

The help-text drift is the clearest of these. The reference CLI now describes
`submit` in terms of its own interactive metadata prompts and config menu,
while ours describes the narrower behavior this CLI actually implements.
Closing that diff means deciding how much of the reference wording to adopt,
not fixing a bug — which is why it is skipped rather than chased.

Two `tty-mutation-parity` comparisons around child selection are deliberately
**not** skipped. They fail only under parallel load and pass in isolation, so
they are kept and handled as flakiness instead.

## Flakiness

Every comparison spawns real Git repositories and two full CLI processes, and
the TTY comparisons additionally emulate a terminal. One vitest worker per core
oversubscribes the machine badly enough to produce two distinct symptoms:

1. TTY repaints interleave differently between the two CLIs, so a comparison
   that passes in isolation reports a spurious diff.
2. The main thread starves and times out its own reporter RPC, which vitest
   reports as an unhandled error:

```
Error: [vitest-worker]: Timeout calling "onTaskUpdate"
```

The second one is worth knowing about because it is counted separately from
test results: the suite can report zero failing tests and still exit non-zero.

`vitest.parity.config.ts` addresses both by capping `maxWorkers` and setting
`retry: 2`. Retrying is what separates the two cases — contention noise passes
on a later attempt, a genuine divergence fails every attempt.

If unhandled errors reappear on a busier machine, lower `maxWorkers` further
before assuming the product broke.

## Verifying that a change did not regress the suite

A red run should now be enough on its own. If you need to be certain a failure
predates your change — after upgrading the reference CLI, say — run the suite on
a clean checkout in a separate worktree and diff the failing test names:

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

## Un-skipping

The skips are a fixture and normalizer problem, not a product problem. Closing
them means either updating the expected help text to match the reference CLI's
current wording, or extending `replaceReferenceVocabulary` in
`tests/parity/parity-fixture.ts` to normalize the parts that describe features
this CLI deliberately does not implement.

Re-check them whenever the reference CLI is upgraded, and keep this document's
baseline in sync: drift can close as easily as it opens, and a skip that would
now pass is coverage left on the floor.
