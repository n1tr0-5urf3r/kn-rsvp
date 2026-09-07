pub mod ics;

use std::{sync::atomic::Ordering, time::Duration};

use axum::{
    Json, Router,
    extract::{Path, State},
    http::StatusCode,
    routing::{get, post},
};
use serde::{Deserialize, Serialize};
use utoipa::ToSchema;
use uuid::Uuid;

use crate::{
    AppState,
    auth::AdminUser,
    config::truthy,
    db::now_ts,
    error::{ApiError, ApiResult},
    settings,
};

const MAX_ATTEMPTS: i64 = 10;
const BACKOFF_BASE_SECONDS: i64 = 30;
const WORKER_INTERVAL: Duration = Duration::from_secs(300);
const STATUS_ITEM_LIMIT: i64 = 50;

pub fn router() -> Router<AppState> {
    Router::new()
        .route(
            "/admin/caldav/calendars",
            get(list_calendars).post(create_calendar),
        )
        .route(
            "/admin/caldav/calendars/{id}",
            axum::routing::patch(update_calendar).delete(delete_calendar),
        )
        .route("/admin/caldav/calendars/{id}/test", post(test_calendar))
        .route("/admin/caldav/resync", post(resync))
        .route("/admin/caldav/status", get(caldav_status))
}

#[derive(Serialize, ToSchema)]
pub struct CalendarView {
    pub id: String,
    pub name: String,
    pub caldav_url: String,
    pub username: String,
    pub enabled: bool,
    /// The app password is write-only and never returned.
    pub has_password: bool,
    pub created_at: i64,
    pub updated_at: i64,
}

#[derive(Serialize, ToSchema)]
pub struct CalendarsResponse {
    pub calendars: Vec<CalendarView>,
}

#[derive(Deserialize, ToSchema)]
pub struct CreateCalendarRequest {
    pub name: String,
    pub caldav_url: String,
    pub username: String,
    pub app_password: String,
    pub enabled: Option<bool>,
}

#[derive(Deserialize, ToSchema)]
pub struct UpdateCalendarRequest {
    pub name: Option<String>,
    pub caldav_url: Option<String>,
    pub username: Option<String>,
    /// Empty or missing keeps the stored password.
    pub app_password: Option<String>,
    pub enabled: Option<bool>,
}

#[derive(Serialize, ToSchema)]
pub struct CalendarTestResponse {
    pub ok: bool,
    pub message: String,
}

#[derive(Serialize, ToSchema)]
pub struct ResyncResponse {
    /// Number of queue rows (bookings × enabled calendars) enqueued.
    pub enqueued: i64,
}

#[derive(Serialize, ToSchema)]
pub struct QueueItemView {
    pub id: String,
    pub calendar_id: String,
    pub calendar_name: String,
    pub ics_uid: String,
    pub action: String,
    pub status: String,
    pub attempts: i64,
    pub last_error: Option<String>,
    pub last_attempt_at: Option<i64>,
    pub updated_at: i64,
}

#[derive(Serialize, ToSchema)]
pub struct CaldavStatusResponse {
    pub pending: i64,
    pub error: i64,
    pub synced: i64,
    pub last_run_at: Option<i64>,
    pub items: Vec<QueueItemView>,
}

type CalendarRow = (String, String, String, String, String, i64, i64, i64);

fn calendar_view(row: CalendarRow) -> CalendarView {
    let (id, name, caldav_url, username, app_password, enabled, created_at, updated_at) = row;
    CalendarView {
        id,
        name,
        caldav_url,
        username,
        enabled: enabled != 0,
        has_password: !app_password.is_empty(),
        created_at,
        updated_at,
    }
}

async fn load_calendar(state: &AppState, id: &str) -> ApiResult<CalendarRow> {
    let row: Option<CalendarRow> = sqlx::query_as(
        "SELECT id, name, caldav_url, username, app_password, enabled, created_at, updated_at
         FROM caldav_calendars WHERE id = ?",
    )
    .bind(id)
    .fetch_optional(&state.db)
    .await?;
    row.ok_or(ApiError::NotFound)
}

