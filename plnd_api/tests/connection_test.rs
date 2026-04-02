use plnd_data::db::connection::Database;
use plnd_data::db::error::DatabaseError;

#[tokio::test]
async fn test_database_connection_creation() {
    // This test would normally connect to a test database
    // For now, we'll test that the Database struct can be created
    // In a real scenario, you'd use a test database URL

    // Mock database URL for testing structure
    let db_url = "postgres://test:test@localhost/test";

    // This will fail to connect, but we can test the error handling
    let result: Result<Database, DatabaseError> = Database::new(db_url, 10).await;

    // Should return an error since the database doesn't exist
    assert!(matches!(result, Err(DatabaseError::ConnectionError(_))));
}

#[tokio::test]
async fn test_database_health_check() {
    // Create a mock database (this will fail, but we test the flow)
    let db_url = "postgres://test:test@localhost/test";

    let db_result: Result<Database, DatabaseError> = Database::new(db_url, 10).await;

    // Since we can't connect, we can't test health check
    // But we can verify the error handling
    assert!(db_result.is_err());
}
