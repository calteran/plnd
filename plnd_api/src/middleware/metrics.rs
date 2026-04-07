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
use opentelemetry_semantic_conventions::{
    attribute::{HTTP_REQUEST_METHOD, HTTP_RESPONSE_STATUS_CODE, HTTP_ROUTE},
    metric::{HTTP_SERVER_ACTIVE_REQUESTS, HTTP_SERVER_REQUEST_DURATION},
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

    fn layer(&self, inner: S) -> HttpMetricsService<S> {
        let meter = global::meter("plnd_api");
        HttpMetricsService {
            inner,
            request_duration: meter
                .f64_histogram(HTTP_SERVER_REQUEST_DURATION)
                .with_unit("ms")
                .with_description("HTTP server request duration in milliseconds")
                .build(),
            active_requests: meter
                .i64_up_down_counter(HTTP_SERVER_ACTIVE_REQUESTS)
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
    type Response = axum::http::Response<axum::body::Body>;
    type Error = S::Error;
    type Future = Pin<
        Box<dyn Future<Output = Result<axum::http::Response<axum::body::Body>, S::Error>> + Send>,
    >;

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
                KeyValue::new(HTTP_REQUEST_METHOD, method.clone()),
                KeyValue::new(HTTP_ROUTE, route.clone()),
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
                    KeyValue::new(HTTP_REQUEST_METHOD, method.clone()),
                    KeyValue::new(HTTP_ROUTE, route.clone()),
                    KeyValue::new(HTTP_RESPONSE_STATUS_CODE, status_code),
                ],
            );
            active.add(
                -1,
                &[
                    KeyValue::new(HTTP_REQUEST_METHOD, method),
                    KeyValue::new(HTTP_ROUTE, route),
                ],
            );

            result
        })
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use axum::{
        body::Body,
        http::{Request, StatusCode},
        routing::get,
        Router,
    };
    use tower::ServiceExt;

    #[tokio::test]
    async fn metrics_layer_passes_request_through() {
        let app = Router::new()
            .route("/health", get(|| async { "OK" }))
            .layer(HttpMetricsLayer);

        let response = app
            .oneshot(
                Request::builder()
                    .uri("/health")
                    .body(Body::empty())
                    .unwrap(),
            )
            .await
            .unwrap();

        assert_eq!(response.status(), StatusCode::OK);
    }
}