#[utoipa::path(
    get,
    path = "/api/v1/admin/caldav/calendars",
    tag = "caldav",
    responses((status = 200, body = CalendarsResponse))
)]
pub(crate) async fn list_calendars(
    State(state): State<AppState>,
    _admin: AdminUser,
) -> ApiResult<Json<CalendarsResponse>> {
    let rows: Vec<CalendarRow> = sqlx::query_as(
        "SELECT id, name, caldav_url, username, app_password, enabled, created_at, updated_at
         FROM caldav_calendars ORDER BY name",
    )
    .fetch_all(&state.db)
    .await?;
    Ok(Json(CalendarsResponse {
        calendars: rows.into_iter().map(calendar_view).collect(),
    }))
}

#[utoipa::path(
    post,
    path = "/api/v1/admin/caldav/calendars",
    tag = "caldav",
    request_body = CreateCalendarRequest,
    responses((status = 201, body = CalendarView))
)]
pub(crate) async fn create_calendar(
    State(state): State<AppState>,
    _admin: AdminUser,
    Json(input): Json<CreateCalendarRequest>,
) -> ApiResult<(StatusCode, Json<CalendarView>)> {
    for (value, field) in [
        (&input.name, "name"),
        (&input.caldav_url, "caldav_url"),
        (&input.username, "username"),
        (&input.app_password, "app_password"),
    ] {
        if value.trim().is_empty() {
            return Err(ApiError::BadRequest(format!("{field} must not be empty")));
        }
    }
    let id = Uuid::new_v4().to_string();
    let now = now_ts();
    sqlx::query(
        "INSERT INTO caldav_calendars (id, name, caldav_url, username, app_password, enabled,
                                       created_at, updated_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?)",
    )
    .bind(&id)
    .bind(input.name.trim())
    .bind(input.caldav_url.trim())
    .bind(input.username.trim())
    .bind(&input.app_password)
    .bind(input.enabled.unwrap_or(true) as i64)
    .bind(now)
    .bind(now)
    .execute(&state.db)
    .await?;

    Ok((
        StatusCode::CREATED,
        Json(calendar_view(load_calendar(&state, &id).await?)),
    ))
}

#[utoipa::path(
    patch,
    path = "/api/v1/admin/caldav/calendars/{id}",
    tag = "caldav",
    params(("id" = String, Path)),
    request_body = UpdateCalendarRequest,
    responses((status = 200, body = CalendarView))
)]
pub(crate) async fn update_calendar(
    State(state): State<AppState>,
    _admin: AdminUser,
    Path(id): Path<String>,
    Json(input): Json<UpdateCalendarRequest>,
) -> ApiResult<Json<CalendarView>> {
    let (_, name, caldav_url, username, app_password, enabled, _, _) =
        load_calendar(&state, &id).await?;
    let name = input.name.map(|v| v.trim().to_string()).unwrap_or(name);
    let caldav_url = input
        .caldav_url
        .map(|v| v.trim().to_string())
        .unwrap_or(caldav_url);
    let username = input
        .username
        .map(|v| v.trim().to_string())
        .unwrap_or(username);
    let app_password = match input.app_password {
        Some(value) if !value.is_empty() => value,
        _ => app_password,
    };
    let enabled = input.enabled.map(i64::from).unwrap_or(enabled);
    sqlx::query(
        "UPDATE caldav_calendars SET name = ?, caldav_url = ?, username = ?, app_password = ?,
                                     enabled = ?, updated_at = ? WHERE id = ?",
    )
    .bind(&name)
    .bind(&caldav_url)
    .bind(&username)
    .bind(&app_password)
    .bind(enabled)
    .bind(now_ts())
    .bind(&id)
    .execute(&state.db)
    .await?;

    Ok(Json(calendar_view(load_calendar(&state, &id).await?)))
}

#[utoipa::path(
    delete,
    path = "/api/v1/admin/caldav/calendars/{id}",
    tag = "caldav",
    params(("id" = String, Path)),
    responses((status = 204, description = "Calendar deleted"))
)]
pub(crate) async fn delete_calendar(
    State(state): State<AppState>,
    _admin: AdminUser,
    Path(id): Path<String>,
) -> ApiResult<StatusCode> {
    let result = sqlx::query("DELETE FROM caldav_calendars WHERE id = ?")
        .bind(&id)
        .execute(&state.db)
        .await?;
    if result.rows_affected() == 0 {
        return Err(ApiError::NotFound);
    }
    Ok(StatusCode::NO_CONTENT)
}

