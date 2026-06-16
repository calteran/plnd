use opentelemetry::KeyValue;
use opentelemetry_otlp::WithExportConfig;
use opentelemetry_sdk::{
    Resource,
    logs::SdkLoggerProvider,
    metrics::{PeriodicReader, SdkMeterProvider},
    trace::SdkTracerProvider,
};
use opentelemetry_semantic_conventions::resource::SERVICE_NAME;

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

pub struct TelemetryProviders {
    pub tracer_provider: SdkTracerProvider,
    pub logger_provider: SdkLoggerProvider,
    pub meter_provider: SdkMeterProvider,
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

    let resource = build_resource(std::env::var("VERIFY_RUN_ID").ok());

    // ── Traces ──────────────────────────────────────────────────────────────
    let trace_exporter = opentelemetry_otlp::SpanExporter::builder()
        .with_tonic()
        .with_endpoint(&endpoint)
        .build()?;
    let tracer_provider = SdkTracerProvider::builder()
        .with_resource(resource.clone())
        .with_batch_exporter(trace_exporter)
        .build();

    // ── Logs ────────────────────────────────────────────────────────────────
    let log_exporter = opentelemetry_otlp::LogExporter::builder()
        .with_tonic()
        .with_endpoint(&endpoint)
        .build()?;
    let logger_provider = SdkLoggerProvider::builder()
        .with_resource(resource.clone())
        .with_batch_exporter(log_exporter)
        .build();

    // ── Metrics ─────────────────────────────────────────────────────────────
    let metric_exporter = opentelemetry_otlp::MetricExporter::builder()
        .with_tonic()
        .with_endpoint(&endpoint)
        .build()?;
    let meter_provider = SdkMeterProvider::builder()
        .with_resource(resource)
        .with_reader(PeriodicReader::builder(metric_exporter).build())
        .build();

    // Register as global providers so middleware can reach them via global::meter()
    opentelemetry::global::set_tracer_provider(tracer_provider.clone());
    opentelemetry::global::set_meter_provider(meter_provider.clone());
    opentelemetry::global::set_text_map_propagator(
        opentelemetry_sdk::propagation::TraceContextPropagator::new(),
    );

    Ok(Some(TelemetryProviders {
        tracer_provider,
        logger_provider,
        meter_provider,
    }))
}

/// Flush all OTEL providers before process exit.
/// Call this after `axum::serve()` returns to prevent dropped spans/logs/metrics.
pub fn shutdown_providers(providers: TelemetryProviders) {
    let _ = providers.tracer_provider.shutdown();
    let _ = providers.logger_provider.shutdown();
    let _ = providers.meter_provider.shutdown();
}

#[cfg(test)]
mod tests {
    use super::*;
    use opentelemetry::Key;

    #[test]
    fn init_providers_with_none_returns_none() {
        let result = init_providers(None);
        assert!(result.unwrap().is_none());
    }

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
}
