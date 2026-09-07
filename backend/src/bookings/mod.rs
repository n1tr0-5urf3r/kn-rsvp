use axum::{
    Json, Router,
    extract::{Path, Query, State},
    http::StatusCode,
    routing::{get, patch},
};
use serde::{Deserialize, Serialize};
use utoipa::{IntoParams, ToSchema};
use uuid::Uuid;

use crate::{
    AppState,
    auth::CurrentUser,
    caldav,
    db::now_ts,
    error::{ApiError, ApiResult},
    settings,
};

const HOUR_SECONDS: i64 = 3600;
const MINUTE_SECONDS: i64 = 60;
const DEFAULT_MAX_DURATION_HOURS: i64 = 14 * 24;

pub fn router() -> Router<AppState> {
    Router::new()
        .route("/bookings", get(list_bookings).post(create_booking))
        .route(
            "/bookings/{id}",
            patch(update_booking).delete(delete_booking),
        )
}

#[derive(Serialize, ToSchema)]
pub struct BookingView {
    pub id: String,
    pub resource_type: String,
    pub resource_id: String,
    pub resource_name: String,
    pub tofino_id: Option<String>,
    pub tofino_name: Option<String>,
    pub tofino_version: Option<i64>,
    pub server_id: Option<String>,
    pub server_name: Option<String>,
    pub user_id: String,
    pub user_display_name: String,
    pub start_ts: i64,
    pub end_ts: i64,
    pub comment: String,
    pub created_at: i64,
}

#[derive(Serialize, ToSchema)]
pub struct BookingsResponse {
    pub bookings: Vec<BookingView>,
}

#[derive(Deserialize, ToSchema)]
pub struct CreateBookingRequest {
    /// Set exactly one of `tofino_id` and `server_id`.
    pub tofino_id: Option<String>,
    pub server_id: Option<String>,
    pub start_ts: i64,
    pub end_ts: i64,
    pub comment: Option<String>,
}

#[derive(Deserialize, ToSchema)]
pub struct UpdateBookingRequest {
    pub start_ts: Option<i64>,
    pub end_ts: Option<i64>,
    pub comment: Option<String>,
}

#[derive(Deserialize, IntoParams)]
pub(crate) struct ListBookingsQuery {
    /// Only bookings ending after this unix timestamp.
    pub from: Option<i64>,
    /// Only bookings starting before this unix timestamp.
    pub to: Option<i64>,
    pub tofino_id: Option<String>,
    pub server_id: Option<String>,
}

#[derive(sqlx::FromRow)]
struct BookingRow {
    id: String,
    tofino_id: Option<String>,
    tofino_name: Option<String>,
    tofino_version: Option<i64>,
    server_id: Option<String>,
    server_name: Option<String>,
    user_id: String,
    user_display_name: String,
    start_ts: i64,
    end_ts: i64,
    comment: String,
    created_at: i64,
}

type EditableBookingRow = (Option<String>, Option<String>, String, i64, i64, String);

fn booking_view(row: BookingRow) -> BookingView {
    let (resource_type, resource_id, resource_name) =
        if let (Some(id), Some(name)) = (&row.tofino_id, &row.tofino_name) {
            ("tofino", id.clone(), name.clone())
        } else {
            (
                "server",
                row.server_id.clone().unwrap_or_default(),
                row.server_name.clone().unwrap_or_default(),
            )
        };
    BookingView {
        id: row.id,
        resource_type: resource_type.into(),
        resource_id,
        resource_name,
        tofino_id: row.tofino_id,
        tofino_name: row.tofino_name,
        tofino_version: row.tofino_version,
        server_id: row.server_id,
        server_name: row.server_name,
        user_id: row.user_id,
        user_display_name: row.user_display_name,
        start_ts: row.start_ts,
        end_ts: row.end_ts,
        comment: row.comment,
        created_at: row.created_at,
    }
}

async fn load_booking_view(state: &AppState, id: &str) -> ApiResult<BookingView> {
    let row: Option<BookingRow> = sqlx::query_as(
        "SELECT b.id, b.tofino_id, t.name AS tofino_name, t.version AS tofino_version,
                b.server_id, s.name AS server_name, b.user_id,
                u.display_name AS user_display_name, b.start_ts, b.end_ts, b.comment,
                b.created_at
         FROM bookings b
         LEFT JOIN tofinos t ON t.id = b.tofino_id
         LEFT JOIN servers s ON s.id = b.server_id
         JOIN users u ON u.id = b.user_id
         WHERE b.id = ?",
    )
    .bind(id)
    .fetch_optional(&state.db)
    .await?;
    row.map(booking_view).ok_or(ApiError::NotFound)
}

