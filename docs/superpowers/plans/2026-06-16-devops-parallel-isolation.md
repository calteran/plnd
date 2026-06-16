# DevOps Parallel Isolation + Subset Runner — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the global flock semaphore in `just verify` with per-run isolation (shared persistent DB/OIDC/observability + per-run application database and ephemeral API/ng/Karma ports), add a `just verify <subset>` runner, tag each run's telemetry, and remove/guard the conflict-prone commands.

**Architecture:** Infra (`db`, `mock-oauth`, observability) runs once per session in a pinned Compose project `plnd`. Each `verify` run creates an isolated `plnd_verify_<runid>` database on the shared Postgres and binds the API, `ng serve`, and Karma to ephemeral ports — so N runs across worktrees never contend, and no lock is needed. The same per-leg decomposition powers fast `quick`/`rust`/`ts`/`e2e` subsets.

**Tech Stack:** Bash, `just`, Docker Compose, Rust/Axum (`plnd_api`), Angular/Playwright/Karma (`plnd_client`), OpenTelemetry 0.32 → Grafana Alloy/Loki.

**Spec:** `docs/superpowers/specs/2026-06-16-devops-parallel-isolation-design.md`

**Working directory:** the worktree `.claude/worktrees/chore+devops-parallel-isolation` (branch `chore/devops-parallel-isolation`). All paths below are relative to its root unless absolute.

---

## File Structure

| File | Responsibility | Action |
|---|---|---|
| `docker-compose.yml` | Pin shared project `name: plnd` | Modify |
| `scripts/free-port.sh` | Print one OS-assigned free TCP port | Create |
| `plnd_client/karma.conf.js` | Karma config reading `KARMA_PORT` | Create |
| `plnd_client/angular.json` | Wire `karmaConfig` into the test target | Modify |
| `plnd_client/e2e/helpers/auth.ts` | `API_BASE` from env | Modify |
| `plnd_client/playwright.config.ts` | `baseURL`/`webServer` port from env | Modify |
| `plnd_client/e2e/global-setup.ts` | Health URL from env (standalone path) | Modify |
| `plnd_api/src/telemetry.rs` | Attach `verify.run_id` resource attr from `VERIFY_RUN_ID` | Modify |
| `config/observability/alloy/config.alloy` | Promote `verify.run_id` to a Loki label | Modify |
| `scripts/verify.sh` | Per-run isolation, subset dispatch, no flock | Rewrite |
| `justfile` | `persist`; remove `db`/`services-up`/`test-e2e*`; guard `stop`/`clean`; ephemeral `test-run-server`; `verify SUBSET` | Modify |
| `CLAUDE.md` | Document new model | Modify |
| memory `feedback_no_kill_port_3000.md` | Semaphore removed | Modify |

---

## Task 1: Pin the shared Compose project name

**Files:**
- Modify: `docker-compose.yml:1`

- [ ] **Step 1: Add the top-level `name`**

At the very top of `docker-compose.yml`, before `services:`, add:

```yaml
# Pin the Compose project name so EVERY worktree's `docker compose` targets the
# same shared infra (db, mock-oauth, observability). Without this, each worktree
# derives a distinct project name from its directory and would spin up its own
# Postgres that re-collides on host port 5432 — defeating shared infra.
name: plnd

services:
```

- [ ] **Step 2: Verify the project name is applied**

Run: `docker compose -f docker-compose.yml config | grep -m1 '^name:'`
Expected: `name: plnd`

- [ ] **Step 3: Commit**

```bash
git add docker-compose.yml
git commit -m "chore(devops): pin shared compose project name 'plnd'"
```

---

## Task 2: Free-port helper

**Files:**
- Create: `scripts/free-port.sh`

- [ ] **Step 1: Write the helper**

```bash
#!/usr/bin/env bash
# Print one OS-assigned free TCP port on 127.0.0.1, then release it.
# Uses node (always present — Angular toolchain). The brief release→reuse window
# is acceptable at this concurrency; consumers fail loudly on AddrInUse.
exec node -e 'const s=require("net").createServer();s.listen(0,"127.0.0.1",()=>{process.stdout.write(String(s.address().port));s.close()})'
```

- [ ] **Step 2: Make it executable**

Run: `chmod +x scripts/free-port.sh`

- [ ] **Step 3: Verify it prints a port**

Run: `bash scripts/free-port.sh; echo`
Expected: a number in the 1024–65535 range (e.g. `54321`), then newline.

- [ ] **Step 4: Verify successive calls differ (usually)**

Run: `echo "$(bash scripts/free-port.sh) $(bash scripts/free-port.sh)"`
Expected: two numbers (almost always distinct).

- [ ] **Step 5: Commit**

