# DevOps Stack: Parallel Isolation + Subset Runner — Design

**Date:** 2026-06-16
**Status:** Approved (design); implementation plan to follow
**Branch:** `chore/devops-parallel-isolation`

## Problem

This is the primary dev machine and the workflow is parallel-agent-heavy: several agents
run `just verify` concurrently from separate worktrees. Today that is made safe by a single
global flock semaphore (`/tmp/plnd-verify.lock`) in `scripts/verify.sh`, held for the entire
run lifecycle (including the cleanup trap's `docker compose down --volumes`).

The semaphore works well but has two costs:

1. **It fully serializes verify runs.** The heavy legs (build, nextest, e2e) cannot overlap
   across agents, so N agents take N× wall-clock for the port-bound work.
2. **Agents have no fast, isolated way to run a subset** of the pipeline (just the Rust
   checks, just unit tests, just e2e) while still being conflict-safe.

Separately, several "leftover" justfile commands touch shared resources *outside* the
semaphore and can corrupt a live run — most dangerously `just db`, `just stop`/`down`,
`just clean` (which run `docker compose down -v` and would wipe a running verify's
database), plus `just api`/`client`/`services-up`/`test-e2e*`/`test-run-server`/`seed`.

### Root cause

The semaphore exists **only because the stack publishes fixed host ports**. Five things bind
fixed ports: `db`→5432, `mock-oauth`→8080, `plnd_api`→3000, `ng serve`→4200, and Karma
(unit tests)→9876. Different worktrees get different Compose project names (distinct
container names) but the *host-port bindings are global*, so two runs collide and must
serialize through one machine-global lock.

## Goals

- Eliminate the flock semaphore: allow N agents to run full `just verify` concurrently with
  no cross-run conflicts.
- Provide fast, isolated `just verify <subset>` for agents (`quick`, `rust`, `ts`, `e2e`).
- Remove or guard every command that tempts an agent into a conflict.
- Keep a frictionless human dev loop: `just dev`/`api`/`client` always own ports 3000/4200.
- Tag each run's telemetry with a per-run id so concurrent runs are distinguishable in Grafana.

## Non-goals

- Re-architecting *what* the observability stack collects. We add per-run **labeling** (see
  "Per-run log tagging") and move its startup into `just persist`, but the OTLP→Tempo/Loki/
  Prometheus pipeline is otherwise unchanged.
- Full Dockerization of the API for e2e. The API stays a native binary; we isolate it via
  an ephemeral port, not a container.
- CI changes. This targets the local parallel-agent workflow. CI runs one job per runner and
  is unaffected by the local semaphore; the parameterization added here is backward-compatible
  (current ports remain the defaults).

## Architecture: two-tier resources

### Tier 1 — Shared, persistent, fixed-port infra

`db` (Postgres, 5432), `mock-oauth` (8080), and the **observability stack** (alloy 4317/4318,
prometheus 9090, loki 3100, tempo 3200, grafana 3001) are brought up **once per work session**
and stay up.

**Prerequisite — pin the Compose project name.** Today each worktree gets a distinct default
project name (derived from its directory), so a bare `docker compose up db` from worktree A and
worktree B would spin up *two separate* Postgres containers that re-collide on host port 5432.
For infra to be genuinely *shared* across all worktrees, `docker-compose.yml` gets a top-level
`name: plnd`, so every worktree's `docker compose` invocation targets the one shared project.
This also enables per-run DB management via `docker compose exec -T db psql` (container-local
trust auth — no host `psql` or password needed).

- **Postgres is one shared *server*.** Each run uses its own *database* on it (Tier 2), so
  the server is shared but the data is not.
- **mock-oauth is stateless and shared.** This is the key simplification: because the OIDC
  issuer lives at a constant `http://localhost:8080/plnd-dev`, the `iss` claim, the JWKS
  fetch, and the token exchange are identical for every run — **zero per-run OIDC plumbing**.
  This is what makes dropping the semaphore cheap; per-run OIDC ports would have required
  threading a dynamic issuer URL through config, tokens, and the mock server.
- **Observability is shared and always-on.** Verify does not *require* it (the API tolerates
  a missing OTLP collector — that's why verify works today without it), but keeping it up
  lets every run's logs/traces/metrics flow into Loki/Tempo/Prometheus, tagged per run (see
  "Per-run log tagging"). The cost is low and capturing all logs is desirable.

**Lifecycle command:** `just persist` brings up the full shared stack — `docker compose up -d
--wait` (all services), idempotent. The human runs it once before a session. (Agents never run
`persist`; their `verify` runs auto-ensure only the subset they need — see "Infra auto-ensure".)

### Tier 2 — Per-run ephemeral resources

Each `verify` invocation derives a short **run id** (e.g. from `mktemp -u` or the worktree
basename + PID) and provisions, for the duration of the run only:

| Resource | Mechanism | Threaded via |
|---|---|---|
| Application database | `CREATE DATABASE plnd_verify_<runid>` on shared Postgres; API auto-migrates it on boot | `APP_DATABASE__URL` |
| API port | ephemeral free port | `APP_API__BASE_URL=0.0.0.0:<apiPort>` |
| `ng serve` port | ephemeral free port | `--port <ngPort>` + Playwright `baseURL`/webServer |
| CORS origin | derived from ng port | `APP_AUTH__FRONTEND_ORIGIN=http://localhost:<ngPort>` |
| Karma port | ephemeral free port | `KARMA_PORT` (new `karma.conf.js`) |
| e2e API base | derived from API port | `API_BASE` (env, read by e2e helpers) |
| Telemetry tag | run id as OTel resource attr | `OTEL_RESOURCE_ATTRIBUTES=verify.run_id=<runid>` + `APP_OTEL__ENDPOINT` (see "Per-run log tagging") |

`nextest` needs only `DATABASE_URL` pointing at the shared Postgres server — `sqlx::test`
already creates its own isolated `_sqlx_test_*` databases per test, so parallel nextest legs
across runs never collide.

The run drops `plnd_verify_<runid>` and frees ports on exit (cleanup trap). It **never**
tears down Tier 1 infra.

#### Why migrations are free

`plnd_data/src/repository/mod.rs:83` runs `sqlx::migrate!("./migrations")` on startup. So the
per-run DB only needs to be *created empty* — pointing `APP_DATABASE__URL` at it and booting
the API migrates it automatically. No separate migration step in `verify.sh`.

### Reserved ports 3000 / 4200

`verify` always uses ephemeral ports, so 3000 (API) and 4200 (`ng serve`) are **reserved
exclusively** for `just dev`/`api`/`client`. A human dev stack and any number of agent
verifies coexist with zero contention.

### Result: no semaphore

With OIDC shared+fixed and everything else per-run unique, the only shared mutable resource
during verify is the Postgres *server*, which handles concurrent `CREATE DATABASE` and
isolated per-DB access natively. The flock (`fd 9`), the `LOCK_FILE`, and the `up`/`down -v`
bracket are removed from `verify.sh` entirely.

**Tuning note:** parallel runs multiply Postgres connections (each API uses a pool of
`max_connections = 10`, plus nextest). The default `postgres:15` limit is 100. With ~4–8
concurrent runs this is adequate; if exhaustion appears, raise the server's
`max_connections` in `docker-compose.yml` (e.g. `command: -c max_connections=300`). Flagged
for implementation, not pre-emptively changed.

## Ephemeral port allocation

A small helper (`scripts/free-port.sh` or inline) returns an OS-assigned free TCP port
(bind `:0`, read it back, release). Each per-run port is allocated this way immediately
before the consumer starts. A bind race is theoretically possible but negligible at this
concurrency; the API/ng startups already fail loudly on `AddrInUse`, and the run can retry
allocation. (The existing stale-`:3000` detection in `wait_for_api`, issue #780, becomes
moot once the port is per-run and ephemeral, but the "did the freshly-built binary actually
come up?" `kill -0 "$API_PID"` check is retained.)

## Per-run log tagging

So concurrent runs are distinguishable in Grafana, each run tags its telemetry with its run id.

**Run id format:** human-meaningful, not just random — `<worktree-or-branch-slug>-<short-rand>`
(e.g. `chore-devops-parallel-isolation-a1b2`). The same id names the per-run DB
(`plnd_verify_<runid>`) and the OTel `verify.run_id`, so logs, traces, and the database all
correlate, and you can find a specific agent's run by its branch in Grafana.

**Pipeline:**

1. **Export only when collecting is possible.** Verify probes Alloy (`localhost:4317`); if
   reachable (i.e. `just persist` brought observability up), it starts the per-run API with
   `APP_OTEL__ENDPOINT=http://localhost:4317`. If Alloy is down, the endpoint is left unset and
   the API runs stdout-only — verify still works on a minimal machine. (`config.otel.endpoint`
   is `Option<String>`; `None` = stdout-only.)
2. **Attach the tag.** The per-run API env carries
   `OTEL_RESOURCE_ATTRIBUTES=verify.run_id=<runid>,service.instance.id=<runid>`.
   `telemetry.rs` builds its `Resource` via `Resource::builder()`, whose default detectors read
   `OTEL_RESOURCE_ATTRIBUTES` — so this should attach with no code change. **Plan must verify
   against the installed `opentelemetry_sdk` version**; if the builder does not merge env
   attributes, add a 2-line change in `telemetry.rs` reading a `VERIFY_RUN_ID` env var and
   `.with_attribute(KeyValue::new("verify.run_id", id))`.
3. **Promote to a Loki label.** Alloy currently maps OTLP resource attributes to Loki
   *structured metadata*, not indexed labels (`otelcol.exporter.loki` default). Add a
   label-promotion hint in `config/observability/alloy/config.alloy` (a `loki.resource.labels`
   hint via an `otelcol.processor.transform`/attributes step) so `verify.run_id` becomes a
   queryable label. Resulting Grafana query: `{service_name="plnd_api", verify_run_id="<runid>"}`.

**Limitation:** only the native API's telemetry carries the tag. Shared container logs
(postgres, mock-oauth via `loki.source.docker`) are cross-run and cannot be per-run tagged —
acceptable, since the API logs are the signal of interest.

## `verify.sh` decomposition → subsets + parallelism from one refactor

`verify.sh` is restructured so each leg is independently runnable and declares the isolation
it needs. The same decomposition yields both the subset runner and lock-free parallelism.

Legs and their isolation needs:

| Leg | Needs | In subsets |
|---|---|---|
| `cargo fmt` | nothing | quick, rust |
| `cargo deny` | nothing | quick, rust |
| `cargo machete` | nothing | quick, rust |
| `tracing-skip` | nothing | quick, rust |
| `eslint` | nothing | quick, ts |
| `ts-deps` | nothing | quick, ts |
| `cargo build` | per-worktree `target/` | rust, e2e |
| `nextest → clippy` | shared Postgres (`DATABASE_URL`) | rust |
| `ng test` (unit) | ephemeral Karma port | ts |
| `e2e` | per-run DB + ephemeral API + ephemeral ng serve + shared mock-oauth | e2e |

### Subset interface

`just verify` (default = `all`) and `just verify <subset>`:

- **`quick`** — read-only, zero infra: fmt, deny, machete, tracing-skip, eslint, ts-deps.
  Fastest; needs neither DB nor ports. Always parallel-safe.
- **`rust`** — fmt, clippy, deny, machete, tracing-skip, cargo build, nextest. Needs the
  shared Postgres (per-run isolated test DBs).
- **`ts`** — eslint, ts-deps, ng test (unit). Needs an ephemeral Karma port.
- **`e2e`** — build + per-run DB + ephemeral API + ephemeral ng serve + Playwright. Heaviest.
- **`all`** — everything (current `just verify` behavior), lock-free.

Implementation shape: `just verify SUBSET="all"` forwards to `scripts/verify.sh <subset>`;
the script maps the subset name to the set of legs and runs them with its existing
parallel FIFO/job machinery, minus the flock.

### Infra auto-ensure

Any subset that needs Tier 1 infra runs an **idempotent** `docker compose up -d --wait db
mock-oauth-server` if it is not already healthy — and **never tears it down**. The original
danger was auto-*teardown* racing a queued run; auto-*startup* is safe and lets unattended
agents self-heal on a cold machine.

Verify auto-ensures only the **DB + OIDC** it strictly needs, not observability — so an agent
on a cold machine still runs. Observability is brought up by the human's `just persist`; when
it is up, per-run telemetry flows and is tagged (the Alloy probe in "Per-run log tagging"
gates export on its reachability). `just persist` is the explicit human command for the full
shared stack.

## Command cleanup (justfile)

| Command | Disposition | Rationale |
|---|---|---|
| `persist` | **NEW** | Bring up the full shared Tier 1 stack — `docker compose up -d --wait` (db + mock-oauth + observability), idempotent. Human session setup. |
| `db` | **REMOVE** | Bare `up -d db` outside any isolation; superseded by `persist`. |
| `services-up` | **REMOVE** | Duplicate of `persist`; folded in. |
| `stop` / `down` | **KEEP, guard** | Tears down Tier 1 (`down -v`). Human-only control. Add an interactive confirmation; agents run Just non-interactively, so the default-No prompt aborts them automatically. Document as human-only in CLAUDE.md. |
| `clean` | **KEEP, guard** | Also runs `down -v`; same interactive confirmation + human-only doc. |
| `dev` / `api` / `api-watch` / `client` | **KEEP** | The interactive lane. Now explicitly own ports 3000/4200; depend on `persist` infra (auto-ensure for convenience). |
| `test-e2e` / `test-e2e-native` / `test-e2e-dev` | **REMOVE** | Run e2e against fixed ports outside isolation. Replaced by `just verify e2e`. (`test-e2e-report` kept — read-only report viewer.) |
| `test-run-server` | **CHANGE** | Use an ephemeral port instead of 3000 so it never collides with `just dev`. |
| `seed` | **KEEP, document** | Mutates the dev DB; harmless to verify (which uses per-run DBs). Document as a dev-DB tool. |
| `check` | **KEEP** | Sequential quality gates, no ports; equivalent to `verify quick` minus parallelism. Optionally re-point at `verify quick`. |

No-confirmation guard detail: `stop`/`clean` print a one-line warning ("This wipes shared
infra used by ALL running verifies — human-only") and read `[y/N]`. Non-interactive callers
(agents) get EOF → abort. The user is responsible for safety; no programmatic active-run
detection is built (explicitly out of scope per design discussion).

## e2e parameterization (backward-compatible)

The e2e layer currently hardcodes endpoints. Each becomes env-driven with the current value
as the default, so manual runs and CI are unchanged:

- `plnd_client/e2e/helpers/auth.ts`: `API_BASE = process.env.API_BASE ?? 'http://localhost:3000'`.
  The mock-oauth URL stays `http://localhost:8080/plnd-dev` (shared, fixed).
- `plnd_client/playwright.config.ts`: `baseURL` and `webServer.url`/port read from an env var
  (e.g. `NG_PORT` / `PLAYWRIGHT_BASE_URL`), defaulting to `:4200`. `webServer.command`
  passes `--port <ngPort>`.
- `plnd_client/e2e/global-setup.ts`: `API_HEALTH_URL` derived from `API_BASE`.

## Affected files (for the implementation plan)

- `justfile` — remove `db`, `services-up`, `test-e2e`/`-native`/`-dev`; add `persist`;
  guard `stop`/`clean`; ephemeral-port `test-run-server`; `verify SUBSET` param.
- `scripts/verify.sh` — remove flock + `up`/`down -v` bracket; add run-id, per-run DB
  create/drop, ephemeral port allocation, env threading, subset dispatch, infra auto-ensure,
  Alloy probe + per-run OTel tagging (`APP_OTEL__ENDPOINT` + `OTEL_RESOURCE_ATTRIBUTES`).
- `scripts/free-port.sh` — NEW (or inline helper).
- `config/observability/alloy/config.alloy` — promote `verify.run_id` (resource attr) to a
  Loki label so runs are filterable in Grafana.
- `plnd_api/src/telemetry.rs` — only if `Resource::builder()` does not merge
  `OTEL_RESOURCE_ATTRIBUTES`; add a `verify.run_id` attribute from env.
- `docker-compose.yml` — add top-level `name: plnd` (shared project across worktrees);
  possibly raise Postgres `max_connections` (tuning, if needed).
- `plnd_client/e2e/helpers/auth.ts`, `playwright.config.ts`, `e2e/global-setup.ts` — env-driven endpoints.
- `plnd_client/karma.conf.js` — NEW, `port: process.env.KARMA_PORT || 9876`; wired into the
  `@angular/build:karma` builder via `angular.json` `karmaConfig`.
- `CLAUDE.md` — update the testing/semaphore guidance: document `just persist`, the subset
  runner, human-only `stop`/`clean`, and that the flock is gone.
- Memory: update `feedback_no_kill_port_3000` (semaphore removed) and add a note on the new
  model.

## Risks & mitigations

- **Postgres connection exhaustion** under high parallelism → raise `max_connections`.
- **Ephemeral port bind race** → allocate immediately before use; rely on loud `AddrInUse`
  + retry; concurrency is low.
- **Orphaned per-run DBs** if a run is `kill -9`'d before its trap → add a periodic/`persist`-time
  sweep dropping `plnd_verify_*` DBs older than N hours (cheap janitor; flagged for plan).
- **OTel env-attr merging unverified** — if the installed `opentelemetry_sdk` `Resource::builder()`
  does not read `OTEL_RESOURCE_ATTRIBUTES`, the tag silently won't attach → plan must verify and
  fall back to the explicit `telemetry.rs` change.
- **Loki label cardinality** — `verify.run_id` is high-cardinality (unbounded over time). It is a
  developer-facing local stack, so this is acceptable, but the plan should confirm Loki retention
  keeps the index bounded (the stack already wipes on `down -v`).
- **CLAUDE.md drift** — several rules reference the semaphore and `:3000`; must be updated in
  the same PR or they will mislead future agents.

## Migration / rollout

Single PR on `chore/devops-parallel-isolation`. After merge: agents stop relying on the
flock; the new `just persist` becomes the documented session-start step. Because all e2e
parameterization defaults to today's values, nothing breaks for anyone who keeps using fixed
ports manually.