#[utoipa::path(
    get,
    path = "/api/v1/bookings",
    tag = "bookings",
    params(ListBookingsQuery),
    responses((status = 200, body = BookingsResponse))
)]
pub(crate) async fn list_bookings(
    State(state): State<AppState>,
    _user: CurrentUser,
    Query(query): Query<ListBookingsQuery>,
) -> ApiResult<Json<BookingsResponse>> {
    let rows: Vec<BookingRow> = sqlx::query_as(
        "SELECT b.id, b.tofino_id, t.name AS tofino_name, t.version AS tofino_version,
                b.server_id, s.name AS server_name, b.user_id,
                u.display_name AS user_display_name, b.start_ts, b.end_ts, b.comment,
                b.created_at
         FROM bookings b
         LEFT JOIN tofinos t ON t.id = b.tofino_id
         LEFT JOIN servers s ON s.id = b.server_id
         JOIN users u ON u.id = b.user_id
         WHERE (? IS NULL OR b.tofino_id = ?)
           AND (? IS NULL OR b.server_id = ?)
           AND (? IS NULL OR b.end_ts > ?)
           AND (? IS NULL OR b.start_ts < ?)
         ORDER BY b.start_ts",
    )
    .bind(&query.tofino_id)
    .bind(&query.tofino_id)
    .bind(&query.server_id)
    .bind(&query.server_id)
    .bind(query.from)
    .bind(query.from)
    .bind(query.to)
    .bind(query.to)
    .fetch_all(&state.db)
    .await?;
    Ok(Json(BookingsResponse {
        bookings: rows.into_iter().map(booking_view).collect(),
    }))
}

#[utoipa::path(
    post,
    path = "/api/v1/bookings",
    tag = "bookings",
    request_body = CreateBookingRequest,
    responses(
        (status = 201, body = BookingView),
        (status = 400, description = "Invalid alignment, range, or duration", body = crate::error::ErrorResponse),
        (status = 409, description = "Overlaps existing booking", body = crate::error::ErrorResponse)
    )
)]
pub(crate) async fn create_booking(
    State(state): State<AppState>,
    user: CurrentUser,
    Json(input): Json<CreateBookingRequest>,
) -> ApiResult<(StatusCode, Json<BookingView>)> {
    let max_duration = max_booking_duration_seconds(&state).await?;
    validate_slot(input.start_ts, input.end_ts, max_duration)?;
    validate_start_not_in_past(input.start_ts, now_ts())?;
    let (tofino_id, server_id) = validate_resource_ids(input.tofino_id, input.server_id)?;
    if let Some(tofino_id) = &tofino_id {
        let tofino: Option<(String,)> =
            sqlx::query_as("SELECT id FROM tofinos WHERE id = ? AND active = 1")
                .bind(tofino_id)
                .fetch_optional(&state.db)
                .await?;
        tofino.ok_or(ApiError::NotFound)?;
    }
    if let Some(server_id) = &server_id {
        let server: Option<(String,)> =
            sqlx::query_as("SELECT id FROM servers WHERE id = ? AND reservable = 1")
                .bind(server_id)
                .fetch_optional(&state.db)
                .await?;
        server.ok_or(ApiError::NotFound)?;
    }

    let id = Uuid::new_v4().to_string();
    let ics_uid = format!("rsvp-{id}@{}", state.config.caldav_uid_domain);
    let now = now_ts();

    let mut tx = state.db.begin_with("BEGIN IMMEDIATE").await?;
    ensure_no_overlap(
        &mut tx,
        tofino_id.as_deref(),
        server_id.as_deref(),
        None,
        input.start_ts,
        input.end_ts,
    )
    .await?;
    sqlx::query(
        "INSERT INTO bookings (id, tofino_id, server_id, user_id, start_ts, end_ts,
                               comment, ics_uid, sequence, created_at, updated_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, 0, ?, ?)",
    )
    .bind(&id)
    .bind(&tofino_id)
    .bind(&server_id)
    .bind(&user.id)
    .bind(input.start_ts)
    .bind(input.end_ts)
    .bind(input.comment.as_deref().unwrap_or(""))
    .bind(&ics_uid)
    .bind(now)
    .bind(now)
    .execute(&mut *tx)
    .await?;
    tx.commit().await?;

    caldav::enqueue_booking_upsert(&state, &id).await?;
    Ok((
        StatusCode::CREATED,
        Json(load_booking_view(&state, &id).await?),
    ))
}

