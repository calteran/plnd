# Historical Design Specs

The files in this directory are **point-in-time artifacts**, not authoritative.

Each spec was written to scope a specific feature at a specific moment. They are valuable as historical context — *why* a thing was built the way it was, what alternatives were considered, what the threat model looked like at the time. They are **not** the current source of truth about how PLND is designed.

When a spec and the current implementation disagree, the implementation is the source of truth — *or* there is a known drift that's tracked elsewhere.

When a spec and `docs/architecture.md` disagree, `docs/architecture.md` wins.

## Why these files are kept

- They capture decisions that aren't visible from the diff alone (rejected alternatives, threat-model reasoning, rollout sequencing).
- They serve as a paper trail for why a feature was built this way.
- They are bisectable like any other git-tracked content.

## Why they are not authoritative

- They are dated. Each spec reflects what was true and intended at that date.
- The codebase has moved on. Schemas, prompt files, tool inventories, and route surfaces have changed since these specs were merged.
- The system has evolved as a whole; per-feature specs cannot capture cross-feature implications visible only in retrospect.

## Where to look instead

| For… | Look at… |
|------|----------|
| The current design | [`docs/architecture.md`](../../architecture.md) |
| What changed in a specific area | `git log` on the relevant code |
| Active migration work | `docs/migration-deltas.md` (when present) |
| Operational commands | [`CLAUDE.md`](../../../CLAUDE.md) |
