# Observability Design — Issue #180

## Context

PLND has zero observability today. `LoggingConfig` exists in settings.rs but is wired to nothing.
All error reporting is ad-hoc `eprintln!`. This spec covers Phases 1–3; Phase 4 (OTEL exporter)
is tracked in #181.

## Architecture

`tracing` is a pure facade. Subscriber stack lives only in `plnd_api/src/main.rs`.

**Subscriber stack:**
- `pretty_print: true` → humantime colored output (local dev)
- `pretty_print: false` → JSON lines to stdout (CI/production)

**Span hierarchy per request:**
```
tower-http TraceLayer           ← root span: method, path, status, latency
└── route handler span          ← #[instrument(skip(state), fields(user_id))]
    ├── plnd_data DB span       ← #[instrument(skip(pool), fields(table, op))]
    └── plnd_data provider span ← #[instrument(name="provider::method", fields(provider))]
```

**Request ID strategy:** PropagateRequestId — reads X-Request-ID from frontend, generates UUID if absent, echoes in response.

**POST /api/client_error:** Public endpoint. Unauthenticated requests are rate-limited at 20/minute per IP (checked via X-Forwarded-For / X-Real-IP). Valid JWT bypasses rate limit. Emits tracing::error! with payload fields.

## Frontend

- `observabilityInterceptor`: attaches X-Request-ID to every request; POSTs HTTP errors via `fetch` (bypasses interceptor chain, prevents recursion)
- `GlobalErrorHandlerService`: catches all unhandled Angular exceptions; POSTs via `fetch`

## Phase 4 note

Zero code from this implementation changes when #181 lands — only Cargo.toml + subscriber stack in main.rs.
