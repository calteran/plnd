mod providers;
mod router;
mod startup;
mod telemetry;

use std::net::SocketAddr;

use plnd_api::config;
#[tokio::main]
async fn main() {
    let config = match config::load_config() {
        Ok(config) => config,
        Err(e) => {
            // Subscriber not yet initialized — eprintln is the only option here
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

    telemetry::init_subscriber(&config.logging, otel_providers.as_ref());

    let state = match startup::build_state(&config).await {
        Ok(s) => s,
        Err(e) => {
            tracing::error!(error = %e, "failed to build application state");
            std::process::exit(1);
        }
    };

    let cors = match router::cors_layer(&config.auth.frontend_origin) {
        Ok(c) => c,
        Err(e) => {
            eprintln!("invalid CORS origin: {e}");
            std::process::exit(1);
        }
    };

    let app = router::build(state, cors);

    let listener = tokio::net::TcpListener::bind(&config.api.base_url)
        .await
        .unwrap();
    tracing::info!(addr = %listener.local_addr().unwrap(), "API server listening");
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
}
