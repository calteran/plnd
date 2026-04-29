# Historical Implementation Plans

The files in this directory are **point-in-time artifacts**, not authoritative.

Each plan was written to scope and execute a specific feature at a specific moment. Plans pair with the design specs in `../specs/` and capture how a feature was actually built — slice-by-slice rollout, file changes, test matrix, and verification steps. They are valuable as historical record, **not** as a guide to how the current system works.

When a plan and the current implementation disagree, the implementation is the source of truth.

When a plan and `docs/architecture.md` disagree, `docs/architecture.md` wins.

## Why these files are kept

- They show the actual rollout sequence that produced the current state.
- They preserve test expectations and verification steps from the time work happened.
- They are bisectable like any other git-tracked content.

## Why they are not authoritative

- They reflect a moment, not a steady-state design.
- Code paths, tool inventories, and route surfaces have changed since these plans merged.
- They describe how to *reach* a state — not how the system *currently is*.

## Where to look instead

| For… | Look at… |
|------|----------|
| The current design | [`docs/architecture.md`](../../architecture.md) |
| What changed in a specific area | `git log` on the relevant code |
| Active migration work | `docs/migration-deltas.md` (when present) |
| Operational commands | [`CLAUDE.md`](../../../CLAUDE.md) |
