mod providers;
mod router;
mod startup;
mod telemetry;

use plnd_api::config;
use std::net::SocketAddr;

#[tokio::main]
async fn main() -> Result<(), Box<dyn std::error::Error + Send + Sync>> {
    let config = match config::load_config() {
        Ok(config) => config,
        Err(e) => {
            // Subscriber not yet initialized — eprintln is the only option here.
            eprintln!("Failed to load configuration: {e}");
            std::process::exit(1);
        }
    };

    let otel = telemetry::init_providers(config.otel.endpoint.as_deref())?;
    telemetry::init_subscriber(&config.logging, otel.as_ref());

    let state = startup::build_state(&config).await?;
    let cors = router::cors_layer(&config.auth.frontend_origin)?;
    let app = router::build(state, cors);

    let listener = tokio::net::TcpListener::bind(&config.api.base_url).await?;
    tracing::info!(addr = %listener.local_addr()?, "API server listening");
    axum::serve(
        listener,
        app.into_make_service_with_connect_info::<SocketAddr>(),
    )
    .await?;

    // Flush all OTEL providers before exit to prevent dropped spans/logs/metrics.
    if let Some(providers) = otel {
        telemetry::shutdown_providers(providers);
    }
    Ok(())
}
