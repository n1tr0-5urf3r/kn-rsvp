use std::str::FromStr;

use rsvp::db;
use sqlx::{
    SqlitePool,
    sqlite::{SqliteConnectOptions, SqlitePoolOptions},
};

async fn memory_pool() -> SqlitePool {
    let options = SqliteConnectOptions::from_str("sqlite::memory:")
        .unwrap()
        .foreign_keys(true);
    SqlitePoolOptions::new()
        .max_connections(1)
        .connect_with(options)
        .await
        .unwrap()
}

#[tokio::test]
async fn fresh_database_has_schema_without_deployment_inventory() {
    let pool = memory_pool().await;
    db::MIGRATOR.run(&pool).await.unwrap();

    for (table, query) in [
        ("servers", "SELECT count(*) FROM servers"),
        ("tofinos", "SELECT count(*) FROM tofinos"),
        (
            "management_switches",
            "SELECT count(*) FROM management_switches",
        ),
        ("vlans", "SELECT count(*) FROM vlans"),
    ] {
        let count: (i64,) = sqlx::query_as(query).fetch_one(&pool).await.unwrap();
        assert_eq!(count.0, 0, "{table} must not contain deployment data");
    }
}

#[tokio::test]
async fn legacy_migration_records_are_accepted() {
    let pool = memory_pool().await;
    db::MIGRATOR.run(&pool).await.unwrap();

    sqlx::query(
        "INSERT INTO _sqlx_migrations (
             version, description, success, checksum, execution_time
         ) VALUES (?, 'private legacy migration', 1, x'00', 0)",
    )
    .bind(202607250001_i64)
    .execute(&pool)
    .await
    .unwrap();

    db::MIGRATOR.run(&pool).await.unwrap();
}