```bash
git add scripts/free-port.sh
git commit -m "chore(devops): add free-port helper for ephemeral port allocation"
```

---

## Task 3: Karma ephemeral port

**Files:**
- Create: `plnd_client/karma.conf.js`
- Modify: `plnd_client/angular.json` (test target options)

- [ ] **Step 1: Create `plnd_client/karma.conf.js`**

```js
// Minimal Karma config so parallel `ng test` runs don't collide on the default
// port (9876). scripts/verify.sh passes a per-run KARMA_PORT; everything else
// is left to the @angular/build:karma builder defaults.
module.exports = function (config) {
  config.set({
    port: process.env['KARMA_PORT'] ? Number(process.env['KARMA_PORT']) : 9876,
  });
};
```

- [ ] **Step 2: Wire it into the test target**

In `plnd_client/angular.json`, inside `projects.<project>.architect.test.options`, add the
`karmaConfig` key (alongside `polyfills`, `tsConfig`, …):

```json
"test": {
  "builder": "@angular/build:karma",
  "options": {
    "karmaConfig": "karma.conf.js",
    "polyfills": [
      "zone.js",
      "zone.js/testing"
    ],
    "tsConfig": "tsconfig.spec.json",
    "inlineStyleLanguage": "scss",
    "assets": [
      { "glob": "**/*", "input": "public" }
    ],
    "styles": [
      "src/styles.scss"
    ]
  }
}
```

- [ ] **Step 3: Verify default port still works**

Run: `cd plnd_client && npx ng test --browsers=ChromeHeadless --watch=false 2>&1 | tail -5`
Expected: tests execute and finish (SUCCESS). Confirms `karmaConfig` is valid.

- [ ] **Step 4: Verify the env override is honored**

Run: `cd plnd_client && KARMA_PORT=9999 npx ng test --browsers=ChromeHeadless --watch=false 2>&1 | grep -i 'Karma.*server.*9999\|:9999' | head`
Expected: a line showing Karma listening on `:9999` (proves `KARMA_PORT` is read).

- [ ] **Step 5: Commit**

```bash
git add plnd_client/karma.conf.js plnd_client/angular.json
git commit -m "test(client): make Karma port configurable via KARMA_PORT"
```

---

## Task 4: Parameterize e2e endpoints (backward-compatible)

**Files:**
- Modify: `plnd_client/e2e/helpers/auth.ts:4`
- Modify: `plnd_client/playwright.config.ts:26,34-45`
- Modify: `plnd_client/e2e/global-setup.ts:5`

- [ ] **Step 1: `auth.ts` — API_BASE from env**

Replace line 4:

```ts
export const API_BASE = 'http://localhost:3000';
```

with:

```ts
// Defaults to :3000 so manual runs and `just dev` are unchanged. scripts/verify.sh
// sets API_BASE to the run's ephemeral API port. Mock-oauth stays :8080 (shared).
export const API_BASE = process.env['API_BASE'] ?? 'http://localhost:3000';
```

(Leave `MOCK_OAUTH_TOKEN_URL` at `http://localhost:8080/...` — OIDC is shared/fixed.)

- [ ] **Step 2: `playwright.config.ts` — ng-serve port from env**

At the top of the file (after the import), add:

```ts
// `just verify` assigns an ephemeral ng-serve port per run; default :4200 for
// `just dev` / standalone runs.
const NG_PORT = process.env['NG_PORT'] ?? '4200';
const BASE_URL = `http://localhost:${NG_PORT}`;
```

Then replace `baseURL: 'http://localhost:4200',` with `baseURL: BASE_URL,`, and update the
`webServer` block:

```ts
  webServer: {
    command: `npx ng serve --configuration development --port ${NG_PORT}`,
    url: BASE_URL,
    reuseExistingServer: !process.env['CI'],
    timeout: 120_000,
    stdout: 'ignore',
    stderr: 'pipe',
  },
```

- [ ] **Step 3: `global-setup.ts` — health URL from env**

Replace line 5:

```ts
const API_HEALTH_URL = 'http://localhost:3000/health';
```

with:

```ts
const API_HEALTH_URL = `${process.env['API_BASE'] ?? 'http://localhost:3000'}/health`;
```

- [ ] **Step 4: Verify defaults unchanged (typecheck + lint)**

Run: `cd plnd_client && npx eslint "e2e/**/*.ts" playwright.config.ts`
Expected: no errors.

- [ ] **Step 5: Verify env override resolves (quick node check)**

Run: `cd plnd_client && API_BASE=http://localhost:55001 node -e "process.argv; const v=process.env.API_BASE??'http://localhost:3000'; console.log(v)"`
Expected: `http://localhost:55001`

- [ ] **Step 6: Commit**