#[utoipa::path(
    patch,
    path = "/api/v1/bookings/{id}",
    tag = "bookings",
    params(("id" = String, Path)),
    request_body = UpdateBookingRequest,
    responses(
        (status = 200, body = BookingView),
        (status = 409, description = "Overlaps existing booking", body = crate::error::ErrorResponse)
    )
)]
pub(crate) async fn update_booking(
    State(state): State<AppState>,
    user: CurrentUser,
    Path(id): Path<String>,
    Json(input): Json<UpdateBookingRequest>,
) -> ApiResult<Json<BookingView>> {
    let row: Option<EditableBookingRow> = sqlx::query_as(
        "SELECT tofino_id, server_id, user_id, start_ts, end_ts, comment
         FROM bookings WHERE id = ?",
    )
    .bind(&id)
    .fetch_optional(&state.db)
    .await?;
    let (tofino_id, server_id, owner_id, start_ts, end_ts, comment) =
        row.ok_or(ApiError::NotFound)?;
    if owner_id != user.id && !user.is_admin {
        return Err(ApiError::Forbidden);
    }

    let start_ts = input.start_ts.unwrap_or(start_ts);
    let end_ts = input.end_ts.unwrap_or(end_ts);
    let comment = input.comment.unwrap_or(comment);
    let max_duration = max_booking_duration_seconds(&state).await?;
    validate_slot(start_ts, end_ts, max_duration)?;
    if input.start_ts.is_some() {
        validate_start_not_in_past(start_ts, now_ts())?;
    }

    let mut tx = state.db.begin_with("BEGIN IMMEDIATE").await?;
    ensure_no_overlap(
        &mut tx,
        tofino_id.as_deref(),
        server_id.as_deref(),
        Some(&id),
        start_ts,
        end_ts,
    )
    .await?;
    sqlx::query(
        "UPDATE bookings SET start_ts = ?, end_ts = ?, comment = ?, sequence = sequence + 1,
                             updated_at = ? WHERE id = ?",
    )
    .bind(start_ts)
    .bind(end_ts)
    .bind(&comment)
    .bind(now_ts())
    .bind(&id)
    .execute(&mut *tx)
    .await?;
    tx.commit().await?;

    caldav::enqueue_booking_upsert(&state, &id).await?;
    Ok(Json(load_booking_view(&state, &id).await?))
}

#[utoipa::path(
    delete,
    path = "/api/v1/bookings/{id}",
    tag = "bookings",
    params(("id" = String, Path)),
    responses((status = 204, description = "Booking deleted"))
)]
pub(crate) async fn delete_booking(
    State(state): State<AppState>,
    user: CurrentUser,
    Path(id): Path<String>,
) -> ApiResult<StatusCode> {
    let row: Option<(String, String)> =
        sqlx::query_as("SELECT user_id, ics_uid FROM bookings WHERE id = ?")
            .bind(&id)
            .fetch_optional(&state.db)
            .await?;
    let (owner_id, ics_uid) = row.ok_or(ApiError::NotFound)?;
    if owner_id != user.id && !user.is_admin {
        return Err(ApiError::Forbidden);
    }

    sqlx::query("DELETE FROM bookings WHERE id = ?")
        .bind(&id)
        .execute(&state.db)
        .await?;
    caldav::enqueue_booking_delete(&state, &ics_uid).await?;
    Ok(StatusCode::NO_CONTENT)
}

async fn ensure_no_overlap(
    tx: &mut sqlx::Transaction<'_, sqlx::Sqlite>,
    tofino_id: Option<&str>,
    server_id: Option<&str>,
    exclude_id: Option<&str>,
    start_ts: i64,
    end_ts: i64,
) -> ApiResult<()> {
    let (count,): (i64,) = sqlx::query_as(
        "SELECT COUNT(*) FROM bookings
         WHERE ((? IS NOT NULL AND tofino_id = ?) OR
                (? IS NOT NULL AND server_id = ?))
           AND (? IS NULL OR id != ?) AND start_ts < ? AND end_ts > ?",
    )
    .bind(tofino_id)
    .bind(tofino_id)
    .bind(server_id)
    .bind(server_id)
    .bind(exclude_id)
    .bind(exclude_id)
    .bind(end_ts)
    .bind(start_ts)
    .fetch_one(&mut **tx)
    .await?;
    if count > 0 {
        return Err(ApiError::Conflict("overlaps existing booking".into()));
    }
    Ok(())
}

