mod common;

use base64::{Engine, engine::general_purpose::STANDARD};
use common::test_state;
use rsvp::{AppState, caldav, db::now_ts};
use uuid::Uuid;
use wiremock::{
    Mock, MockServer, ResponseTemplate,
    matchers::{header, method, path},
};

async fn insert_calendar(state: &AppState, url: &str, username: &str, password: &str) -> String {
    let id = Uuid::new_v4().to_string();
    let now = now_ts();
    sqlx::query(
        "INSERT INTO caldav_calendars (id, name, caldav_url, username, app_password, enabled,
                                       created_at, updated_at)
         VALUES (?, 'Test', ?, ?, ?, 1, ?, ?)",
    )
    .bind(&id)
    .bind(url)
    .bind(username)
    .bind(password)
    .bind(now)
    .bind(now)
    .execute(&state.db)
    .await
    .unwrap();
    id
}

async fn insert_queue_row(
    state: &AppState,
    calendar_id: &str,
    ics_uid: &str,
    action: &str,
    payload: &str,
) -> String {
    let id = Uuid::new_v4().to_string();
    let now = now_ts();
    sqlx::query(
        "INSERT INTO caldav_sync_queue
         (id, calendar_id, ics_uid, action, ics_payload, status, attempts, created_at, updated_at)
         VALUES (?, ?, ?, ?, ?, 'pending', 0, ?, ?)",
    )
    .bind(&id)
    .bind(calendar_id)
    .bind(ics_uid)
    .bind(action)
    .bind(payload)
    .bind(now)
    .bind(now)
    .execute(&state.db)
    .await
    .unwrap();
    id
}

async fn queue_row_state(state: &AppState, id: &str) -> (String, i64, Option<String>) {
    sqlx::query_as("SELECT status, attempts, last_error FROM caldav_sync_queue WHERE id = ?")
        .bind(id)
        .fetch_one(&state.db)
        .await
        .unwrap()
}

fn basic_auth_header(username: &str, password: &str) -> String {
    format!(
        "Basic {}",
        STANDARD.encode(format!("{username}:{password}"))
    )
}

#[tokio::test]
async fn worker_puts_ics_payload_with_basic_auth() {
    let state = test_state().await;
    let server = MockServer::start().await;
    let calendar_id = insert_calendar(&state, &server.uri(), "alice", "secret").await;

    let payload = "BEGIN:VCALENDAR\r\nEND:VCALENDAR\r\n";
    let row_id = insert_queue_row(
        &state,
        &calendar_id,
        "rsvp-abc@example.invalid",
        "upsert",
        payload,
    )
    .await;

    Mock::given(method("PUT"))
        .and(path("/rsvp-abc@example.invalid.ics"))
        .and(header(
            "authorization",
            basic_auth_header("alice", "secret"),
        ))
        .and(header("content-type", "text/calendar; charset=utf-8"))
        .respond_with(ResponseTemplate::new(201))
        .expect(1)
        .mount(&server)
        .await;

    caldav::process_queue_once(&state).await.unwrap();

    let (status, attempts, last_error) = queue_row_state(&state, &row_id).await;
    assert_eq!(status, "synced");
    assert_eq!(attempts, 0);
    assert!(last_error.is_none());

    let requests = server.received_requests().await.unwrap();
    assert_eq!(requests.len(), 1);
    assert_eq!(String::from_utf8_lossy(&requests[0].body), payload);
}

#[tokio::test]
async fn worker_treats_delete_404_as_success() {
    let state = test_state().await;
    let server = MockServer::start().await;
    let calendar_id = insert_calendar(&state, &server.uri(), "alice", "secret").await;
    let row_id = insert_queue_row(
        &state,
        &calendar_id,
        "rsvp-gone@example.invalid",
        "delete",
        "",
    )
    .await;

    Mock::given(method("DELETE"))
        .and(path("/rsvp-gone@example.invalid.ics"))
        .respond_with(ResponseTemplate::new(404))
        .expect(1)
        .mount(&server)
        .await;

    caldav::process_queue_once(&state).await.unwrap();

    let (status, attempts, _) = queue_row_state(&state, &row_id).await;
    assert_eq!(status, "synced");
    assert_eq!(attempts, 0);
}

#[tokio::test]
async fn worker_records_errors_and_backs_off() {
    let state = test_state().await;
    let server = MockServer::start().await;
    let calendar_id = insert_calendar(&state, &server.uri(), "alice", "wrong").await;
    let row_id = insert_queue_row(
        &state,
        &calendar_id,
        "rsvp-fail@example.invalid",
        "upsert",
        "BEGIN:VCALENDAR\r\nEND:VCALENDAR\r\n",
    )
    .await;

    Mock::given(method("PUT"))
        .and(path("/rsvp-fail@example.invalid.ics"))
        .respond_with(ResponseTemplate::new(500))
        .expect(1)
        .mount(&server)
        .await;

    caldav::process_queue_once(&state).await.unwrap();

    let (status, attempts, last_error) = queue_row_state(&state, &row_id).await;
    assert_eq!(status, "error");
    assert_eq!(attempts, 1);
    assert!(last_error.unwrap().contains("500"));

    // A second immediate run must respect the exponential backoff and not
    // retry yet (the mock's expect(1) also guards this on drop).
    caldav::process_queue_once(&state).await.unwrap();
    let (status, attempts, _) = queue_row_state(&state, &row_id).await;
    assert_eq!(status, "error");
    assert_eq!(attempts, 1);
}

#[tokio::test]
async fn disabled_calendars_are_skipped() {
    let state = test_state().await;
    let server = MockServer::start().await;
    let calendar_id = insert_calendar(&state, &server.uri(), "alice", "secret").await;
    sqlx::query("UPDATE caldav_calendars SET enabled = 0 WHERE id = ?")
        .bind(&calendar_id)
        .execute(&state.db)
        .await
        .unwrap();
    let row_id = insert_queue_row(
        &state,
        &calendar_id,
        "rsvp-x@example.invalid",
        "upsert",
        "X",
    )
    .await;

    caldav::process_queue_once(&state).await.unwrap();

    let (status, attempts, _) = queue_row_state(&state, &row_id).await;
    assert_eq!(status, "pending");
    assert_eq!(attempts, 0);
    assert!(server.received_requests().await.unwrap().is_empty());
}