```bash
git add plnd_client/e2e/helpers/auth.ts plnd_client/playwright.config.ts plnd_client/e2e/global-setup.ts
git commit -m "test(e2e): make API_BASE and ng-serve port env-configurable"
```

---

## Task 5: Tag telemetry with the run id

**Files:**
- Modify: `plnd_api/src/telemetry.rs`

The `Resource` is built in `init_providers`. Refactor the resource construction into a small,
testable helper that attaches `verify.run_id` when `VERIFY_RUN_ID` is set, then use it.

- [ ] **Step 1: Write the failing test**

Add to the `#[cfg(test)] mod tests` block in `plnd_api/src/telemetry.rs`:

```rust
    use opentelemetry::Key;

    #[test]
    fn resource_includes_run_id_when_env_set() {
        let res = build_resource(Some("branch-a1b2".to_string()));
        let got = res.get(&Key::from_static_str("verify.run_id"));
        assert_eq!(got.map(|v| v.to_string()), Some("branch-a1b2".to_string()));
    }

    #[test]
    fn resource_omits_run_id_when_env_absent() {
        let res = build_resource(None);
        assert!(res.get(&Key::from_static_str("verify.run_id")).is_none());
    }
```

- [ ] **Step 2: Run it to confirm it fails**

Run: `cargo nextest run -p plnd_api telemetry 2>&1 | tail -20`
Expected: FAIL — `cannot find function build_resource`.

- [ ] **Step 3: Implement `build_resource` and use it**

In `plnd_api/src/telemetry.rs`, add the helper above `init_providers`:

```rust
/// Build the OTEL resource. Attaches `verify.run_id` when a run id is provided
/// (scripts/verify.sh sets `VERIFY_RUN_ID` per run) so concurrent runs are
/// distinguishable in Loki/Tempo. `run_id` is read from the environment by the
/// caller so this stays unit-testable.
fn build_resource(run_id: Option<String>) -> Resource {
    let mut builder = Resource::builder().with_attribute(KeyValue::new(SERVICE_NAME, "plnd_api"));
    if let Some(id) = run_id {
        builder = builder.with_attribute(KeyValue::new("verify.run_id", id));
    }
    builder.build()
}
```

Then in `init_providers`, replace:

```rust
    let resource = Resource::builder()
        .with_attribute(KeyValue::new(SERVICE_NAME, "plnd_api"))
        .build();
```

with:

```rust
    let resource = build_resource(std::env::var("VERIFY_RUN_ID").ok());
```

- [ ] **Step 4: Run the tests to confirm they pass**

Run: `cargo nextest run -p plnd_api telemetry 2>&1 | tail -20`
Expected: PASS (both new tests + the existing `init_providers_with_none_returns_none`).

- [ ] **Step 5: Format + commit**

```bash
just fmt
git add plnd_api/src/telemetry.rs
git commit -m "feat(telemetry): tag OTEL resource with verify.run_id from env"
```

---

## Task 6: Promote `verify.run_id` to a Loki label in Alloy

**Files:**
- Modify: `config/observability/alloy/config.alloy`

By default `otelcol.exporter.loki` maps OTLP resource attributes to Loki *structured metadata*,
not indexed labels. Add a transform that sets the `loki.resource.labels` hint so `verify.run_id`
becomes a queryable label.

- [ ] **Step 1: Insert a transform processor before the Loki exporter**

In `config/observability/alloy/config.alloy`, change the logs branch of the batch processor to
route through a new transform, and add the transform block. Replace:

```alloy
otelcol.processor.batch "default" {
  output {
    traces  = [otelcol.exporter.otlp.tempo.input]
    metrics = [otelcol.exporter.prometheus.default.input]
    logs    = [otelcol.exporter.loki.default.input]
  }
}
```

with:

```alloy
otelcol.processor.batch "default" {
  output {
    traces  = [otelcol.exporter.otlp.tempo.input]
    metrics = [otelcol.exporter.prometheus.default.input]
    logs    = [otelcol.processor.transform.loki_labels.input]
  }
}

// Promote selected resource attributes to Loki labels (otherwise they land as
// structured metadata). `verify.run_id` lets us filter a single verify run in
// Grafana: {service_name="plnd_api", verify_run_id="<id>"}.
otelcol.processor.transform "loki_labels" {
  error_mode = "ignore"
  log_statements {
    context = "resource"
    statements = [
      `set(attributes["loki.resource.labels"], "service.name, verify.run_id")`,
    ]
  }
  output {
    logs = [otelcol.exporter.loki.default.input]
  }
}
```

- [ ] **Step 2: Validate the Alloy config syntax**