fn validate_resource_ids(
    tofino_id: Option<String>,
    server_id: Option<String>,
) -> ApiResult<(Option<String>, Option<String>)> {
    let tofino_id = tofino_id.filter(|id| !id.trim().is_empty());
    let server_id = server_id.filter(|id| !id.trim().is_empty());
    if tofino_id.is_some() == server_id.is_some() {
        return Err(ApiError::BadRequest(
            "provide exactly one of tofino_id or server_id".into(),
        ));
    }
    Ok((tofino_id, server_id))
}

async fn max_booking_duration_seconds(state: &AppState) -> ApiResult<i64> {
    let hours = settings::get_setting(&state.db, settings::KEY_MAX_BOOKING_DURATION_HOURS)
        .await?
        .and_then(|value| value.trim().parse::<i64>().ok())
        .filter(|value| *value > 0)
        .unwrap_or(DEFAULT_MAX_DURATION_HOURS);
    Ok(hours * HOUR_SECONDS)
}

/// Booking starts must be hour-aligned and ends minute-aligned. Intervals must
/// be non-empty and at most `max_duration` seconds long.
fn validate_slot(start_ts: i64, end_ts: i64, max_duration: i64) -> ApiResult<()> {
    if start_ts % HOUR_SECONDS != 0 || end_ts % MINUTE_SECONDS != 0 {
        return Err(ApiError::BadRequest(
            "start_ts must be aligned to a full hour and end_ts to a full minute".into(),
        ));
    }
    if end_ts <= start_ts {
        return Err(ApiError::BadRequest("end_ts must be after start_ts".into()));
    }
    if end_ts - start_ts > max_duration {
        return Err(ApiError::BadRequest(format!(
            "booking exceeds the maximum duration of {} hours",
            max_duration / HOUR_SECONDS
        )));
    }
    Ok(())
}

fn validate_start_not_in_past(start_ts: i64, now: i64) -> ApiResult<()> {
    let current_hour_start = now.div_euclid(HOUR_SECONDS) * HOUR_SECONDS;
    if start_ts < current_hour_start {
        return Err(ApiError::BadRequest(
            "start_ts must not be in the past".into(),
        ));
    }
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;

    const MAX: i64 = 14 * 24 * HOUR_SECONDS;

    #[test]
    fn hour_aligned_starts_and_minute_aligned_ends_are_accepted() {
        assert!(validate_slot(0, HOUR_SECONDS, MAX).is_ok());
        assert!(validate_slot(0, HOUR_SECONDS + 30 * MINUTE_SECONDS, MAX).is_ok());
        assert!(validate_slot(1_753_401_600, 1_753_405_200, MAX).is_ok());
    }

    #[test]
    fn misaligned_slots_are_rejected() {
        assert!(validate_slot(30, HOUR_SECONDS, MAX).is_err());
        assert!(validate_slot(0, HOUR_SECONDS + 1, MAX).is_err());
        assert!(validate_slot(1800, 5400, MAX).is_err());
    }

    #[test]
    fn empty_or_reversed_slots_are_rejected() {
        assert!(validate_slot(HOUR_SECONDS, HOUR_SECONDS, MAX).is_err());
        assert!(validate_slot(2 * HOUR_SECONDS, HOUR_SECONDS, MAX).is_err());
    }

    #[test]
    fn slots_longer_than_the_maximum_are_rejected() {
        assert!(validate_slot(0, MAX, MAX).is_ok());
        assert!(validate_slot(0, MAX + HOUR_SECONDS, MAX).is_err());
    }

    #[test]
    fn current_hour_starts_are_accepted_but_earlier_hours_are_rejected() {
        let now = 10 * HOUR_SECONDS + 3 * 60;
        assert!(validate_start_not_in_past(9 * HOUR_SECONDS, now).is_err());
        assert!(validate_start_not_in_past(10 * HOUR_SECONDS, now).is_ok());
        assert!(validate_start_not_in_past(11 * HOUR_SECONDS, now).is_ok());
    }
}
