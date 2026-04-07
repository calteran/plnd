# Observability Stack Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add Prometheus + Loki + Tempo + Grafana + Grafana Alloy to the dev stack so that `just dev` brings up the full metrics/traces/logs triad with dashboards and cross-signal linking provisioned as code.

**Architecture:** Grafana Alloy is the single telemetry gateway — the native API sends all three signals (traces, metrics, logs) via OTLP gRPC to Alloy on `:4317`. Alloy fans out to Tempo (traces), Prometheus (metrics via remote_write), and Loki (logs). Grafana datasources and dashboards are provisioned from files committed to `config/observability/grafana/provisioning/`. No manual Grafana setup is required.

**Tech Stack:** Grafana Alloy, Prometheus, Grafana Loki, Grafana Tempo, Grafana OSS; `opentelemetry` + `opentelemetry_sdk` + `opentelemetry-otlp` + `tracing-opentelemetry` + `opentelemetry-appender-tracing` (Rust crates)

**Spec:** `docs/superpowers/specs/2026-04-07-observability-stack-design.md`
**Tracking issue:** calteran/plnd#181

---

## File Map

| File | Action | Responsibility |
|---|---|---|
| `plnd_api/Cargo.toml` | Modify | Add 6 OTEL crates |
| `plnd_api/src/config/settings.rs` | Modify | Add `OtelConfig` struct + field on `AppConfig` |
| `config/api/development.toml` | Modify | Set default OTEL endpoint for dev |
| `plnd_api/src/telemetry.rs` | Create | OTEL provider init + shutdown (binary-only module) |
| `plnd_api/src/middleware/mod.rs` | Create | Exports `metrics` submodule |
| `plnd_api/src/middleware/metrics.rs` | Create | HTTP metrics tower `Layer` |
| `plnd_api/src/lib.rs` | Modify | Export `middleware` module |
| `plnd_api/src/main.rs` | Modify | Layered subscriber, OTEL wiring, metrics layer in Axum stack |
| `config/observability/alloy/config.alloy` | Create | River pipeline config |
| `config/observability/prometheus/prometheus.yml` | Create | Scrape config + remote-write receiver |
| `config/observability/loki/loki.yml` | Create | Loki filesystem backend config |
| `config/observability/tempo/tempo.yml` | Create | Tempo storage + metrics generator |
| `config/observability/grafana/provisioning/datasources/datasources.yml` | Create | All three datasources + cross-signal links |
| `config/observability/grafana/provisioning/dashboards/dashboards.yml` | Create | Dashboard provider config |
| `config/observability/grafana/provisioning/dashboards/plnd-overview.json` | Create | Request latency, error rates, RPS dashboard |
| `config/observability/grafana/provisioning/dashboards/plnd-traces.json` | Create | Tempo trace explorer dashboard |
| `config/observability/grafana/provisioning/dashboards/plnd-providers.json` | Create | External provider call durations dashboard |
| `docker-compose.yml` | Modify | Add 5 observability services + 4 named volumes |
| `docs/superpowers/specs/2026-04-07-observability-stack-design.md` | Commit | Already written; commit on feature branch |

---

## Task 1: Pre-work — sub-issue + worktree

**Files:** none