Run: `docker run --rm -v "$PWD/config/observability/alloy/config.alloy:/c.alloy:ro" grafana/alloy:latest fmt /c.alloy >/dev/null && echo OK`
Expected: `OK` (no parse error). If `fmt` is unavailable in the image, instead verify by
restarting the stack in Step 3 and checking Alloy logs for "config loaded".

- [ ] **Step 3: Commit**

```bash
git add config/observability/alloy/config.alloy
git commit -m "feat(observability): promote verify.run_id to a Loki label"
```

---

## Task 7: Rewrite `scripts/verify.sh` for per-run isolation + subsets

**Files:**
- Rewrite: `scripts/verify.sh`

This is the centerpiece. The new script: takes a `SUBSET` arg; derives a run id; auto-ensures
shared infra (db + mock-oauth only) when needed; for the e2e leg creates `plnd_verify_<runid>`
and binds the API/ng to ephemeral ports with full env threading + OTEL tagging; runs the
selected legs through the existing parallel FIFO machinery; drops the per-run DB on exit; and
holds **no flock** and tears down **no infra**.

- [ ] **Step 1: Replace the entire file with the new script**

```bash
#!/usr/bin/env bash
# scripts/verify.sh — Parallel, ISOLATED verification pipeline (no semaphore).
#
# Usage: verify.sh [SUBSET]      SUBSET ∈ {all,quick,rust,ts,e2e}  (default: all)
#
# Isolation model:
#   • Shared infra (db, mock-oauth) lives in the pinned Compose project `plnd`,
#     brought up once per session via `just persist` (this script auto-ensures it
#     if missing, but NEVER tears it down).
#   • Each run gets its own application DB `plnd_verify_<runid>` on the shared
#     Postgres and ephemeral ports for the API and ng serve — so concurrent runs
#     across worktrees never collide. No flock.
#   • Run id (branch slug + short random) names the per-run DB and the OTEL
#     verify.run_id tag, so logs/traces/DB correlate.

set -euo pipefail

SUBSET="${1:-all}"
case "$SUBSET" in all|quick|rust|ts|e2e) ;; *)
    echo "✗ Unknown subset '$SUBSET' (expected: all|quick|rust|ts|e2e)" >&2; exit 2 ;;
esac

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_ROOT="$(cd "$SCRIPT_DIR/.." && pwd)"

# Which legs does this subset need?
need() { case ",$1," in *",$SUBSET,"*) return 0;; esac; case "$SUBSET" in all) return 0;; esac; return 1; }
NEED_INFRA=false; NEED_E2E=false
need "rust,e2e" && NEED_INFRA=true        # nextest or e2e need the shared Postgres
need "e2e"      && { NEED_E2E=true; NEED_INFRA=true; }

RUN_ID=""; RUN_DB=""; RUN_DB_CREATED=false
API_PID=""; API_LOG=""; READER_PID=""; FIFO=""
declare -a JOB_PIDS=(); declare -a JOB_TMPFILES=()

# ── Cleanup ────────────────────────────────────────────────────────────────────
cleanup() {
    exec 3>&- 2>/dev/null || true   # close FIFO write-end → reader gets EOF
    for pid in "${JOB_PIDS[@]+"${JOB_PIDS[@]}"}"; do kill "$pid" 2>/dev/null || true; done
    [[ -n "${API_PID:-}" ]] && kill "$API_PID" 2>/dev/null || true
    [[ -n "${READER_PID:-}" ]] && wait "$READER_PID" 2>/dev/null || true
    for f in "${JOB_TMPFILES[@]+"${JOB_TMPFILES[@]}"}"; do rm -f "$f" 2>/dev/null || true; done
    # Drop ONLY this run's DB. Never touch shared infra.
    if [[ "$RUN_DB_CREATED" == true ]]; then
        (cd "$PROJECT_ROOT" && docker compose exec -T db \
            psql -U plnd -d postgres -c "DROP DATABASE IF EXISTS \"$RUN_DB\" WITH (FORCE);") \
            >/dev/null 2>&1 || true
    fi
    [[ -n "${FIFO:-}" ]] && rm -f "$FIFO" 2>/dev/null || true
    [[ -n "${API_LOG:-}" ]] && rm -f "$API_LOG" 2>/dev/null || true
}
trap cleanup EXIT INT TERM

# ── Prerequisite checks ─────────────────────────────────────────────────────────
for tool in timeout doppler node; do
    command -v "$tool" &>/dev/null || { echo "✗ '$tool' not found" >&2; exit 1; }
done
docker info &>/dev/null || { echo "✗ Docker is not running — start Docker Desktop" >&2; exit 1; }

# ── FIFO completion bus (real-time ✓/✗) ─────────────────────────────────────────
FIFO=$(mktemp -u /tmp/plnd-verify-bus-XXXXXX); mkfifo "$FIFO"
{
    while IFS='|' read -r status label tmpfile; do
        if [[ "$status" == "0" ]]; then echo "  ✓ $label"; else
            echo "  ✗ FAILED: $label"
            [[ -f "$tmpfile" && -s "$tmpfile" ]] && sed 's/^/    /' "$tmpfile"
        fi
        rm -f "$tmpfile" 2>/dev/null || true
    done
} < "$FIFO" &
READER_PID=$!
exec 3>"$FIFO"

run_job() {  # run_job label workdir cmd [args...]  — background, reports via FIFO
    local label="$1" workdir="$2"; shift 2
    local tmpfile; tmpfile=$(mktemp /tmp/plnd-verify-XXXXXX); JOB_TMPFILES+=("$tmpfile")
    (
        local status=0
        { (cd "$workdir" && "$@") 3>&-; } > "$tmpfile" 2>&1 || status=$?
        printf '%s|%s|%s\n' "$status" "$label" "$tmpfile" >&3
        exit $status
    ) &
    JOB_PIDS+=($!)
}

run_sync() {  # run_sync label workdir cmd [args...] — synchronous; exit on failure
    local label="$1" workdir="$2"; shift 2
    local tmpfile status=0; tmpfile=$(mktemp /tmp/plnd-verify-XXXXXX); JOB_TMPFILES+=("$tmpfile")
    { (cd "$workdir" && "$@") > "$tmpfile" 2>&1; } || status=$?
    printf '%s|%s|%s\n' "$status" "$label" "$tmpfile" >&3
    [[ $status -ne 0 ]] && exit 1 || true
}

wait_all() {
    local overall=0 pid
    for pid in "${JOB_PIDS[@]+"${JOB_PIDS[@]}"}"; do wait "$pid" 2>/dev/null || overall=1; done
    JOB_PIDS=(); return $overall
}

alloy_reachable() { (exec 3<>/dev/tcp/127.0.0.1/4317) 2>/dev/null && { exec 3>&-; return 0; } || return 1; }

echo "◆ Starting verification (subset: $SUBSET, run: ${RUN_ID:-pending})..."

# ── Auto-ensure shared infra (NEVER tear down) ──────────────────────────────────
if [[ "$NEED_INFRA" == true ]]; then
    (cd "$PROJECT_ROOT" && doppler run -- docker compose up -d --wait db mock-oauth-server)
fi

# ── Run id (now that we may need it) ────────────────────────────────────────────
BRANCH_SLUG="$(git -C "$PROJECT_ROOT" branch --show-current 2>/dev/null \
    | tr 'A-Z' 'a-z' | tr -cs 'a-z0-9' '-' | sed 's/^-//;s/-$//')"
RUN_ID="${BRANCH_SLUG:-detached}-$(LC_ALL=C tr -dc 'a-f0-9' </dev/urandom | head -c 4)"
RUN_DB="plnd_verify_$(printf '%s' "$RUN_ID" | tr -c 'a-z0-9' '_')"

# ── Rust read-only (no infra) ───────────────────────────────────────────────────
if need "quick,rust"; then
    run_job "cargo fmt"     "$PROJECT_ROOT" cargo fmt --check
    run_job "cargo deny"    "$PROJECT_ROOT" cargo deny check
    run_job "cargo machete" "$PROJECT_ROOT" cargo machete
    run_job "tracing-skip"  "$PROJECT_ROOT" just check-tracing-skip
fi

# ── TypeScript ──────────────────────────────────────────────────────────────────
if need "quick,ts,e2e"; then
    run_sync "npm ci" "$PROJECT_ROOT/plnd_client" npm ci
fi
if need "quick,ts"; then
    run_job "eslint"  "$PROJECT_ROOT/plnd_client" npx eslint "src/**/*.ts" "e2e/**/*.ts"
    run_job "ts-deps" "$PROJECT_ROOT/plnd_client" bash -c \
        "npm run check-dependencies && npm run check-licenses && npm run check-circular"
fi
if need "ts"; then
    KARMA_PORT="$("$SCRIPT_DIR/free-port.sh")"
    run_job "ng test" "$PROJECT_ROOT/plnd_client" \
        env KARMA_PORT="$KARMA_PORT" npx ng test --browsers=ChromeHeadless --watch=false --code-coverage
fi

# ── Cargo build (gates nextest/clippy/e2e) ──────────────────────────────────────
if need "rust,e2e"; then
    run_sync "cargo build" "$PROJECT_ROOT" cargo build --workspace
fi

# ── nextest → clippy (shared Postgres; sqlx::test isolates its own test DBs) ─────
if need "rust"; then
    run_job "nextest → clippy" "$PROJECT_ROOT" doppler run -- bash -c \
        'export DATABASE_URL="$APP_DATABASE__URL"; cargo nextest run --workspace && cargo clippy --workspace --all-targets --all-features -- -D warnings'
fi

# ── E2E (per-run DB + ephemeral API + ephemeral ng serve) ───────────────────────
if [[ "$NEED_E2E" == true ]]; then
    # Per-run application DB on the shared Postgres (container-local trust auth).
    (cd "$PROJECT_ROOT" && docker compose exec -T db \
        psql -U plnd -d postgres -c "CREATE DATABASE \"$RUN_DB\";") >/dev/null
    RUN_DB_CREATED=true

    APP_DB_BASE="$(doppler run -- bash -c 'printf %s "$APP_DATABASE__URL"')"; APP_DB_BASE="${APP_DB_BASE%/*}"
    RUN_DB_URL="$APP_DB_BASE/$RUN_DB"
    API_PORT="$("$SCRIPT_DIR/free-port.sh")"
    NG_PORT="$("$SCRIPT_DIR/free-port.sh")"

    # OTEL tagging only when Alloy (observability) is actually up.
    declare -a API_ENV=(
        APP_DATABASE__URL="$RUN_DB_URL"
        APP_API__BASE_URL="0.0.0.0:$API_PORT"
        APP_AUTH__FRONTEND_ORIGIN="http://localhost:$NG_PORT"
        APP_EXTERNAL__FIXTURE_PATH="$PROJECT_ROOT/plnd_data/fixtures"
        APP_USDA_CORPUS_PATH="$PROJECT_ROOT/plnd_data/corpus/usda_canonical.test.jsonl.gz"
    )
    if alloy_reachable; then
        API_ENV+=( APP_OTEL__ENDPOINT="http://127.0.0.1:4317" VERIFY_RUN_ID="$RUN_ID" )
        echo "  ◆ telemetry → Alloy (verify.run_id=$RUN_ID)"
    fi

    API_LOG=$(mktemp /tmp/plnd-verify-api-XXXXXX)
    ( cd "$PROJECT_ROOT/plnd_api" && \
      doppler run -- env "${API_ENV[@]}" ../target/debug/plnd_api > "$API_LOG" 2>&1 3>&- ) &
    API_PID=$!

    wait_for_api() {
        if ! timeout 30s bash -c \
            "until curl -sf http://localhost:$API_PORT/health > /dev/null 2>&1; do sleep 1; done"; then
            echo "API failed to become healthy within 30s on :$API_PORT. API log:"; cat "$API_LOG"; return 1
        fi
        if ! kill -0 "$API_PID" 2>/dev/null; then
            echo "plnd_api (PID $API_PID) exited before serving :$API_PORT. API log:"; cat "$API_LOG"; return 1
        fi
    }
    run_sync "api healthy" "$PROJECT_ROOT" wait_for_api

    run_sync "e2e tests" "$PROJECT_ROOT/plnd_client" \
        env API_BASE="http://localhost:$API_PORT" NG_PORT="$NG_PORT" \
        bash -c "PLAYWRIGHT_STRICT=true npm run e2e:ci"
fi

# ── Collect parallel results ────────────────────────────────────────────────────
wait_all
exec 3>&-
wait "$READER_PID"; READER_PID=""

echo "✅ All verifications passed (subset: $SUBSET, run: $RUN_ID)"
```

