use plnd_data::db::error::DatabaseError;
use plnd_data::Repositories;

#[tokio::test]
async fn test_repositories_connection_error() {
    let db_url = "postgres://test:test@localhost/test";
    let result: Result<Repositories, DatabaseError> = Repositories::new(db_url, 10).await;
    assert!(matches!(result, Err(DatabaseError::ConnectionError(_))));
}
