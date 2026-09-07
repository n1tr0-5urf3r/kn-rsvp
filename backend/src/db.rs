use std::str::FromStr;

use chrono::Utc;
use sqlx::{SqlitePool, migrate::Migrator, sqlite::SqlitePoolOptions};

use crate::settings;

pub static MIGRATOR: Migrator = {
    let mut migrator = sqlx::migrate!("./migrations");
    // The public schema baseline replaces a private migration chain. Existing
    // deployments retain those applied records; fresh deployments only see the
    // schema-only baseline.
    migrator.ignore_missing = true;
    migrator
};

pub fn now_ts() -> i64 {
    Utc::now().timestamp()
}

pub async fn connect(database_url: &str) -> anyhow::Result<SqlitePool> {
    let options = sqlx::sqlite::SqliteConnectOptions::from_str(database_url)?
        .create_if_missing(true)
        .foreign_keys(true);
    let pool = SqlitePoolOptions::new()
        .max_connections(5)
        .connect_with(options)
        .await?;
    MIGRATOR.run(&pool).await?;
    Ok(pool)
}

pub async fn seed_defaults(pool: &SqlitePool) -> anyhow::Result<()> {
    let now = now_ts();
    for (key, value) in settings::DEFAULT_SETTINGS {
        sqlx::query("INSERT OR IGNORE INTO settings (key, value, updated_at) VALUES (?, ?, ?)")
            .bind(key)
            .bind(value)
            .bind(now)
            .execute(pool)
            .await?;
    }
    Ok(())
}