- [ ] **Step 2: Bring up infra for testing**

Run: `doppler run -- docker compose up -d --wait`
Expected: db, mock-oauth, and observability services report healthy/started.

- [ ] **Step 3: Verify the fastest subset (no infra, no DB)**

Run: `bash scripts/verify.sh quick`
Expected: `✓` for cargo fmt/deny/machete/tracing-skip/eslint/ts-deps, then `✅ All verifications passed (subset: quick ...)`. No API/DB lines.

- [ ] **Step 4: Verify the e2e subset creates and drops a per-run DB**

In one terminal run `bash scripts/verify.sh e2e`; while it runs, in another:
Run: `docker compose exec -T db psql -U plnd -d postgres -c "\l" | grep plnd_verify_`
Expected: one `plnd_verify_<slug>_<rand>` database present during the run.
After the run completes:
Run: `docker compose exec -T db psql -U plnd -d postgres -c "\l" | grep plnd_verify_ || echo "none (cleaned up)"`
Expected: `none (cleaned up)`.

- [ ] **Step 5: Verify the full default run**

Run: `bash scripts/verify.sh`
Expected: all legs `✓`, ends `✅ All verifications passed (subset: all ...)`.

- [ ] **Step 6: Commit**

```bash
git add scripts/verify.sh
git commit -m "feat(devops): per-run isolated, subset-aware verify; remove flock semaphore"
```

