//! Middleware that extracts W3C TraceContext from incoming request headers
//! and sets the extracted context as the parent on the current tracing span.
//!
//! Apply this middleware INSIDE (more inner than) `TraceLayer` so that the span
//! created by `TraceLayer` is already active when this middleware runs, allowing
//! `set_parent` to link it to the upstream distributed trace.

use axum::{extract::Request, middleware::Next, response::Response};
use opentelemetry::propagation::Extractor;
use tracing_opentelemetry::OpenTelemetrySpanExt;

struct HeaderExtractor<'a>(&'a axum::http::HeaderMap);

impl<'a> Extractor for HeaderExtractor<'a> {
    fn get(&self, key: &str) -> Option<&str> {
        self.0.get(key).and_then(|v| v.to_str().ok())
    }

    fn keys(&self) -> Vec<&str> {
        self.0.keys().map(|k| k.as_str()).collect()
    }
}

/// Extracts the W3C `traceparent`/`tracestate` headers from the incoming request
/// and sets the resulting context as the parent on the current tracing span.
///
/// No-op when the propagator is not configured or the headers are absent.
pub async fn extract_trace_context(req: Request, next: Next) -> Response {
    let parent_cx = opentelemetry::global::get_text_map_propagator(|propagator| {
        propagator.extract(&HeaderExtractor(req.headers()))
    });
    let _ = tracing::Span::current().set_parent(parent_cx);
    next.run(req).await
}