#[utoipa::path(
    post,
    path = "/api/v1/admin/caldav/calendars/{id}/test",
    tag = "caldav",
    params(("id" = String, Path)),
    responses((status = 200, body = CalendarTestResponse))
)]
pub(crate) async fn test_calendar(
    State(state): State<AppState>,
    _admin: AdminUser,
    Path(id): Path<String>,
) -> ApiResult<Json<CalendarTestResponse>> {
    let (_, _, caldav_url, username, app_password, _, _, _) = load_calendar(&state, &id).await?;
    let method = reqwest::Method::from_bytes(b"PROPFIND")
        .map_err(|err| ApiError::Other(anyhow::anyhow!("invalid method: {err}")))?;
    let result = state
        .http
        .request(method, &caldav_url)
        .basic_auth(&username, Some(&app_password))
        .header("Depth", "0")
        .header(reqwest::header::CONTENT_TYPE, "application/xml")
        .body(
            r#"<?xml version="1.0" encoding="utf-8"?><d:propfind xmlns:d="DAV:"><d:prop><d:resourcetype/></d:prop></d:propfind>"#,
        )
        .send()
        .await;
    let response = match result {
        Ok(response) => response,
        Err(err) => {
            return Ok(Json(CalendarTestResponse {
                ok: false,
                message: format!("request failed: {err}"),
            }));
        }
    };
    let status = response.status();
    Ok(Json(CalendarTestResponse {
        ok: status.is_success(),
        message: format!("PROPFIND returned {status}"),
    }))
}

#[utoipa::path(
    post,
    path = "/api/v1/admin/caldav/resync",
    tag = "caldav",
    responses((status = 200, body = ResyncResponse))
)]
pub(crate) async fn resync(
    State(state): State<AppState>,
    _admin: AdminUser,
) -> ApiResult<Json<ResyncResponse>> {
    let booking_ids: Vec<(String,)> = sqlx::query_as("SELECT id FROM bookings")
        .fetch_all(&state.db)
        .await?;
    let mut enqueued = 0_i64;
    for (booking_id,) in booking_ids {
        enqueued += enqueue_booking_upsert(&state, &booking_id).await? as i64;
    }
    Ok(Json(ResyncResponse { enqueued }))
}

#[utoipa::path(
    get,
    path = "/api/v1/admin/caldav/status",
    tag = "caldav",
    responses((status = 200, body = CaldavStatusResponse))
)]
pub(crate) async fn caldav_status(
    State(state): State<AppState>,
    _admin: AdminUser,
) -> ApiResult<Json<CaldavStatusResponse>> {
    let counts: Vec<(String, i64)> =
        sqlx::query_as("SELECT status, COUNT(*) FROM caldav_sync_queue GROUP BY status")
            .fetch_all(&state.db)
            .await?;
    let count_for = |wanted: &str| {
        counts
            .iter()
            .find(|(status, _)| status == wanted)
            .map(|(_, count)| *count)
            .unwrap_or(0)
    };

    type ItemRow = (
        String,
        String,
        String,
        String,
        String,
        String,
        i64,
        Option<String>,
        Option<i64>,
        i64,
    );
    let rows: Vec<ItemRow> = sqlx::query_as(
        "SELECT q.id, q.calendar_id, c.name, q.ics_uid, q.action, q.status, q.attempts,
                q.last_error, q.last_attempt_at, q.updated_at
         FROM caldav_sync_queue q
         JOIN caldav_calendars c ON c.id = q.calendar_id
         ORDER BY q.updated_at DESC
         LIMIT ?",
    )
    .bind(STATUS_ITEM_LIMIT)
    .fetch_all(&state.db)
    .await?;

    let last_run = state.caldav_last_run.load(Ordering::Relaxed);
    Ok(Json(CaldavStatusResponse {
        pending: count_for("pending"),
        error: count_for("error"),
        synced: count_for("synced"),
        last_run_at: (last_run > 0).then_some(last_run),
        items: rows
            .into_iter()
            .map(
                |(
                    id,
                    calendar_id,
                    calendar_name,
                    ics_uid,
                    action,
                    status,
                    attempts,
                    last_error,
                    last_attempt_at,
                    updated_at,
                )| QueueItemView {
                    id,
                    calendar_id,
                    calendar_name,
                    ics_uid,
                    action,
                    status,
                    attempts,
                    last_error,
                    last_attempt_at,
                    updated_at,
                },
            )
            .collect(),
    }))
}