- [ ] **Step 1: Confirm sub-issues are open**

  This work is tracked across four sub-issues (opened separately):
  - Track A: Rust API instrumentation
  - Track B: Infrastructure config files
  - Track C: docker-compose, smoke test, and dashboards
  - Track D: `plnd_agent` LLM tracing + dashboard (depends on #181 merged)

  Verify the sub-issues exist before starting. Their issue numbers appear in the main tracking issue body on GitHub.

- [ ] **Step 2: Create worktree + branch**

  ```bash
  just worktree-new
  # When prompted, name the branch: feature/observability-stack
  ```

  All subsequent work happens in the new worktree directory. The worktree command installs Angular deps automatically.

- [ ] **Step 3: Commit spec doc**

  ```bash
  git add docs/superpowers/specs/2026-04-07-observability-stack-design.md
  git commit -m "docs: add observability stack design spec (closes discussion on #181)"
  ```

---

## Task 2: Cargo.toml — add OTEL crates

**Files:**
- Modify: `plnd_api/Cargo.toml`

Add these before writing any code that imports them (Tasks 3–5 depend on them).

- [ ] **Step 1: Add dependencies to `[dependencies]`**

  Add after the `governor` line:

  ```toml
  opentelemetry            = { version = "0.27", features = ["trace"] }
  opentelemetry_sdk        = { version = "0.27", features = ["rt-tokio", "trace", "logs", "metrics"] }
  opentelemetry-otlp       = { version = "0.27", features = ["grpc-tonic", "trace", "logs", "metrics"] }
  opentelemetry-semantic-conventions = { version = "0.27", features = ["semconv_experimental"] }
  opentelemetry-appender-tracing = "0.27"
  tracing-opentelemetry    = "0.28"
  ```

- [ ] **Step 2: Verify compilation**

  ```bash
  just verify-build
  ```

  Expected: resolves and compiles. Cargo will download ~15 new transitive deps (tonic, prost, h2, etc.) — this is expected.

- [ ] **Step 3: Commit**

  ```bash
  git add plnd_api/Cargo.toml Cargo.lock
  git commit -m "feat(api): add opentelemetry crates for OTLP export"
  ```

---

## Task 3: OtelConfig in settings.rs

**Files:**
- Modify: `plnd_api/src/config/settings.rs`
- Modify: `config/api/development.toml`


- [ ] **Step 1: Add `OtelConfig` struct to settings.rs**

  Add after the `AgentConfig` block (before `AppConfig`):

  ```rust
  #[derive(Debug, Deserialize, Clone, Default)]
  pub struct OtelConfig {
      /// OTLP gRPC endpoint for traces, metrics, and logs.
      /// `None` disables OTEL export (stdout-only mode — useful for CI and unit tests).
      pub endpoint: Option<String>,
  }
  ```

- [ ] **Step 2: Add `otel` field to `AppConfig`**

  In `AppConfig`, after the `agent` field:

  ```rust
  pub struct AppConfig {
      pub api: ApiConfig,
      pub database: DatabaseConfig,
      #[serde(default)]
      pub logging: LoggingConfig,
      #[serde(default)]
      pub auth: AuthConfig,
      #[serde(default)]
      pub external_providers: ExternalProvidersConfig,
      #[serde(default)]
      pub llm: plnd_agent::LlmConfig,
      #[serde(default)]
      pub agent: AgentConfig,
      #[serde(default)]
      pub otel: OtelConfig,    // ← add this line
  }
  ```

- [ ] **Step 3: Set default OTEL endpoint in development.toml**

  Append to `config/api/development.toml`:

  ```toml
  [otel]
  endpoint = "http://localhost:4317"
  ```

- [ ] **Step 4: Verify compilation**

  ```bash
  just verify-build
  ```

  Expected: compiles cleanly, no warnings about `otel`.

- [ ] **Step 5: Commit**

  ```bash
  git add plnd_api/src/config/settings.rs config/api/development.toml
  git commit -m "feat(api): add OtelConfig to AppConfig (endpoint: Option<String>)"
  ```

---

## Task 3: telemetry.rs — OTEL provider lifecycle

**Files:**
- Create: `plnd_api/src/telemetry.rs`

This module is declared in `main.rs` (`mod telemetry;`), not `lib.rs`. It owns provider initialization and graceful-shutdown flushing.

- [ ] **Step 1: Write the failing test first**

  Create `plnd_api/src/telemetry.rs` with just the test:

  ```rust
  pub struct TelemetryProviders {
      pub tracer_provider: opentelemetry_sdk::trace::TracerProvider,
      pub logger_provider: opentelemetry_sdk::logs::LoggerProvider,
      pub meter_provider: opentelemetry_sdk::metrics::MeterProvider,
  }

  pub fn init_providers(
      _endpoint: Option<&str>,
  ) -> Result<Option<TelemetryProviders>, Box<dyn std::error::Error + Send + Sync>> {
      todo!()
  }

  pub fn shutdown_providers(_providers: TelemetryProviders) {
      todo!()
  }

  #[cfg(test)]
  mod tests {
      use super::*;

      #[test]
      fn init_providers_with_none_returns_none() {
          let result = init_providers(None);
          assert!(result.unwrap().is_none());
      }
  }
  ```

- [ ] **Step 2: Run the test — verify it fails**

  ```bash
  cargo nextest run --package plnd_api telemetry -- --nocapture
  ```

  Expected: FAIL (panics on `todo!()`)

- [ ] **Step 3: Implement `telemetry.rs`**

  Replace the file contents with the full implementation:

  ```rust
  use opentelemetry_otlp::WithExportConfig;
  use opentelemetry_sdk::{
      logs::LoggerProvider,
      metrics::{MeterProvider, PeriodicReader},
      runtime,
      trace::TracerProvider,
  };

  pub struct TelemetryProviders {
      pub tracer_provider: TracerProvider,
      pub logger_provider: LoggerProvider,
      pub meter_provider: MeterProvider,
  }

  /// Initialize OTEL providers.
  ///
  /// Returns `Ok(None)` when `endpoint` is `None` (stdout-only mode).
  /// Returns `Ok(Some(providers))` when `endpoint` is `Some(url)`.
  /// Returns `Err` if the OTLP exporter cannot be built (malformed endpoint URL, etc.).
  pub fn init_providers(
      endpoint: Option<&str>,
  ) -> Result<Option<TelemetryProviders>, Box<dyn std::error::Error + Send + Sync>> {
      let endpoint = match endpoint {
          None => return Ok(None),
          Some(e) => e.to_owned(),
      };

      // ── Traces ──────────────────────────────────────────────────────────────
      let trace_exporter = opentelemetry_otlp::SpanExporter::builder()
          .with_tonic()
          .with_endpoint(&endpoint)
          .build()?;
      let tracer_provider = TracerProvider::builder()
          .with_batch_exporter(trace_exporter, runtime::Tokio)
          .build();

      // ── Logs ────────────────────────────────────────────────────────────────
      let log_exporter = opentelemetry_otlp::LogExporter::builder()
          .with_tonic()
          .with_endpoint(&endpoint)
          .build()?;
      let logger_provider = LoggerProvider::builder()
          .with_batch_exporter(log_exporter, runtime::Tokio)
          .build();

      // ── Metrics ─────────────────────────────────────────────────────────────
      let metric_exporter = opentelemetry_otlp::MetricExporter::builder()
          .with_tonic()
          .with_endpoint(&endpoint)
          .build()?;
      let meter_provider = MeterProvider::builder()
          .with_reader(
              PeriodicReader::builder(metric_exporter, runtime::Tokio).build(),
          )
          .build();

      // Register as global providers so middleware can reach them via global::meter()
      opentelemetry::global::set_tracer_provider(tracer_provider.clone());
      opentelemetry::global::set_meter_provider(meter_provider.clone());

      Ok(Some(TelemetryProviders {
          tracer_provider,
          logger_provider,
          meter_provider,
      }))
  }

  /// Flush all OTEL providers before process exit.
  /// Call this after `axum::serve().await` returns to prevent dropped spans.
  pub fn shutdown_providers(providers: TelemetryProviders) {
      let _ = providers.tracer_provider.shutdown();
      let _ = providers.logger_provider.shutdown();
      let _ = providers.meter_provider.shutdown();
  }

  #[cfg(test)]
  mod tests {
      use super::*;

      #[test]
      fn init_providers_with_none_returns_none() {
          let result = init_providers(None);
          assert!(result.unwrap().is_none());
      }
  }
  ```

- [ ] **Step 4: Run the test — verify it passes**

  ```bash
  cargo nextest run --package plnd_api telemetry -- --nocapture
  ```

  Expected: PASS

- [ ] **Step 5: Verify build**

  Add `mod telemetry;` at the top of `plnd_api/src/main.rs` (just after the existing `use` block) so the compiler finds and checks `telemetry.rs`. Leave it there permanently — Task 6 will add the remaining OTEL imports around it.

  ```bash
  just verify-build
  ```

  If the OTLP builder API differs in the installed version, the compiler will point to the exact method name. Adjust accordingly and consult [docs.rs/opentelemetry-otlp](https://docs.rs/opentelemetry-otlp).

- [ ] **Step 6: Commit**

  ```bash
  git add plnd_api/src/telemetry.rs plnd_api/Cargo.toml
  git commit -m "feat(api): add telemetry.rs for OTEL provider init and shutdown"
  ```

---

## Task 5: HTTP metrics middleware

**Files:**
- Create: `plnd_api/src/middleware/mod.rs`
- Create: `plnd_api/src/middleware/metrics.rs`
- Modify: `plnd_api/src/lib.rs`

- [ ] **Step 1: Write the failing test**

  Create `plnd_api/src/middleware/metrics.rs`:

  ```rust
  #[cfg(test)]
  mod tests {
      use axum::{body::Body, http::{Request, StatusCode}, routing::get, Router};
      use tower::ServiceExt;
      use super::HttpMetricsLayer;

      #[tokio::test]
      async fn metrics_layer_passes_request_through() {
          let app = Router::new()
              .route("/health", get(|| async { "OK" }))
              .layer(HttpMetricsLayer);

          let response = app
              .oneshot(Request::builder().uri("/health").body(Body::empty()).unwrap())
              .await
              .unwrap();

          assert_eq!(response.status(), StatusCode::OK);
      }
  }
  ```

  Create `plnd_api/src/middleware/mod.rs`:

  ```rust
  pub mod metrics;
  ```

  Add to `plnd_api/src/lib.rs` (after `pub mod state;`):

  ```rust
  pub mod middleware;
  ```

- [ ] **Step 2: Run test — verify it fails**

  ```bash
  cargo nextest run --package plnd_api middleware -- --nocapture
  ```

  Expected: compile error — `HttpMetricsLayer` not defined yet.

- [ ] **Step 3: Implement `metrics.rs`**

  Replace the file with the full implementation:

  ```rust
  //! Tower layer that records HTTP server metrics via the OpenTelemetry metrics API.
  //!
  //! Metrics emitted:
  //! - `http.server.request.duration` (histogram, ms) — by method, route, status code
  //! - `http.server.active_requests` (up-down counter) — in-flight requests
  //!
  //! **Route cardinality note:** This layer sits outside the Axum router. `MatchedPath`
  //! (e.g. `/users/:id`) is not available at this level, so the raw URI path is used.
  //! For routes with path parameters this means one metric series per unique ID.
  //! Acceptable for dev; move the layer inside the router if production cardinality matters.

  use opentelemetry::{
      global,
      metrics::{Histogram, UpDownCounter},
      KeyValue,
  };
  use std::{
      future::Future,
      pin::Pin,
      task::{Context, Poll},
      time::Instant,
  };
  use tower::{Layer, Service};

  /// Tower layer that attaches HTTP metrics recording to every request.
  #[derive(Clone)]
  pub struct HttpMetricsLayer;

  impl<S> Layer<S> for HttpMetricsLayer {
      type Service = HttpMetricsService<S>;

      fn layer(&self, inner: S) -> Self::Service {
          let meter = global::meter("plnd_api");
          HttpMetricsService {
              inner,
              request_duration: meter
                  .f64_histogram("http.server.request.duration")
                  .with_unit("ms")
                  .with_description("HTTP server request duration in milliseconds")
                  .build(),
              active_requests: meter
                  .i64_up_down_counter("http.server.active_requests")
                  .with_description("Number of HTTP requests currently being processed")
                  .build(),
          }
      }
  }

  #[derive(Clone)]
  pub struct HttpMetricsService<S> {
      inner: S,
      request_duration: Histogram<f64>,
      active_requests: UpDownCounter<i64>,
  }

  impl<S, B> Service<axum::http::Request<B>> for HttpMetricsService<S>
  where
      S: Service<axum::http::Request<B>, Response = axum::http::Response<axum::body::Body>>
          + Clone
          + Send
          + 'static,
      S::Future: Send + 'static,
      B: Send + 'static,
  {
      type Response = S::Response;
      type Error = S::Error;
      type Future = Pin<Box<dyn Future<Output = Result<Self::Response, Self::Error>> + Send>>;

      fn poll_ready(&mut self, cx: &mut Context<'_>) -> Poll<Result<(), Self::Error>> {
          self.inner.poll_ready(cx)
      }

      fn call(&mut self, req: axum::http::Request<B>) -> Self::Future {
          let method = req.method().as_str().to_owned();
          let route = req.uri().path().to_owned();
          let start = Instant::now();
          let duration = self.request_duration.clone();
          let active = self.active_requests.clone();

          active.add(
              1,
              &[
                  KeyValue::new("http.request.method", method.clone()),
                  KeyValue::new("http.route", route.clone()),
              ],
          );

          let mut inner = self.inner.clone();
          Box::pin(async move {
              let result = inner.call(req).await;
              let elapsed_ms = start.elapsed().as_millis() as f64;

              let status_code = result
                  .as_ref()
                  .ok()
                  .map(|r| r.status().as_u16() as i64)
                  .unwrap_or(0);

              duration.record(
                  elapsed_ms,
                  &[
                      KeyValue::new("http.request.method", method.clone()),
                      KeyValue::new("http.route", route.clone()),
                      KeyValue::new("http.response.status_code", status_code),
                  ],
              );
              active.add(
                  -1,
                  &[
                      KeyValue::new("http.request.method", method),
                      KeyValue::new("http.route", route),
                  ],
              );

              result
          })
      }
  }

  #[cfg(test)]
  mod tests {
      use super::*;
      use axum::{body::Body, http::{Request, StatusCode}, routing::get, Router};
      use tower::ServiceExt;

      #[tokio::test]
      async fn metrics_layer_passes_request_through() {
          let app = Router::new()
              .route("/health", get(|| async { "OK" }))
              .layer(HttpMetricsLayer);

          let response = app
              .oneshot(Request::builder().uri("/health").body(Body::empty()).unwrap())
              .await
              .unwrap();

          assert_eq!(response.status(), StatusCode::OK);
      }
  }
  ```

- [ ] **Step 4: Run test — verify it passes**

  ```bash
  cargo nextest run --package plnd_api middleware -- --nocapture
  ```

  Expected: PASS

- [ ] **Step 5: Verify full build**

  ```bash
  just verify-build
  ```

- [ ] **Step 6: Commit**

  ```bash
  git add plnd_api/src/middleware/ plnd_api/src/lib.rs
  git commit -m "feat(api): add HttpMetricsLayer tower middleware for OTEL HTTP metrics"
  ```

---

## Task 6: Wire main.rs — layered subscriber + OTEL + metrics

**Files:**
- Modify: `plnd_api/src/main.rs`

The subscriber initialization block (lines 50–63) is replaced with a layered registry. The OTEL providers are initialized before the subscriber so the tracer is available when the subscriber is built. The metrics layer is added to the Axum middleware stack. `shutdown_providers` is called after `axum::serve()` returns.

- [ ] **Step 1: Add imports at the top of `main.rs`**

  Add after the existing `use` statements:

  ```rust
  mod telemetry;

  use opentelemetry_appender_tracing::layer::OpenTelemetryTracingBridge;
  use tracing_subscriber::{layer::SubscriberExt, util::SubscriberInitExt};
  use plnd_api::middleware::metrics::HttpMetricsLayer;
  ```

- [ ] **Step 2: Initialize OTEL providers before the subscriber**

  Replace the config-load block through the end of the subscriber init (lines 40–63) with:

  ```rust
  let config = match config::load_config() {
      Ok(config) => config,
      Err(e) => {
          eprintln!("Failed to load configuration: {}", e);
          std::process::exit(1);
      }
  };

  // Initialize OTEL providers before the subscriber (tracer needed for subscriber layer).
  let otel_providers = match telemetry::init_providers(config.otel.endpoint.as_deref()) {
      Ok(p) => p,
      Err(e) => {
          eprintln!("Failed to initialize OTEL providers: {e}");
          std::process::exit(1);
      }
  };

  // Build layered tracing subscriber.
  // Option<Layer> is a no-op layer when None, so all four arms compile to the same Registry type.
  let env_filter = tracing_subscriber::EnvFilter::new(&config.logging.level);

  match (config.logging.pretty_print, otel_providers.as_ref()) {
      (true, Some(p)) => tracing_subscriber::registry()
          .with(env_filter)
          .with(tracing_subscriber::fmt::layer().pretty().with_target(true))
          .with(tracing_opentelemetry::layer().with_tracer(p.tracer_provider.tracer("plnd_api")))
          .with(OpenTelemetryTracingBridge::new(&p.logger_provider))
          .init(),
      (false, Some(p)) => tracing_subscriber::registry()
          .with(env_filter)
          .with(tracing_subscriber::fmt::layer().json().with_target(true))
          .with(tracing_opentelemetry::layer().with_tracer(p.tracer_provider.tracer("plnd_api")))
          .with(OpenTelemetryTracingBridge::new(&p.logger_provider))
          .init(),
      (true, None) => tracing_subscriber::fmt()
          .with_env_filter(env_filter)
          .with_target(true)
          .pretty()
          .init(),
      (false, None) => tracing_subscriber::fmt()
          .with_env_filter(env_filter)
          .with_target(true)
          .json()
          .init(),
  }

  tracing::info!(
      api_base_url = %config.api.base_url,
      log_level = %config.logging.level,
      otel_enabled = config.otel.endpoint.is_some(),
      "configuration loaded"
  );
  ```

- [ ] **Step 3: Add `HttpMetricsLayer` to the Axum middleware stack**

  In the `let app = public.merge(protected)...` block, add `HttpMetricsLayer` inside the existing chain:

  ```rust
  let app = public
      .merge(protected)
      .merge(SwaggerUi::new("/swagger-ui").url("/api-docs/openapi.json", ApiDoc::openapi()))
      .merge(Scalar::with_url("/scalar", ApiDoc::openapi()))
      .with_state(state)
      .layer(TraceLayer::new_for_http())
      .layer(PropagateRequestIdLayer::new(x_request_id.clone()))
      .layer(SetRequestIdLayer::new(x_request_id, MakeRequestUuid))
      .layer(HttpMetricsLayer)    // ← add this line
      .layer(cors);
  ```

- [ ] **Step 4: Add OTEL shutdown after `axum::serve()`**

  Replace the final `axum::serve(...).await.unwrap();` with:

  ```rust
  axum::serve(
      listener,
      app.into_make_service_with_connect_info::<SocketAddr>(),
  )
  .await
  .unwrap();

  // Flush all OTEL providers before exit to prevent dropped spans/logs/metrics.
  if let Some(providers) = otel_providers {
      telemetry::shutdown_providers(providers);
  }
  ```

- [ ] **Step 5: Verify compilation and tests**

  ```bash
  just verify-build
  cargo nextest run --workspace
  ```

  Expected: compiles cleanly; all tests pass.

- [ ] **Step 6: Commit**

  ```bash
  git add plnd_api/src/main.rs
  git commit -m "feat(api): wire OTEL subscriber layers and HttpMetricsLayer into Axum app"
  ```

---

## Task 7: Infrastructure config files

**Files:**
- Create: `config/observability/alloy/config.alloy`
- Create: `config/observability/prometheus/prometheus.yml`
- Create: `config/observability/loki/loki.yml`
- Create: `config/observability/tempo/tempo.yml`
- Create: `config/observability/grafana/provisioning/datasources/datasources.yml`
- Create: `config/observability/grafana/provisioning/dashboards/dashboards.yml`

- [ ] **Step 1: Create directory skeleton**

  ```bash
  mkdir -p config/observability/alloy \
            config/observability/prometheus \
            config/observability/loki \
            config/observability/tempo \
            config/observability/grafana/provisioning/datasources \
            config/observability/grafana/provisioning/dashboards
  ```

- [ ] **Step 2: Write `config/observability/alloy/config.alloy`**

  ```river
  // ── Receive OTLP from native API (traces + metrics + logs) ──────────────────
  otelcol.receiver.otlp "api" {
    grpc { endpoint = "0.0.0.0:4317" }
    http { endpoint = "0.0.0.0:4318" }
    output {
      traces  = [otelcol.processor.batch.default.input]
      metrics = [otelcol.processor.batch.default.input]
      logs    = [otelcol.processor.batch.default.input]
    }
  }

  // ── Batch to reduce network chatter ─────────────────────────────────────────
  otelcol.processor.batch "default" {
    output {
      traces  = [otelcol.exporter.otlp.tempo.input]
      metrics = [otelcol.exporter.prometheus.default.input]
      logs    = [otelcol.exporter.loki.default.input]
    }
  }

  // ── Traces → Tempo ───────────────────────────────────────────────────────────
  otelcol.exporter.otlp "tempo" {
    client {
      endpoint = "tempo:4317"
      tls { insecure = true }
    }
  }

  // ── Metrics → Prometheus via remote_write ───────────────────────────────────
  otelcol.exporter.prometheus "default" {
    forward_to = [prometheus.remote_write.local.receiver]
  }

  prometheus.remote_write "local" {
    endpoint { url = "http://prometheus:9090/api/v1/write" }
  }

  // ── Logs (OTLP from API) → Loki ─────────────────────────────────────────────
  otelcol.exporter.loki "default" {
    forward_to = [loki.write.local.receiver]
  }

  loki.write "local" {
    endpoint { url = "http://loki:3100/loki/api/v1/push" }
  }

  // ── Docker container logs (postgres, mock-oauth) → Loki ─────────────────────
  discovery.docker "containers" {
    host = "unix:///var/run/docker.sock"
  }

  loki.source.docker "containers" {
    host       = "unix:///var/run/docker.sock"
    targets    = discovery.docker.containers.targets
    forward_to = [loki.write.local.receiver]
  }
  ```

- [ ] **Step 3: Write `config/observability/prometheus/prometheus.yml`**

  ```yaml
  global:
    scrape_interval: 15s
    evaluation_interval: 15s

  scrape_configs:
    - job_name: 'alloy'
      static_configs:
        - targets: ['alloy:12345']
  ```

  Note: the `--web.enable-remote-write-receiver` flag is set in `docker-compose.yml` (Task 8), not in this file.

- [ ] **Step 4: Write `config/observability/loki/loki.yml`**

  ```yaml
  auth_enabled: false

  server:
    http_listen_port: 3100
    grpc_listen_port: 9096

  common:
    instance_addr: 127.0.0.1
    path_prefix: /loki
    storage:
      filesystem:
        chunks_directory: /loki/chunks
        rules_directory: /loki/rules
    replication_factor: 1
    ring:
      kvstore:
        store: inmemory

  schema_config:
    configs:
      - from: 2020-10-24
        store: tsdb
        object_store: filesystem
        schema: v13
        index:
          prefix: index_
          period: 24h

  limits_config:
    allow_structured_metadata: true
  ```

- [ ] **Step 5: Write `config/observability/tempo/tempo.yml`**

  ```yaml
  server:
    http_listen_port: 3200

  distributor:
    receivers:
      otlp:
        protocols:
          grpc:
            endpoint: 0.0.0.0:4317
          http:
            endpoint: 0.0.0.0:4318

  ingester:
    max_block_duration: 5m

  compactor:
    compaction:
      block_retention: 48h

  metrics_generator:
    registry:
      external_labels:
        source: tempo
    storage:
      path: /var/tempo/generator/wal
      remote_write:
        - url: http://prometheus:9090/api/v1/write
          send_exemplars: true
    processor:
      service_graphs:
        dimensions: ['http.route']
      span_metrics:
        dimensions: ['http.route', 'http.request.method', 'http.response.status_code']

  storage:
    trace:
      backend: local
      wal:
        path: /var/tempo/wal
      local:
        path: /var/tempo/blocks

  overrides:
    defaults:
      metrics_generator:
        processors: [service-graphs, span-metrics]
  ```

  The `metrics_generator` block lets Tempo derive RED metrics (rate, error, duration) from spans and write them to Prometheus. This gives the provider call duration dashboard data from `plnd_data` spans without extra instrumentation.

- [ ] **Step 6: Write `config/observability/grafana/provisioning/datasources/datasources.yml`**

  ```yaml
  apiVersion: 1
  datasources:
    - name: Prometheus
      type: prometheus
      uid: prometheus
      url: http://prometheus:9090
      isDefault: true
      editable: false

    - name: Loki
      type: loki
      uid: loki
      url: http://loki:3100
      editable: false

    - name: Tempo
      type: tempo
      uid: tempo
      url: http://tempo:3200
      editable: false
      jsonData:
        tracesToLogsV2:
          datasourceUid: loki
          filterByTraceID: true
          filterBySpanID: false
        tracesToMetrics:
          datasourceUid: prometheus
          tags:
            - key: http.route
              value: route
        serviceMap:
          datasourceUid: prometheus
        lokiSearch:
          datasourceUid: loki
        nodeGraph:
          enabled: true
  ```

- [ ] **Step 7: Write `config/observability/grafana/provisioning/dashboards/dashboards.yml`**

  ```yaml
  apiVersion: 1
  providers:
    - name: plnd
      type: file
      disableDeletion: true
      updateIntervalSeconds: 30
      allowUiUpdates: true
      options:
        path: /etc/grafana/provisioning/dashboards
        foldersFromFilesStructure: false
  ```

- [ ] **Step 8: Commit all config files**

  ```bash
  git add config/observability/
  git commit -m "feat(observability): add Alloy, Prometheus, Loki, Tempo, and Grafana config files"
  ```

---

## Task 8: docker-compose additions

**Files:**
- Modify: `docker-compose.yml`

- [ ] **Step 1: Add 5 observability services**

  Add after the `mock-oauth-server` service block (before `volumes:`):

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
      depends_on:
        loki:
          condition: service_started
        tempo:
          condition: service_started
        prometheus:
          condition: service_started

    prometheus:
      image: prom/prometheus:latest
      ports:
        - "9090:9090"
      volumes:
        - ./config/observability/prometheus/prometheus.yml:/etc/prometheus/prometheus.yml:ro
        - prometheus_data:/prometheus
      command:
        - --config.file=/etc/prometheus/prometheus.yml
        - --storage.tsdb.retention.time=7d
        - --web.enable-remote-write-receiver

    loki:
      image: grafana/loki:latest
      ports:
        - "3100:3100"
      volumes:
        - ./config/observability/loki/loki.yml:/etc/loki/local-config.yaml:ro
        - loki_data:/loki

    tempo:
      image: grafana/tempo:latest
      ports:
        - "3200:3200"
      volumes:
        - ./config/observability/tempo/tempo.yml:/etc/tempo.yml:ro
        - tempo_data:/var/tempo
      command: -config.file=/etc/tempo.yml

    grafana:
      image: grafana/grafana:latest
      ports:
        - "3001:3000"
      volumes:
        - ./config/observability/grafana/provisioning:/etc/grafana/provisioning:ro
        - grafana_data:/var/lib/grafana
      environment:
        GF_AUTH_ANONYMOUS_ENABLED: "true"
        GF_AUTH_ANONYMOUS_ORG_ROLE: Admin
        GF_AUTH_DISABLE_LOGIN_FORM: "true"
      depends_on:
        prometheus:
          condition: service_started
        loki:
          condition: service_started
        tempo:
          condition: service_started
  ```

- [ ] **Step 2: Add 4 new named volumes**

  Replace the existing `volumes:` block:

  ```yaml
  volumes:
    postgres_data:
    prometheus_data:
    loki_data:
    tempo_data:
    grafana_data:
  ```

- [ ] **Step 3: Start the stack and verify all services come up**

  ```bash
  doppler run -- docker compose up -d --wait
  docker compose ps
  ```

  Expected: all 7 services show `healthy` or `running`. If Alloy exits immediately, check `docker compose logs alloy` — usually a config syntax error in `config.alloy`.

- [ ] **Step 4: Verify Grafana datasources**

  Open [http://localhost:3001/connections/datasources](http://localhost:3001/connections/datasources)

  Expected: Prometheus, Loki, and Tempo all show as provisioned (lock icon). Click each → "Save & test" → green tick.

  If Tempo shows connection refused, check that `tempo:3200` is reachable inside the Docker network:
  ```bash
  docker compose exec grafana wget -qO- http://tempo:3200/ready
  ```

- [ ] **Step 5: Commit**

  ```bash
  just stop
  git add docker-compose.yml
  git commit -m "feat(docker): add Alloy, Prometheus, Loki, Tempo, and Grafana to dev stack"
  ```

---

## Task 9: Integration smoke test

**Files:** none (verification only)

- [ ] **Step 1: Start the full dev stack**

  ```bash
  just dev
  ```

  Wait for mprocs to show the API running and all Docker services healthy.

- [ ] **Step 2: Generate some telemetry**

  ```bash
  curl http://localhost:3000/health
  curl http://localhost:3000/ready
  curl http://localhost:3000/auth/token -X POST -H "Content-Type: application/json" \
    -d '{"grant_type":"password","username":"test","password":"test"}'
  ```

  Make ~10 requests to mix methods and status codes.

- [ ] **Step 3: Verify traces in Tempo**

  Open [http://localhost:3001/explore](http://localhost:3001/explore)
  - Select datasource: **Tempo**
  - Click **Search** → **Run query**
  - Expected: spans for `/health` and `/ready` appear within ~15 seconds

- [ ] **Step 4: Verify logs in Loki**

  - Select datasource: **Loki**
  - Query: `{service_name="plnd_api"}`
  - Expected: structured log lines from the API requests

  Also verify Docker container logs:
  - Query: `{container_name="plnd-db-1"}` (or similar — check `docker compose ps` for exact names)

- [ ] **Step 5: Verify metrics in Prometheus**

  Open [http://localhost:9090/graph](http://localhost:9090/graph)
  - Query: `http_server_request_duration_milliseconds_count`
  - Expected: metric series with `http_route`, `http_request_method`, `http_response_status_code` labels

  Note: OTEL metric names use underscores when stored in Prometheus (dots replaced). The `http.server.request.duration` histogram becomes `http_server_request_duration_milliseconds_{bucket,count,sum}`.

- [ ] **Step 6: Verify cross-signal linking**

  In Tempo's trace explorer:
  - Click any span
  - Click **Logs for this span** → should open Loki with a correlated query
  - Click **Metrics for this span** → should open Prometheus with a correlated query

---

## Task 10: Grafana dashboards

**Files:**
- Create: `config/observability/grafana/provisioning/dashboards/plnd-overview.json`
- Create: `config/observability/grafana/provisioning/dashboards/plnd-traces.json`
- Create: `config/observability/grafana/provisioning/dashboards/plnd-providers.json`

The dashboard JSON files are built interactively in Grafana, then exported as code.

### Overview dashboard (`plnd-overview.json`)

- [ ] **Step 1: Create the dashboard in Grafana**

  Open [http://localhost:3001/dashboard/new](http://localhost:3001/dashboard/new) → **+ Add visualization**

  Add the following panels (datasource: **Prometheus** for all):

  **Panel 1 — Request Rate (RPS)**
  - Type: Time series
  - Query: `sum(rate(http_server_request_duration_milliseconds_count[1m])) by (http_route)`
  - Title: "Request Rate by Route"

  **Panel 2 — p95 Latency**
  - Type: Time series
  - Query: `histogram_quantile(0.95, sum(rate(http_server_request_duration_milliseconds_bucket[5m])) by (le, http_route))`
  - Unit: milliseconds
  - Title: "p95 Latency by Route"

  **Panel 3 — Error Rate**
  - Type: Time series
  - Query: `sum(rate(http_server_request_duration_milliseconds_count{http_response_status_code=~"5.."}[1m])) / sum(rate(http_server_request_duration_milliseconds_count[1m]))`
  - Unit: percent (0–1)
  - Title: "5xx Error Rate"

  **Panel 4 — Active Requests**
  - Type: Stat
  - Query: `sum(http_server_active_requests)`
  - Title: "Active Requests"

  Set dashboard title: **PLND Overview**

- [ ] **Step 2: Export and save as code**

  Dashboard menu (top bar) → **Share** → **Export** → **Save to file**

  Move the downloaded file to:
  ```bash
  mv ~/Downloads/plnd-overview-*.json \
     config/observability/grafana/provisioning/dashboards/plnd-overview.json
  ```

### Traces dashboard (`plnd-traces.json`)

- [ ] **Step 3: Create the Tempo trace explorer dashboard**

  New dashboard → Add visualization → datasource: **Tempo**

  **Panel 1 — Trace explorer**
  - Type: Traces
  - Query type: Search
  - Service name filter: `plnd_api`
  - Title: "Traces — plnd_api"

  **Panel 2 — Span duration histogram** (datasource: **Prometheus**)
  - Type: Histogram
  - Query: `tempo_spanmetrics_duration_seconds_bucket{service="plnd_api"}`
  - Title: "Span Duration Distribution"

  Set dashboard title: **PLND Traces**

  Export → save as `config/observability/grafana/provisioning/dashboards/plnd-traces.json`

### Providers dashboard (`plnd-providers.json`)

- [ ] **Step 4: Create the external provider dashboard**

  New dashboard → datasource: **Prometheus** + **Tempo** (mixed)

  **Panel 1 — Provider call duration p95** (Prometheus)
  - Query: `histogram_quantile(0.95, sum(rate(tempo_spanmetrics_duration_seconds_bucket{span_name=~"provider::.*"}[5m])) by (le, span_name))`
  - Title: "Provider p95 Latency"

  **Panel 2 — Provider error rate** (Prometheus)
  - Query: `sum(rate(tempo_spanmetrics_calls_total{span_name=~"provider::.*", status_code="STATUS_CODE_ERROR"}[5m])) by (span_name) / sum(rate(tempo_spanmetrics_calls_total{span_name=~"provider::.*"}[5m])) by (span_name)`
  - Title: "Provider Error Rate"

  **Panel 3 — Provider call rate** (Prometheus)
  - Query: `sum(rate(tempo_spanmetrics_calls_total{span_name=~"provider::.*"}[1m])) by (span_name)`
  - Title: "Provider Call Rate"

  Set dashboard title: **PLND External Providers**

  Export → save as `config/observability/grafana/provisioning/dashboards/plnd-providers.json`

- [ ] **Step 5: Restart Grafana to load the dashboard files**

  ```bash
  docker compose restart grafana
  ```

  Open [http://localhost:3001/dashboards](http://localhost:3001/dashboards)

  Expected: all three dashboards appear under a "plnd" folder.

- [ ] **Step 6: Commit dashboards**

  ```bash
  git add config/observability/grafana/provisioning/dashboards/
  git commit -m "feat(grafana): add overview, traces, and provider dashboard JSONs"
  ```

---

## Task 11: Quality check, code review, and PR

- [ ] **Step 1: Run full quality suite**

  ```bash
  just verify
  ```

  Expected: all checks pass (fmt, clippy, deny, machete, ts-lint, ts-deps, unit tests, e2e).

  Common issues to watch for:
  - `clippy`: unused imports if OTEL crates have dead code in the `None` path — add `#[allow(unused_imports)]` or restructure imports
  - `machete`: will detect if any of the 6 new crates aren't actually used — check usages in `telemetry.rs` and `metrics.rs`

- [ ] **Step 2: Code reviewer subagent**

  Before opening the PR, invoke the code reviewer to validate against the spec and check for issues.

- [ ] **Step 3: Open PR**

  ```bash
  git push -u origin feature/observability-stack
  gh pr create \
    --title "feat: observability infrastructure stack (Prometheus, Loki, Tempo, Grafana, Alloy)" \
    --body "$(cat <<'EOF'
  ## Summary

  - Adds Grafana Alloy, Prometheus, Loki, Tempo, and Grafana to `docker-compose.yml` — `just dev` unchanged
  - Wires `opentelemetry-otlp` + `tracing-opentelemetry` into the subscriber stack in `main.rs`
  - All Grafana datasources and dashboards provisioned as code under `config/observability/`
  - Cross-signal linking (trace → logs, trace → metrics) provisioned via datasource config

  ## Test plan

  - [ ] `just dev` starts with all 7 services healthy
  - [ ] `curl http://localhost:3000/health` → span visible in Tempo at http://localhost:3001
  - [ ] Correlated log visible in Loki for the same request (by X-Request-ID)
  - [ ] `http_server_request_duration_milliseconds_count` visible in Prometheus
  - [ ] Three dashboards visible in Grafana without manual setup
  - [ ] `just verify` passes cleanly

  Closes #181

  🤖 Generated with [Claude Code](https://claude.com/claude-code)
  EOF
  )"
  ```

---

## Verification Checklist

- [ ] `just dev` starts all 7 services (postgres, mock-oauth, alloy, prometheus, loki, tempo, grafana) with no errors
- [ ] `APP_OTEL__ENDPOINT` unset → API starts without OTEL (stdout-only), no error on startup
- [ ] Grafana at http://localhost:3001 shows all three datasources green (no login required)
- [ ] A request to `/health` produces a trace in Tempo within ~15 seconds
- [ ] The same request produces a log line in Loki queryable with `{service_name="plnd_api"}`
- [ ] `http_server_request_duration_milliseconds_count` appears in Prometheus
- [ ] Clicking a trace in Grafana offers working "Logs for this span" and "Metrics for this span" links
- [ ] PLND Overview, PLND Traces, and PLND External Providers dashboards are pre-loaded in Grafana
- [ ] `just verify` passes cleanly
