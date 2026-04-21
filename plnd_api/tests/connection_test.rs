use plnd_data::{Error, Repositories};

#[tokio::test]
async fn test_repositories_connection_error() {
    let db_url = "postgres://test:test@localhost/test";
    let result: Result<Repositories, Error> = Repositories::new(db_url, 10).await;
    assert!(matches!(result, Err(Error::Connection(_))));
}