async fn sync_enabled(state: &AppState) -> ApiResult<bool> {
    let value = settings::get_setting(&state.db, settings::KEY_CALDAV_SYNC_ENABLED)
        .await?
        .unwrap_or_else(|| "1".into());
    Ok(truthy(&value))
}

async fn enabled_calendar_ids(state: &AppState) -> ApiResult<Vec<String>> {
    let rows: Vec<(String,)> = sqlx::query_as("SELECT id FROM caldav_calendars WHERE enabled = 1")
        .fetch_all(&state.db)
        .await?;
    Ok(rows.into_iter().map(|(id,)| id).collect())
}

/// Snapshot the booking as an ICS payload and enqueue an upsert for every
/// enabled calendar. Returns the number of queue rows written.
pub async fn enqueue_booking_upsert(state: &AppState, booking_id: &str) -> ApiResult<usize> {
    if !sync_enabled(state).await? {
        return Ok(0);
    }
    type BookingSnapshotRow = (String, i64, i64, i64, String, i64, String, String);
    let row: Option<BookingSnapshotRow> = sqlx::query_as(
        "SELECT b.ics_uid, b.start_ts, b.end_ts, b.sequence, b.comment, b.updated_at,
                COALESCE(t.name, s.name), u.display_name
         FROM bookings b
         LEFT JOIN tofinos t ON t.id = b.tofino_id
         LEFT JOIN servers s ON s.id = b.server_id
         JOIN users u ON u.id = b.user_id
         WHERE b.id = ?",
    )
    .bind(booking_id)
    .fetch_optional(&state.db)
    .await?;
    let Some((ics_uid, start_ts, end_ts, sequence, comment, updated_at, resource_name, user_name)) =
        row
    else {
        return Ok(0);
    };

    let template = settings::get_setting(&state.db, settings::KEY_CALDAV_EVENT_SUMMARY_TEMPLATE)
        .await?
        .unwrap_or_else(|| "{resource} — {user}".into());
    let summary = template
        .replace("{tofino}", &resource_name)
        .replace("{resource}", &resource_name)
        .replace("{user}", &user_name);
    let payload = ics::build_event(&ics::IcsEventInput {
        product_id: &state.config.caldav_product_id,
        uid: &ics_uid,
        summary: &summary,
        description: (!comment.is_empty()).then_some(comment.as_str()),
        start_ts,
        end_ts,
        sequence,
        dtstamp_ts: updated_at,
    });

    let calendar_ids = enabled_calendar_ids(state).await?;
    for calendar_id in &calendar_ids {
        enqueue_row(state, calendar_id, &ics_uid, "upsert", &payload).await?;
    }
    if !calendar_ids.is_empty() {
        state.caldav_notify.notify_one();
    }
    Ok(calendar_ids.len())
}

/// Enqueue a delete for every enabled calendar. The queue row survives the
/// booking-row removal because it only needs the ICS UID.
pub async fn enqueue_booking_delete(state: &AppState, ics_uid: &str) -> ApiResult<usize> {
    if !sync_enabled(state).await? {
        return Ok(0);
    }
    let calendar_ids = enabled_calendar_ids(state).await?;
    for calendar_id in &calendar_ids {
        enqueue_row(state, calendar_id, ics_uid, "delete", "").await?;
    }
    if !calendar_ids.is_empty() {
        state.caldav_notify.notify_one();
    }
    Ok(calendar_ids.len())
}

async fn enqueue_row(
    state: &AppState,
    calendar_id: &str,
    ics_uid: &str,
    action: &str,
    payload: &str,
) -> ApiResult<()> {
    let now = now_ts();
    sqlx::query(
        "INSERT INTO caldav_sync_queue
         (id, calendar_id, ics_uid, action, ics_payload, status, attempts, last_error,
          last_attempt_at, created_at, updated_at)
         VALUES (?, ?, ?, ?, ?, 'pending', 0, NULL, NULL, ?, ?)
         ON CONFLICT(calendar_id, ics_uid) DO UPDATE SET
             action = excluded.action,
             ics_payload = excluded.ics_payload,
             status = 'pending',
             attempts = 0,
             last_error = NULL,
             last_attempt_at = NULL,
             updated_at = excluded.updated_at",
    )
    .bind(Uuid::new_v4().to_string())
    .bind(calendar_id)
    .bind(ics_uid)
    .bind(action)
    .bind(payload)
    .bind(now)
    .bind(now)
    .execute(&state.db)
    .await?;
    Ok(())
}

