# Design: verify.sh Output Capture via Named-FIFO Completion Bus

**Date:** 2026-04-04
**Status:** Approved

## Problem

`scripts/verify.sh` launches many parallel jobs whose stdout/stderr interleaves in the terminal,
producing unreadable output. This is fatiguing for humans and wastes tokens for agent runs.

## Goal

- Silence all job output when passing — show only a `✓ label` tick per job
- On failure — dump the full captured log under a `✗ label` line
- Ticks appear in real-time as each job completes (not batched at the end)

## Architecture

A **named FIFO** (`mkfifo`) serves as a single-channel completion bus. Each job writes one
status record when it finishes. A **reader process** reads records and prints results live.

### FIFO Protocol

Each job writes exactly one newline-terminated record to fd 3 (the FIFO write-end):

```
EXIT_CODE|LABEL|/tmp/plnd-verify-XXXXXX.log
```

The reader loops on `IFS='|' read -r status label tmpfile`, prints the result, deletes the
tmpfile, and exits when all write-ends are closed (natural EOF).

### New Helpers

**`run_job label workdir cmd...`** — background/parallel:
- Creates a `mktemp` log file
- Forks subshell: closes lock fd 9, captures cmd output to log, writes FIFO record, exits with cmd status
- Appends PID to `JOB_PIDS`

**`run_sync label workdir cmd...`** — synchronous/blocking:
- Same capture + FIFO write pattern as `run_job`
- On failure: calls `exit 1` to trigger the EXIT cleanup trap

**`wait_all`** — simplified to just collect exit codes:
- `wait` on all `JOB_PIDS`, return overall status
- No printing (reader has already handled it)

### Cleanup Trap

Gains two steps:
1. `exec 3>&-` — closes main write-end of FIFO
2. `wait "$READER_PID"` — drains queued messages so failure output isn't swallowed

### Success Output

```
◆ Starting verification...
  ✓ cargo fmt
  ✓ cargo deny
  ✓ cargo machete
  ✓ npm ci
  ✓ ng test
  ✓ eslint
  ✓ ts-deps
  ✓ cargo build
  ✓ nextest → clippy
  ✓ services healthy
  ✓ api healthy
  ✓ e2e tests
✅ All verifications passed
```

### Failure Output

```
  ✗ FAILED: cargo deny
    error[...]: crate foo is denied
    ...
```

## Reliability Decisions

- `set -euo pipefail` preserved; `run_sync` uses `{ cmd; } || status=$?` to capture exit codes
- Flock fd 9 released in all `run_job` subshells via `exec 9>&-` (unchanged from original)
- API crash detection: `wait_for_api` helper dumps the API log if the 30s health timeout fires
- FIFO labels must not contain `|` — all current labels are safe
- Reader deletes each tmpfile as it processes it; cleanup trap removes the FIFO itself
- No tmpfile leaks on abort: cleanup trap fires on EXIT, INT, TERM
