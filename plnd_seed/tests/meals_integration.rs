use plnd_seed::meals::insert_meals;
use sqlx::PgPool;

#[sqlx::test(migrations = "../plnd_data/migrations")]
async fn catalog_meals_are_seeded(pool: PgPool) {
    let mut tx = pool.begin().await.expect("begin transaction");
    let count = insert_meals(&mut tx).await.expect("insert_meals failed");
    tx.commit().await.expect("commit failed");

    assert_eq!(count, 11, "expected 11 meals inserted");

    let db_count: i64 = sqlx::query_scalar("SELECT COUNT(*) FROM catalog_meals")
        .fetch_one(&pool)
        .await
        .unwrap();
    assert_eq!(db_count, 11, "expected 11 rows in catalog_meals");
}

#[sqlx::test(migrations = "../plnd_data/migrations")]
async fn catalog_meals_are_idempotent(pool: PgPool) {
    let mut tx = pool.begin().await.expect("begin first transaction");
    let first = insert_meals(&mut tx)
        .await
        .expect("first insert_meals failed");
    tx.commit().await.expect("first commit failed");

    let mut tx = pool.begin().await.expect("begin second transaction");
    let second = insert_meals(&mut tx)
        .await
        .expect("second insert_meals failed");
    tx.commit().await.expect("second commit failed");

    assert_eq!(first, 11, "first run should insert 11 meals");
    assert_eq!(second, 0, "second run should insert 0 (all conflict)");

    let db_count: i64 = sqlx::query_scalar("SELECT COUNT(*) FROM catalog_meals")
        .fetch_one(&pool)
        .await
        .unwrap();
    assert_eq!(
        db_count, 11,
        "idempotency broken: count changed after second run"
    );
}