---

## Task 8: Justfile — `persist`, subset runner, guards, cleanup

**Files:**
- Modify: `justfile`

- [ ] **Step 1: Replace the `verify` recipe with a subset-aware one**

Replace:

```just
# Full verification — parallel pipeline (see scripts/verify.sh)
# Runs quality checks + build + unit tests + e2e. Use before every commit.
verify:
    @bash scripts/verify.sh
```

with:

```just
# Full verification — parallel, ISOLATED pipeline (see scripts/verify.sh).
# No semaphore: runs are isolated by per-run DB + ephemeral ports.
# SUBSET ∈ {all,quick,rust,ts,e2e}. Default `all`. Examples:
#   just verify           # everything
#   just verify quick     # read-only checks, no infra (fastest)
#   just verify e2e       # build + isolated API/ng + Playwright
verify SUBSET="all":
    @bash scripts/verify.sh {{ SUBSET }}
```

- [ ] **Step 2: Add `persist`; remove `db` and `services-up`**

Replace the `db` recipe:

```just
# Run database only in detached mode
db:
    docker compose up -d db
```

with:

```just
# Bring up the shared, persistent infra (db + mock-oauth + observability) for a
# work session. Idempotent. Run once before `just dev` / before agents verify.
# `just verify` auto-ensures db+oauth on its own, but observability only comes up
# here — so run this to capture per-run telemetry in Grafana.
persist:
    doppler run -- docker compose up -d --wait
```

