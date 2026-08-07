# maol-stack

Stackline is a clean-room Node.js CLI for stacked Git branches. Its
implementation and metadata are fully local, and stack submission talks
directly to Git and GitHub through the installed `git` and `gh` commands.

The scope covers creating and tracking branches, amending changes, moving and
squashing branches, restacking descendants, recovering from conflicts,
undoing mutations, navigation, and submitting stacks as GitHub pull requests.

## Run with npx

From this project:

```sh
npm install
npm run build
npx --yes . --version
```

From npm:

```sh
npx maol-stack --version
```

Stackline requires Node.js 22 or newer and an existing Git repository.

## Local workflow

```sh
npx maol-stack init --trunk main

# Make the first change, then create its branch and commit it.
npx maol-stack create feature-base --all --message "feature: base"

# Make a dependent change and stack it on the current branch.
npx maol-stack create feature-ui --all --message "feature: ui"

# Amend a parent and automatically restack descendants.
npx maol-stack checkout feature-base
npx maol-stack modify --all

# Restack explicitly after changing a parent outside Stackline.
npx maol-stack restack --upstack

# Push every branch and create or update its stacked GitHub PR.
npx maol-stack submit --stack
```

If an explicit restack conflicts, Stackline leaves Git's rebase paused:

```sh
# Resolve files, then either continue or restore all saved branch tips.
npx maol-stack continue --all
npx maol-stack abort --force
```

`modify`, `move`, and `squash` attempt descendant restacks automatically. In
non-interactive mode, an automatic conflict is aborted and reported as a
warning; run an explicit `restack --upstack` to resolve it.

## Commands

- `init`, `track`, `untrack`
- `create`, `modify`, `move`, `squash`
- `restack`, `continue`, `abort`, `undo`
- `submit`
- `log`, `state`
- `checkout`, `up`, `down`, `top`, `bottom`, `parent`, `children`, `trunk`
- `add`
- `mcp`

Use `npx maol-stack <command> --help` for options.

## Submit a stack

`submit --stack` walks from the bottom of the current stack through all of its
descendants. It pushes each branch before creating or updating a GitHub pull
request whose base is the logical parent branch:

```sh
npx maol-stack submit --stack
```

New pull requests use the branch's latest commit subject as their title. Useful
options include:

```sh
# Show the complete plan without changing the remote or GitHub.
npx maol-stack submit --stack --dry-run

# Create new pull requests as drafts.
npx maol-stack submit --stack --draft

# Submit through the current branch, without its descendants.
npx maol-stack submit
```

Stackline records the last successfully pushed SHA. The default push uses an
explicit `--force-with-lease` and refuses to overwrite a remote branch that
changed since the previous submission. `--force` is available as an explicit
override after reviewing the remote changes. An out-of-sync trunk does not
block submit by default; `--ignore-out-of-sync-trunk` emits an explicit
warning. The apply path uses the authenticated GitHub CLI (`gh`) directly.

## Restack safety and parity

Stackline stores the logical parent and previous parent revision for every
tracked branch in Git's common directory. A restack rebases each branch with
the equivalent of:

```sh
git rebase --onto <current-parent> <recorded-parent-revision> <branch>
```

Before a mutation it records branch refs, metadata, the active branch, and a
binary worktree patch. This supports `abort` and `undo`, including restoring a
change consumed by `modify` as an unstaged local modification.

The differential suite currently has 178 passing comparisons against a
reference stacked-branch CLI:

- clean and no-op descendant restacks;
- content, add/add, and modify/delete conflicts;
- automatic conflict rollback and explicit conflict pause;
- continue, forced abort, undo, and consecutive conflicts upstack;
- multi-commit children and empty branches;
- staged and unstaged working trees;
- branches checked out in another worktree;
- move, `move --only`, and squash;
- initialization, reset, tracking, force tracking, and forced untracking;
- navigation, directed navigation, checkout messages, and relationship output;
- command aliases and quiet output;
- successful commit/amend output and common non-interactive errors;
- multiple sibling stacks, nested forks, and serialized `state` output;
- all supported command help, top-level help, yargs parser errors, and streams;
- interactive checkout search, arrows, wraparound, fallback, cancellation,
  forks, scrolling, colors, and raw terminal control sequences;
- `submit --stack` selection, dry-run, publication, metadata, review,
  transport, trunk, restack, and error options.

It compares exit status, functional stdout/stderr, active/detached state,
rebase state, porcelain status, branch trees, commit counts, and the ancestry
matrix. Stateful `tip:` blocks are removed from the comparison because their
counters live in the reference CLI's global configuration. Run the suite only
on a machine with the configured reference executable available:

```sh
npm run test:parity
```

Remote publication is covered independently by the internal GitHub test suite.

## MCP server

Start the stdio MCP server with:

```sh
npx maol-stack mcp
```

It exposes:

- `run_stackline_cmd`, which runs a CLI command in a selected repository;
- `learn_stackline`, which returns the safe stacked-branch workflow.

### Install in Claude Code

Copy and paste this command in a terminal to make the MCP server available in
Claude Code from every repository:

```sh
claude mcp add --scope user maol-stack -- npx --yes maol-stack mcp
```

Confirm the installation with:

```sh
claude mcp get maol-stack
```

### Install in Codex

Copy and paste this command in a terminal to make the MCP server available in
Codex:

```sh
codex mcp add maol-stack -- npx --yes maol-stack mcp
```

Confirm the installation with:

```sh
codex mcp get maol-stack
```

## Development

```sh
npm run check
npm run test:coverage
npm run test:parity
npm pack --dry-run
```

The implementation is MIT licensed.
