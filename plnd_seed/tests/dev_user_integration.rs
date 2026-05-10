use plnd_seed::dev_user::seed_dev_user;
use sqlx::PgPool;
use uuid::Uuid;

const DEV_EMAIL: &str = "testuser@mock.plnd";

async fn dev_user_id(pool: &PgPool) -> Uuid {
    sqlx::query_scalar("SELECT user_id FROM users WHERE email = $1")
        .bind(DEV_EMAIL)
        .fetch_one(pool)
        .await
        .expect("dev user not found")
}

#[sqlx::test(migrations = "../plnd_data/migrations")]
async fn seed_dev_user_creates_expected_rows(pool: PgPool) {
    seed_dev_user(&pool).await.expect("seed_dev_user failed");

    let uid: Uuid = dev_user_id(&pool).await;

    let user_count: i64 = sqlx::query_scalar("SELECT COUNT(*) FROM users WHERE user_id = $1")
        .bind(uid)
        .fetch_one(&pool)
        .await
        .unwrap();
    assert_eq!(user_count, 1, "expected exactly 1 user row");

    let oauth_count: i64 =
        sqlx::query_scalar("SELECT COUNT(*) FROM oauth_providers WHERE user_id = $1")
            .bind(uid)
            .fetch_one(&pool)
            .await
            .unwrap();
    assert_eq!(oauth_count, 1, "expected exactly 1 oauth_providers row");

    let prefs_count: i64 =
        sqlx::query_scalar("SELECT COUNT(*) FROM user_preferences WHERE user_id = $1")
            .bind(uid)
            .fetch_one(&pool)
            .await
            .unwrap();
    assert_eq!(prefs_count, 1, "expected exactly 1 user_preferences row");

    let day_type_count: i64 = sqlx::query_scalar(
        "SELECT COUNT(*) FROM user_day_types WHERE user_id = $1 AND is_default = true",
    )
    .bind(uid)
    .fetch_one(&pool)
    .await
    .unwrap();
    assert_eq!(
        day_type_count, 1,
        "expected exactly 1 default user_day_type"
    );

    let meal_pattern_count: i64 = sqlx::query_scalar(
        "SELECT COUNT(*) FROM meal_pattern_entries
         WHERE day_type_id = (
             SELECT id FROM user_day_types WHERE user_id = $1 AND is_default = true
         )",
    )
    .bind(uid)
    .fetch_one(&pool)
    .await
    .unwrap();
    assert_eq!(
        meal_pattern_count, 3,
        "expected exactly 3 meal_pattern_entries"
    );

    let user_meal_count: i64 =
        sqlx::query_scalar("SELECT COUNT(*) FROM user_meals WHERE user_id = $1")
            .bind(uid)
            .fetch_one(&pool)
            .await
            .unwrap();
    assert_eq!(user_meal_count, 3, "expected exactly 3 user_meals");

    let schedule_count: i64 =
        sqlx::query_scalar("SELECT COUNT(*) FROM schedule_entries WHERE user_id = $1")
            .bind(uid)
            .fetch_one(&pool)
            .await
            .unwrap();
    assert_eq!(
        schedule_count, 152,
        "expected 152 schedule_entries (38 days × 4 entries/day)"
    );
}

#[sqlx::test(migrations = "../plnd_data/migrations")]
async fn seed_dev_user_is_idempotent(pool: PgPool) {
    seed_dev_user(&pool)
        .await
        .expect("first seed_dev_user call failed");
    seed_dev_user(&pool)
        .await
        .expect("second seed_dev_user call failed");

    let uid: Uuid = dev_user_id(&pool).await;

    let user_count: i64 = sqlx::query_scalar("SELECT COUNT(*) FROM users WHERE user_id = $1")
        .bind(uid)
        .fetch_one(&pool)
        .await
        .unwrap();
    assert_eq!(
        user_count, 1,
        "idempotency broken: expected 1 user, got more"
    );

    let day_type_count: i64 =
        sqlx::query_scalar("SELECT COUNT(*) FROM user_day_types WHERE user_id = $1")
            .bind(uid)
            .fetch_one(&pool)
            .await
            .unwrap();
    assert_eq!(
        day_type_count, 1,
        "idempotency broken: expected 1 user_day_types row"
    );

    let meal_pattern_count: i64 = sqlx::query_scalar(
        "SELECT COUNT(*) FROM meal_pattern_entries
         WHERE day_type_id = (
             SELECT id FROM user_day_types WHERE user_id = $1 AND is_default = true
         )",
    )
    .bind(uid)
    .fetch_one(&pool)
    .await
    .unwrap();
    assert_eq!(
        meal_pattern_count, 3,
        "idempotency broken: expected 3 meal_pattern_entries"
    );
}
