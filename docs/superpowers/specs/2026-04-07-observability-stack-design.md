# Observability Stack Design

**Date:** 2026-04-07
**Issue:** [calteran/plnd#181](https://github.com/calteran/plnd/issues/181)
**Status:** Approved

---

## Context

Issue #180 delivered full application-layer instrumentation: `tracing` facade across all crates, `TraceLayer` + `X-Request-ID` middleware, structured JSON logging, DB/provider spans, and frontend error capture via `POST /api/client_error`. The `tracing` crate acts as a pure facade — instrumented code never changes; the subscriber stack in `main.rs` is the only configuration point.

This issue adds the local dev observability backends (metrics, traces, logs) and wires the OTEL exporter into the subscriber stack. Once complete, `just dev` brings up the full observability triad alongside existing services.

---

## Goals

- Full metrics + traces + logs triad in the dev stack, started automatically by `just dev`
- Config-as-code: no manual Grafana setup; dashboards and datasources provisioned from files committed to the repo
- Single telemetry endpoint for the application: the app sends all signals to one address
- Cross-signal linking in Grafana: clicking a trace navigates to correlated logs and metrics
- Foundation for production observability: dev config shapes what production will look like

---

## Stack

| Service | Role | Host Port |
|---|---|---|
| Grafana Alloy | Unified telemetry agent | :4317 (gRPC), :4318 (HTTP), :12345 (UI) |
| Prometheus | Metrics store | :9090 |
| Loki | Log store | :3100 |
| Grafana Tempo | Trace store | :3200 |
| Grafana | Visualization | :3001 |

All five services join the existing `docker-compose.yml`. `just dev` is unchanged.

### Why Alloy

Grafana Alloy replaces both the OTel Collector and Promtail with a single container and a single River config file. It:
- Receives OTLP (gRPC + HTTP) from the native API process
- Tails Docker container logs (postgres, mock-oauth) and ships them to Loki
- Routes all three signals to their respective backends
- Is Grafana's actively maintained direction (Promtail is in maintenance mode)

The native API process runs outside Docker (launched by `mprocs`). Alloy solves the log collection problem cleanly: the API sends logs via the OTLP log bridge rather than relying on Docker log tailing.

### Out of scope

The LLM observability dashboard (token usage, model response time, error rates) requires `plnd_agent` tracing instrumentation first. That work is tracked in a dedicated sub-issue and will include the `plnd-llm.json` dashboard.

---

## Telemetry Data Flow

```
plnd_api (native, :3000)
  └─ OTLP gRPC → Alloy :4317
       ├─ traces  → batch → Tempo  :3200 (internal Docker)
       ├─ metrics → batch → Prometheus :9090 (remote_write)
       └─ logs    → batch → Loki   :3100

Docker container logs (postgres, mock-oauth)
  └─ Alloy discovery.docker + loki.source.docker → Loki :3100

plnd_client (Angular, :4200)
  └─ unhandled errors → POST /api/client_error
       └─ tracing::error! → OTLP log bridge → Loki

Grafana :3001
  ├─ queries Prometheus
  ├─ queries Loki
  └─ queries Tempo (with cross-signal linking provisioned via datasource config)
```

---

## Config-as-Code Layout

All observability config lives under `config/observability/`, separate from app config (`config/api/`) and infrastructure config (`config/mock-oauth/`).

```
config/
└── observability/
    ├── alloy/
    │   └── config.alloy                      # River pipeline — single source of truth for telemetry routing
    ├── prometheus/
    │   └── prometheus.yml                    # Scrape config + 7-day retention
    ├── loki/
    │   └── loki.yml                          # Storage + retention
    ├── tempo/
    │   └── tempo.yml                         # Storage + retention
    └── grafana/
        └── provisioning/
            ├── datasources/
            │   └── datasources.yml           # All three datasources + cross-signal link config
            └── dashboards/
                ├── dashboards.yml            # Provider config (disableDeletion, 30s hot-reload)
                ├── plnd-overview.json        # Request latency, error rates, RPS
                ├── plnd-traces.json          # Tempo trace explorer + exemplar links
                └── plnd-providers.json       # External provider call durations (USDA, weather, etc.)
```

Each config directory is mounted read-only into its container. Editing a file and restarting the service is the entire workflow — no GUI state lives inside containers.

---

## Rust API Changes

### `plnd_api/Cargo.toml`

```toml
opentelemetry                      = { version = "0.27", features = ["trace"] }
opentelemetry_sdk                  = { version = "0.27", features = ["rt-tokio", "trace", "logs", "metrics"] }
opentelemetry-otlp                 = { version = "0.27", features = ["grpc-tonic", "trace", "logs", "metrics"] }
opentelemetry-semantic-conventions = { version = "0.27", features = ["semconv_experimental"] }
opentelemetry-appender-tracing     = "0.27"
tracing-opentelemetry              = "0.28"
```

### Config (`plnd_api/src/config/settings.rs`)

```rust
pub struct OtelConfig {
    pub endpoint: Option<String>,
    // None  → stdout only (CI, unit tests, local dev without Docker stack)
    // Some  → OTLP gRPC to Alloy (e.g. "http://localhost:4317")
}
```

Controlled by `APP_OTEL__ENDPOINT`. Set in `config/api/development.toml`; absent from `production.toml` (to be configured per-environment).

### New: `plnd_api/src/telemetry.rs`

Owns all OTEL provider lifecycle. Public API:

```rust
pub fn init_providers(config: &OtelConfig) -> Option<TelemetryProviders>
pub fn shutdown_providers(providers: TelemetryProviders)
```

Returns `None` when `config.endpoint` is `None` — the no-op path requires zero changes to the rest of `main.rs`. Initializes TracerProvider, LoggerProvider, and MeterProvider, all exporting via OTLP gRPC. `shutdown_providers` flushes all providers before exit (prevents dropped spans on graceful shutdown).

### New: `plnd_api/src/middleware/metrics.rs`

Tower `Layer` inserted into the Axum middleware stack that records HTTP metrics using the OTEL metrics API:

- `http.server.request.duration` — histogram (milliseconds), attributed by HTTP method, matched route pattern, and status code
- `http.server.active_requests` — up-down counter (in-flight requests)

Uses `MatchedPath` (e.g. `/users/:id`) rather than raw path to avoid cardinality explosion in Prometheus.

### `plnd_api/src/main.rs` subscriber stack

```
tracing_subscriber::Registry
  └── EnvFilter                        (existing — log level from LoggingConfig)
  └── fmt layer (stdout JSON/pretty)   (existing — controlled by LoggingConfig.pretty_print)
  └── OpenTelemetryLayer               (new — bridges tracing spans → OTEL traces → OTLP)
  └── OpenTelemetryTracingBridge       (new — bridges tracing events → OTEL logs → OTLP)
```

The HTTP metrics layer is added to the Axum `.layer()` chain alongside the existing `TraceLayer`, `PropagateRequestIdLayer`, and `SetRequestIdLayer`.

---

## docker-compose.yml Additions

```yaml
alloy:
  image: grafana/alloy:latest
  ports:
    - "4317:4317"
    - "4318:4318"
    - "12345:12345"
  volumes:
    - ./config/observability/alloy/config.alloy:/etc/alloy/config.alloy:ro
    - /var/run/docker.sock:/var/run/docker.sock
  command: run /etc/alloy/config.alloy
  depends_on: [loki, tempo, prometheus]

prometheus:
  image: prom/prometheus:latest
  ports: ["9090:9090"]
  volumes:
    - ./config/observability/prometheus/prometheus.yml:/etc/prometheus/prometheus.yml:ro
    - prometheus_data:/prometheus
  command:
    - --config.file=/etc/prometheus/prometheus.yml
    - --storage.tsdb.retention.time=7d
    - --web.enable-remote-write-receiver    # required for Alloy remote_write

loki:
  image: grafana/loki:latest
  ports: ["3100:3100"]
  volumes:
    - ./config/observability/loki/loki.yml:/etc/loki/local-config.yaml:ro
    - loki_data:/loki

tempo:
  image: grafana/tempo:latest
  ports: ["3200:3200"]
  volumes:
    - ./config/observability/tempo/tempo.yml:/etc/tempo.yml:ro
    - tempo_data:/var/tempo
  command: -config.file=/etc/tempo.yml

grafana:
  image: grafana/grafana:latest
  ports: ["3001:3000"]
  volumes:
    - ./config/observability/grafana/provisioning:/etc/grafana/provisioning:ro
    - grafana_data:/var/lib/grafana
  environment:
    GF_AUTH_ANONYMOUS_ENABLED: "true"
    GF_AUTH_ANONYMOUS_ORG_ROLE: Admin
    GF_AUTH_DISABLE_LOGIN_FORM: "true"
  depends_on: [prometheus, loki, tempo]
```

New named volumes: `prometheus_data`, `loki_data`, `tempo_data`, `grafana_data`.

---

## Alloy River Config

```river
// Receive OTLP from native API process (traces + metrics + logs)
otelcol.receiver.otlp "api" {
  grpc { endpoint = "0.0.0.0:4317" }
  http { endpoint = "0.0.0.0:4318" }
  output {
    traces  = [otelcol.processor.batch.default.input]
    metrics = [otelcol.processor.batch.default.input]
    logs    = [otelcol.processor.batch.default.input]
  }
}

otelcol.processor.batch "default" {
  output {
    traces  = [otelcol.exporter.otlp.tempo.input]
    metrics = [otelcol.exporter.prometheus.default.input]
    logs    = [otelcol.exporter.loki.default.input]
  }
}

// Traces → Tempo
otelcol.exporter.otlp "tempo" {
  client {
    endpoint = "tempo:4317"
    tls { insecure = true }
  }
}

// Metrics → Prometheus via remote_write
otelcol.exporter.prometheus "default" {
  forward_to = [prometheus.remote_write.local.receiver]
}
prometheus.remote_write "local" {
  endpoint { url = "http://prometheus:9090/api/v1/write" }
}

// Logs (from API via OTLP) → Loki
otelcol.exporter.loki "default" {
  forward_to = [loki.write.local.receiver]
}
loki.write "local" {
  endpoint { url = "http://loki:3100/loki/api/v1/push" }
}

// Docker container logs (postgres, mock-oauth) → Loki
discovery.docker "containers" {
  host = "unix:///var/run/docker.sock"
}
loki.source.docker "containers" {
  host       = "unix:///var/run/docker.sock"
  targets    = discovery.docker.containers.targets
  forward_to = [loki.write.local.receiver]
}
```

---

## Grafana Provisioning

### Datasources (`datasources.yml`)

```yaml
apiVersion: 1
datasources:
  - name: Prometheus
    type: prometheus
    url: http://prometheus:9090
    isDefault: true

  - name: Loki
    type: loki
    url: http://loki:3100

  - name: Tempo
    type: tempo
    url: http://tempo:3200
    jsonData:
      tracesToLogsV2:
        datasourceUid: loki        # trace → correlated logs
      tracesToMetrics:
        datasourceUid: prometheus  # trace → correlated metrics
      lokiSearch:
        datasourceUid: loki
```

The `jsonData` block provisions cross-signal navigation without any manual Grafana UI config.

### Dashboards (`dashboards.yml`)

```yaml
apiVersion: 1
providers:
  - name: plnd
    type: file
    disableDeletion: true
    updateIntervalSeconds: 30
    options:
      path: /etc/grafana/provisioning/dashboards
```

Dashboard JSON files are bootstrapped by building them in the Grafana UI, then exporting via **Dashboard → Share → Export → Save to file**. Committed JSON is loaded automatically for all developers.

---

## Files Changed / Created

| File | Change |
|---|---|
| `docker-compose.yml` | Add 5 services + 4 named volumes |
| `plnd_api/Cargo.toml` | Add 6 OTEL crates |
| `plnd_api/src/config/settings.rs` | Add `OtelConfig { endpoint: Option<String> }` |
| `plnd_api/src/telemetry.rs` | **New** — provider init + shutdown |
| `plnd_api/src/middleware/metrics.rs` | **New** — HTTP metrics tower layer |
| `plnd_api/src/main.rs` | Wire OTEL layers into subscriber stack + metrics layer into Axum stack |
| `config/observability/alloy/config.alloy` | **New** |
| `config/observability/prometheus/prometheus.yml` | **New** |
| `config/observability/loki/loki.yml` | **New** |
| `config/observability/tempo/tempo.yml` | **New** |
| `config/observability/grafana/provisioning/datasources/datasources.yml` | **New** |
| `config/observability/grafana/provisioning/dashboards/dashboards.yml` | **New** |
| `config/observability/grafana/provisioning/dashboards/plnd-overview.json` | **New** |
| `config/observability/grafana/provisioning/dashboards/plnd-traces.json` | **New** |
| `config/observability/grafana/provisioning/dashboards/plnd-providers.json` | **New** |

---

## Verification

- `just dev` starts cleanly with all 7 services (2 existing + 5 new) healthy
- `curl http://localhost:3000/health` → span visible in Tempo via Grafana at http://localhost:3001
- Log line for the same request visible in Loki, correlated by `X-Request-ID`
- `http.server.request.duration` metric visible in Prometheus at http://localhost:9090
- Grafana overview dashboard shows latency + RPS without any manual datasource wiring
- Clicking a trace in Grafana offers working correlated log and metric links
- `just verify` passes cleanly