And delete the `services-up` recipe entirely (lines for `services-up:` … `@echo "✅ Infrastructure ready"`).

- [ ] **Step 3: Guard `stop` and `clean` (human-only)**

Replace:

```just
# Stop all containers and remove volumes (next `just dev` starts with a clean DB)
stop:
    docker compose down -v

alias down := stop
```

with:

```just
# Stop ALL shared infra and remove volumes. HUMAN-ONLY: this wipes the database
# used by every running verify. The confirmation prompt aborts on EOF, so agents
# (non-interactive) can never trigger it. See docs/superpowers/specs/2026-06-16-*.
stop:
    #!/usr/bin/env bash
    set -euo pipefail
    read -rp "⚠️  Wipes shared infra + volumes used by ALL running verifies. Continue? [y/N] " ans || ans=""
    [[ "$ans" == [yY] ]] || { echo "Aborted."; exit 1; }
    docker compose down -v

alias down := stop
```

And replace the `clean` recipe:

```just
# Clean build artifacts
clean:
    cargo clean
    cd plnd_client && rm -rf node_modules dist
    docker compose down -v
```

with:

```just
# Clean build artifacts + shared infra. HUMAN-ONLY (same EOF-abort guard as stop).
clean:
    #!/usr/bin/env bash
    set -euo pipefail
    read -rp "⚠️  Removes node_modules/dist/target AND wipes shared infra. Continue? [y/N] " ans || ans=""
    [[ "$ans" == [yY] ]] || { echo "Aborted."; exit 1; }
    cargo clean
    cd plnd_client && rm -rf node_modules dist
    cd "$(git rev-parse --show-toplevel)" && docker compose down -v
```

- [ ] **Step 4: Make `test-run-server` use an ephemeral port**

Replace the `test-run-server` recipe body's `timeout 15s doppler run -- cargo run ...` so it
binds a free port instead of 3000:

```just
# Test server startup (15 second timeout - will auto-kill, ephemeral port)
test-run-server:
    #!/usr/bin/env bash
    set -euo pipefail
    PORT=$(bash scripts/free-port.sh)
    echo "🚀 Testing server startup on :$PORT (15s timeout - will auto-kill)..."
    cd plnd_api
    timeout 15s doppler run -- env APP_API__BASE_URL="0.0.0.0:$PORT" cargo run || exit_code=$?
    exit_code=${exit_code:-0}
    if [ "$exit_code" -eq 124 ]; then
        echo "✅ Server started successfully (auto-killed after 15s)"
    else
        echo "❌ Server failed to start (exit code: $exit_code)"
        exit 1
    fi
```

- [ ] **Step 5: Remove the ad-hoc e2e recipes**

Delete `test-e2e`, `test-e2e-native`, and `test-e2e-dev` (superseded by `just verify e2e`).
Keep `test-e2e-report` (read-only report viewer).

- [ ] **Step 6: Verify Just parses and the subset arg forwards**

Run: `just --list | grep -E 'verify|persist|stop|clean' && just --dry-run verify quick`
Expected: `persist` and `verify SUBSET="all"` appear; no `db`/`services-up`/`test-e2e`; dry-run shows `bash scripts/verify.sh quick`.

- [ ] **Step 7: Verify the stop guard aborts non-interactively**