/// Background worker: waken by `caldav_notify` or every 300 seconds.
pub async fn run_worker(state: AppState) {
    let mut interval = tokio::time::interval(WORKER_INTERVAL);
    interval.set_missed_tick_behavior(tokio::time::MissedTickBehavior::Delay);
    loop {
        tokio::select! {
            _ = state.caldav_notify.notified() => {}
            _ = interval.tick() => {}
        }
        if let Err(err) = process_queue_once(&state).await {
            tracing::warn!(?err, "CalDAV sync run failed");
        }
    }
}

#[derive(sqlx::FromRow)]
struct DueRow {
    id: String,
    ics_uid: String,
    action: String,
    ics_payload: String,
    attempts: i64,
    caldav_url: String,
    username: String,
    app_password: String,
}

/// Drain all currently-due queue rows once. Rows in error state respect the
/// exponential backoff (2^attempts * 30s) and are abandoned after 10 attempts.
pub async fn process_queue_once(state: &AppState) -> anyhow::Result<()> {
    let now = now_ts();
    state.caldav_last_run.store(now, Ordering::Relaxed);
    let rows: Vec<DueRow> = sqlx::query_as(
        "SELECT q.id, q.ics_uid, q.action, q.ics_payload, q.attempts,
                c.caldav_url, c.username, c.app_password
         FROM caldav_sync_queue q
         JOIN caldav_calendars c ON c.id = q.calendar_id
         WHERE c.enabled = 1
           AND (q.status = 'pending'
                OR (q.status = 'error' AND q.attempts < ?
                    AND (q.last_attempt_at IS NULL
                         OR q.last_attempt_at + (? * (1 << MIN(q.attempts, 20))) <= ?)))
         ORDER BY q.updated_at",
    )
    .bind(MAX_ATTEMPTS)
    .bind(BACKOFF_BASE_SECONDS)
    .bind(now)
    .fetch_all(&state.db)
    .await?;

    for row in rows {
        match attempt_sync(state, &row).await {
            Ok(()) => {
                sqlx::query(
                    "UPDATE caldav_sync_queue
                     SET status = 'synced', last_error = NULL, last_attempt_at = ?, updated_at = ?
                     WHERE id = ?",
                )
                .bind(now_ts())
                .bind(now_ts())
                .bind(&row.id)
                .execute(&state.db)
                .await?;
            }
            Err(message) => {
                tracing::warn!(
                    uid = %row.ics_uid,
                    action = %row.action,
                    attempts = row.attempts + 1,
                    %message,
                    "CalDAV sync attempt failed"
                );
                sqlx::query(
                    "UPDATE caldav_sync_queue
                     SET status = 'error', attempts = attempts + 1, last_error = ?,
                         last_attempt_at = ?, updated_at = ?
                     WHERE id = ?",
                )
                .bind(&message)
                .bind(now_ts())
                .bind(now_ts())
                .bind(&row.id)
                .execute(&state.db)
                .await?;
            }
        }
    }
    Ok(())
}

async fn attempt_sync(state: &AppState, row: &DueRow) -> Result<(), String> {
    let base = row.caldav_url.trim_end_matches('/');
    let url = format!("{base}/{}.ics", row.ics_uid);
    let request = match row.action.as_str() {
        "upsert" => state
            .http
            .put(&url)
            .header(
                reqwest::header::CONTENT_TYPE,
                "text/calendar; charset=utf-8",
            )
            .body(row.ics_payload.clone()),
        "delete" => state.http.delete(&url),
        other => return Err(format!("unknown queue action: {other}")),
    };
    let response = request
        .basic_auth(&row.username, Some(&row.app_password))
        .send()
        .await
        .map_err(|err| format!("request failed: {err}"))?;
    let status = response.status();
    if status.is_success() || (row.action == "delete" && status == reqwest::StatusCode::NOT_FOUND) {
        Ok(())
    } else {
        Err(format!("unexpected status {status}"))
    }
}
