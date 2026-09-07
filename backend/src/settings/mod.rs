use std::collections::HashMap;

use axum::{Json, Router, extract::State, routing::get};
use serde::{Deserialize, Serialize};
use sqlx::SqlitePool;
use utoipa::ToSchema;

use crate::{
    AppState,
    auth::AdminUser,
    db::now_ts,
    error::{ApiError, ApiResult},
};

pub const KEY_SITE_NOTICE: &str = "site_notice";
pub const KEY_CALDAV_SYNC_ENABLED: &str = "caldav_sync_enabled";
pub const KEY_CALDAV_EVENT_SUMMARY_TEMPLATE: &str = "caldav_event_summary_template";
pub const KEY_MAX_BOOKING_DURATION_HOURS: &str = "max_booking_duration_hours";

pub const DEFAULT_SETTINGS: &[(&str, &str)] = &[
    (KEY_SITE_NOTICE, ""),
    (KEY_CALDAV_SYNC_ENABLED, "1"),
    (KEY_CALDAV_EVENT_SUMMARY_TEMPLATE, "{resource} — {user}"),
    (KEY_MAX_BOOKING_DURATION_HOURS, "336"),
];

pub fn router() -> Router<AppState> {
    Router::new().route("/admin/settings", get(get_settings).put(put_settings))
}

#[derive(Serialize, ToSchema)]
pub struct SettingsResponse {
    /// All known settings as a key → value map.
    pub settings: HashMap<String, String>,
}

#[derive(Deserialize, ToSchema)]
pub struct UpdateSettingsRequest {
    pub settings: HashMap<String, String>,
}

pub async fn get_setting(db: &SqlitePool, key: &str) -> Result<Option<String>, sqlx::Error> {
    let row: Option<(String,)> = sqlx::query_as("SELECT value FROM settings WHERE key = ?")
        .bind(key)
        .fetch_optional(db)
        .await?;
    Ok(row.map(|(value,)| value))
}

async fn all_settings(db: &SqlitePool) -> Result<HashMap<String, String>, sqlx::Error> {
    let rows: Vec<(String, String)> = sqlx::query_as("SELECT key, value FROM settings")
        .fetch_all(db)
        .await?;
    Ok(rows.into_iter().collect())
}

#[utoipa::path(
    get,
    path = "/api/v1/admin/settings",
    tag = "admin",
    responses((status = 200, body = SettingsResponse))
)]
pub(crate) async fn get_settings(
    State(state): State<AppState>,
    _admin: AdminUser,
) -> ApiResult<Json<SettingsResponse>> {
    Ok(Json(SettingsResponse {
        settings: all_settings(&state.db).await?,
    }))
}

#[utoipa::path(
    put,
    path = "/api/v1/admin/settings",
    tag = "admin",
    request_body = UpdateSettingsRequest,
    responses(
        (status = 200, body = SettingsResponse),
        (status = 400, description = "Unknown settings key", body = crate::error::ErrorResponse)
    )
)]
pub(crate) async fn put_settings(
    State(state): State<AppState>,
    _admin: AdminUser,
    Json(input): Json<UpdateSettingsRequest>,
) -> ApiResult<Json<SettingsResponse>> {
    let allowed: Vec<&str> = DEFAULT_SETTINGS.iter().map(|(key, _)| *key).collect();
    for key in input.settings.keys() {
        if !allowed.contains(&key.as_str()) {
            return Err(ApiError::BadRequest(format!("unknown settings key: {key}")));
        }
    }
    if let Some(value) = input.settings.get(KEY_MAX_BOOKING_DURATION_HOURS)
        && value.trim().parse::<i64>().map_or(true, |hours| hours <= 0)
    {
        return Err(ApiError::BadRequest(
            "max_booking_duration_hours must be a positive integer".into(),
        ));
    }

    let now = now_ts();
    for (key, value) in &input.settings {
        sqlx::query(
            "INSERT INTO settings (key, value, updated_at) VALUES (?, ?, ?)
             ON CONFLICT(key) DO UPDATE SET value = excluded.value, updated_at = excluded.updated_at",
        )
        .bind(key)
        .bind(value)
        .bind(now)
        .execute(&state.db)
        .await?;
    }

    Ok(Json(SettingsResponse {
        settings: all_settings(&state.db).await?,
    }))
}