Run: `echo "" | just stop`
Expected: prints the warning then `Aborted.` and exits non-zero; containers stay up
(`docker compose ps` still lists running services).

- [ ] **Step 8: Commit**

```bash
git add justfile
git commit -m "chore(devops): add persist + subset verify; guard stop/clean; remove conflict-prone recipes"
```

---

## Task 9: Update CLAUDE.md and memory

**Files:**
- Modify: `CLAUDE.md` (Testing + Server Processes sections)
- Modify: `/Users/robert/.claude/projects/-Users-robert-Development-plnd/memory/feedback_no_kill_port_3000.md` and `MEMORY.md`

- [ ] **Step 1: Update the Testing bullets in CLAUDE.md**

In the `### Testing` section, replace the semaphore-era guidance. Add/adjust bullets to read:

```markdown
- **`just verify` is now isolated, not serialized** — there is no flock semaphore. Each run
  uses a per-run database (`plnd_verify_<runid>`) on the shared Postgres and ephemeral ports
  for the API/ng/Karma, so N agents can `just verify` in parallel across worktrees with no
  conflict. Killing a PID on :3000 is irrelevant to verify (it never uses :3000).
- **Run shared infra once per session with `just persist`** (db + mock-oauth + observability).
  `just verify` auto-ensures db+oauth if missing but never tears infra down; observability
  comes up only via `just persist`.
- **Subsets:** `just verify {quick,rust,ts,e2e}` for fast, still-isolated checks. `quick`
  needs no infra; `rust`/`e2e` use the shared Postgres; `e2e` adds an isolated API + ng serve.
- **`just stop` / `just clean` are HUMAN-ONLY** — they wipe shared infra used by every running
  verify. Agents must never invoke them (the interactive prompt aborts non-interactive callers).
```

- [ ] **Step 2: Update the Server Processes section**

Note that `just test-run-server` now binds an ephemeral port (not 3000), so it no longer
conflicts with `just dev`.

- [ ] **Step 3: Update memory**

Rewrite `feedback_no_kill_port_3000.md` body to: the flock semaphore was removed (this PR);
verify is isolated via per-run DB + ephemeral ports; nothing to deconflict on :3000; `just stop`
is human-only. Update its `MEMORY.md` one-liner accordingly.

- [ ] **Step 4: Commit**

```bash
git add CLAUDE.md
git commit -m "docs: document isolated verify model, persist, subsets, human-only stop"
# memory files are outside the repo; they are saved via the Write tool, not committed here
```

---

## Task 10: Full parallel verification (acceptance)

**Files:** none (validation only)

- [ ] **Step 1: Fresh session bring-up**

Run: `just persist`
Expected: all services healthy; `docker compose ls` shows project `plnd`.

- [ ] **Step 2: Two concurrent full runs from two worktrees**

From this worktree and a second worktree, run `just verify e2e` simultaneously.
Expected: BOTH pass. No `AddrInUse`, no `database "..." already exists`, no port errors.
During the runs, `docker compose exec -T db psql -U plnd -d postgres -c "\l" | grep plnd_verify_`
shows TWO distinct per-run DBs; both are gone afterward.

- [ ] **Step 3: Telemetry is tagged and filterable**

In Grafana (`http://localhost:3001`), Explore → Loki, query
`{service_name="plnd_api", verify_run_id=~".+"}`.
Expected: log lines labeled with distinct `verify_run_id` values for each run.

- [ ] **Step 4: Confirm no flock / no infra teardown remain**

Run: `grep -nE 'flock|down --volumes|down -v|plnd-verify.lock' scripts/verify.sh || echo "clean"`
Expected: `clean`.

- [ ] **Step 5: Run the canonical pre-commit gate once more**

Run: `just fmt && just verify`
Expected: `✅ All verifications passed (subset: all ...)`.

---

## Self-Review Notes

- **Spec coverage:** project-name pin (Task 1), free-port (2), Karma (3), e2e params (4),
  run-id tag (5), Alloy label (6), isolated subset verify + no flock (7), persist/guards/
  command removals (8), docs/memory (9), parallel acceptance (10). All spec sections mapped.
- **Type/name consistency:** `RUN_ID`/`RUN_DB`/`VERIFY_RUN_ID`/`API_BASE`/`NG_PORT`/`KARMA_PORT`/
  `APP_API__BASE_URL`/`APP_DATABASE__URL`/`APP_AUTH__FRONTEND_ORIGIN`/`APP_OTEL__ENDPOINT`/
  `build_resource` used identically across tasks.
- **Known follow-ups (tracked, not in this plan):** orphaned-DB janitor (`kill -9` skips the
  trap) and Postgres `max_connections` tuning under heavy fan-out — open GitHub issues per the
  "never leave a known issue untracked" rule before closing out.
```
