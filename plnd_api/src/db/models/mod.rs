use chrono::{DateTime, Utc};
use serde::Serialize;

#[derive(Serialize)]
pub struct ReadyStatus {
    pub status: String,
    pub database: String,
    pub timestamp: DateTime<Utc>,
}
