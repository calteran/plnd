use axum::{Router, routing::get};

#[tokio::main]
async fn main() {
    // Build our application with a single route
    let app = Router::new().route("/health", get(health_check));

    // Run it on localhost:3000
    let listener = tokio::net::TcpListener::bind("0.0.0.0:3000").await.unwrap();
    println!("API server listening on {}", listener.local_addr().unwrap());
    axum::serve(listener, app).await.unwrap();
}

// Health check endpoint
async fn health_check() -> &'static str {
    "OK"
}
