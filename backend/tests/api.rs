mod common;

use axum::http::StatusCode;
use common::{login, request, test_app};
use serde_json::{Value, json};

const HOUR: i64 = 3600;

fn server_by_id<'a>(body: &'a Value, id: &str) -> &'a Value {
    body["servers"]
        .as_array()
        .unwrap()
        .iter()
        .find(|server| server["id"] == id)
        .unwrap()
}

#[tokio::test]
async fn dev_login_session_flow_round_trips_through_auth_me() {
    let (_state, app) = test_app().await;

    // Unauthenticated: user is null.
    let (status, body) = request(&app, "GET", "/api/v1/auth/me", None, None).await;
    assert_eq!(status, StatusCode::OK);
    assert!(body["user"].is_null());

    let cookie = login(&app, "alice", false).await;
    let (status, body) = request(&app, "GET", "/api/v1/auth/me", Some(&cookie), None).await;
    assert_eq!(status, StatusCode::OK);
    assert_eq!(body["user"]["username"], "alice");
    assert_eq!(body["user"]["is_admin"], false);

    // Logout revokes the session.
    let (status, _) = request(&app, "POST", "/api/v1/auth/logout", Some(&cookie), None).await;
    assert_eq!(status, StatusCode::NO_CONTENT);
    let (_, body) = request(&app, "GET", "/api/v1/auth/me", Some(&cookie), None).await;
    assert!(body["user"].is_null());
}

#[tokio::test]
async fn dev_login_returns_404_when_dev_mode_is_disabled() {
    let mut state = common::test_state().await;
    state.config.auth_dev_mode = false;
    let app = rsvp::build_app(state).await.unwrap();
    let (status, _) = request(&app, "GET", "/api/v1/auth/dev-login?name=x", None, None).await;
    assert_eq!(status, StatusCode::NOT_FOUND);
}

#[tokio::test]
async fn health_reports_ok_and_version() {
    let (_state, app) = test_app().await;
    let (status, body) = request(&app, "GET", "/api/v1/health", None, None).await;
    assert_eq!(status, StatusCode::OK);
    assert_eq!(body["status"], "ok");
    assert_eq!(body["version"], env!("CARGO_PKG_VERSION"));
}

#[tokio::test]
async fn public_config_exposes_branding_without_authentication() {
    let (mut state, _) = test_app().await;
    state.config.app_name = "Example Lab".into();
    state.config.app_subtitle = "Reservations".into();
    state.config.app_tagline = "Share the hardware.".into();
    state.config.app_logo_url = Some("/branding/logo.png".into());
    let app = rsvp::build_app(state).await.unwrap();

    let (status, body) = request(&app, "GET", "/api/v1/config", None, None).await;
    assert_eq!(status, StatusCode::OK);
    assert_eq!(body["app_name"], "Example Lab");
    assert_eq!(body["app_subtitle"], "Reservations");
    assert_eq!(body["app_tagline"], "Share the hardware.");
    assert_eq!(body["logo_url"], "/branding/logo.png");
    assert_eq!(
        body["repository_url"],
        "https://github.com/n1tr0-5urf3r/kn-rsvp"
    );
}

#[tokio::test]
async fn booking_create_rejects_overlap_but_allows_adjacent() {
    let (_state, app) = test_app().await;
    let admin = login(&app, "admin", true).await;
    let user = login(&app, "bob", false).await;

    let (status, tofino) = request(
        &app,
        "POST",
        "/api/v1/admin/tofinos",
        Some(&admin),
        Some(json!({"name": "tofino-1", "version": 1})),
    )
    .await;
    assert_eq!(status, StatusCode::CREATED);
    let tofino_id = tofino["id"].as_str().unwrap().to_string();

    // A valid, hour-aligned interval is still rejected once its start passed.
    let past_start = (rsvp::db::now_ts() / HOUR - 2) * HOUR;
    let (status, body) = request(
        &app,
        "POST",
        "/api/v1/bookings",
        Some(&user),
        Some(json!({
            "tofino_id": tofino_id,
            "start_ts": past_start,
            "end_ts": past_start + HOUR
        })),
    )
    .await;
    assert_eq!(status, StatusCode::BAD_REQUEST);
    assert_eq!(body["error"], "start_ts must not be in the past");

    let start = 1_000_000 * HOUR;
    let (status, booking) = request(
        &app,
        "POST",
        "/api/v1/bookings",
        Some(&user),
        Some(json!({
            "tofino_id": tofino_id,
            "start_ts": start,
            "end_ts": start + 2 * HOUR,
            "comment": "experiment"
        })),
    )
    .await;
    assert_eq!(status, StatusCode::CREATED);
    assert_eq!(booking["tofino_name"], "tofino-1");
    assert_eq!(booking["user_display_name"], "bob");

    // Overlapping booking is rejected with the exact contract error.
    let (status, body) = request(
        &app,
        "POST",
        "/api/v1/bookings",
        Some(&user),
        Some(json!({
            "tofino_id": tofino_id,
            "start_ts": start + HOUR,
            "end_ts": start + 3 * HOUR
        })),
    )
    .await;
    assert_eq!(status, StatusCode::CONFLICT);
    assert_eq!(body["error"], "overlaps existing booking");

    // Adjacent booking (end == start) succeeds.
    let (status, _) = request(
        &app,
        "POST",
        "/api/v1/bookings",
        Some(&user),
        Some(json!({
            "tofino_id": tofino_id,
            "start_ts": start + 2 * HOUR,
            "end_ts": start + 3 * HOUR
        })),
    )
    .await;
    assert_eq!(status, StatusCode::CREATED);

    // Misaligned timestamps are a 400.
    let (status, _) = request(
        &app,
        "POST",
        "/api/v1/bookings",
        Some(&user),
        Some(json!({
            "tofino_id": tofino_id,
            "start_ts": start + 3 * HOUR + 60,
            "end_ts": start + 4 * HOUR
        })),
    )
    .await;
    assert_eq!(status, StatusCode::BAD_REQUEST);

    // Listing with a window returns the bookings.
    let (status, body) = request(
        &app,
        "GET",
        &format!(
            "/api/v1/bookings?from={}&to={}&tofino_id={}",
            start,
            start + 4 * HOUR,
            tofino_id
        ),
        Some(&user),
        None,
    )
    .await;
    assert_eq!(status, StatusCode::OK);
    assert_eq!(body["bookings"].as_array().unwrap().len(), 2);

    // Starts stay hour-aligned, but the explicit end may include minutes.
    let (status, booking) = request(
        &app,
        "POST",
        "/api/v1/bookings",
        Some(&user),
        Some(json!({
            "tofino_id": tofino_id,
            "start_ts": start + 4 * HOUR,
            "end_ts": start + 5 * HOUR + 30 * 60
        })),
    )
    .await;
    assert_eq!(status, StatusCode::CREATED);
    assert_eq!(booking["end_ts"], start + 5 * HOUR + 30 * 60);
}

#[tokio::test]
async fn booking_update_and_delete_enforce_ownership() {
    let (_state, app) = test_app().await;
    let admin = login(&app, "admin", true).await;
    let owner = login(&app, "owner", false).await;
    let other = login(&app, "other", false).await;

    let (_, tofino) = request(
        &app,
        "POST",
        "/api/v1/admin/tofinos",
        Some(&admin),
        Some(json!({"name": "tofino-x", "version": 2})),
    )
    .await;
    let tofino_id = tofino["id"].as_str().unwrap().to_string();

    let start = 2_000_000 * HOUR;
    let (_, booking) = request(
        &app,
        "POST",
        "/api/v1/bookings",
        Some(&owner),
        Some(json!({"tofino_id": tofino_id, "start_ts": start, "end_ts": start + HOUR})),
    )
    .await;
    let booking_id = booking["id"].as_str().unwrap().to_string();

    // Non-owner cannot modify or delete.
    let (status, _) = request(
        &app,
        "PATCH",
        &format!("/api/v1/bookings/{booking_id}"),
        Some(&other),
        Some(json!({"comment": "stolen"})),
    )
    .await;
    assert_eq!(status, StatusCode::FORBIDDEN);
    let (status, _) = request(
        &app,
        "DELETE",
        &format!("/api/v1/bookings/{booking_id}"),
        Some(&other),
        None,
    )
    .await;
    assert_eq!(status, StatusCode::FORBIDDEN);

    // Owner can update; admin can delete.
    let (status, updated) = request(
        &app,
        "PATCH",
        &format!("/api/v1/bookings/{booking_id}"),
        Some(&owner),
        Some(json!({"end_ts": start + 2 * HOUR, "comment": "longer"})),
    )
    .await;
    assert_eq!(status, StatusCode::OK);
    assert_eq!(updated["end_ts"], start + 2 * HOUR);
    assert_eq!(updated["comment"], "longer");

    let (status, _) = request(
        &app,
        "DELETE",
        &format!("/api/v1/bookings/{booking_id}"),
        Some(&admin),
        None,
    )
    .await;
    assert_eq!(status, StatusCode::NO_CONTENT);
}

#[tokio::test]
async fn admin_routes_reject_non_admins_and_unauthenticated() {
    let (_state, app) = test_app().await;
    let user = login(&app, "pleb", false).await;

    for (method, uri) in [
        ("POST", "/api/v1/admin/servers"),
        ("GET", "/api/v1/admin/users"),
        ("GET", "/api/v1/admin/settings"),
        ("GET", "/api/v1/admin/caldav/calendars"),
        ("GET", "/api/v1/admin/caldav/status"),
    ] {
        let body = (method == "POST").then(|| json!({"name": "x"}));
        let (status, _) = request(&app, method, uri, Some(&user), body.clone()).await;
        assert_eq!(status, StatusCode::FORBIDDEN, "{method} {uri}");
        let (status, _) = request(&app, method, uri, None, body).await;
        assert_eq!(status, StatusCode::UNAUTHORIZED, "{method} {uri}");
    }
}

#[tokio::test]
async fn nic_claim_upsert_and_release_round_trip() {
    let (_state, app) = test_app().await;
    let admin = login(&app, "admin", true).await;
    let bob = login(&app, "bob", false).await;

    let (status, server) = request(
        &app,
        "POST",
        "/api/v1/admin/servers",
        Some(&admin),
        Some(json!({"name": "pve-1", "description": "proxmox node"})),
    )
    .await;
    assert_eq!(status, StatusCode::CREATED);
    let server_id = server["id"].as_str().unwrap().to_string();

    let (status, nic) = request(
        &app,
        "POST",
        &format!("/api/v1/admin/servers/{server_id}/nics"),
        Some(&admin),
        Some(json!({
            "name": "ens1f0",
            "pci_address": "0000:17:00.0",
            "nic_type": "ConnectX-5",
            "speed_gbps": 100
        })),
    )
    .await;
    assert_eq!(status, StatusCode::CREATED);
    let nic_id = nic["id"].as_str().unwrap().to_string();

    // Find bob's user id via the admin users list.
    let (_, users) = request(&app, "GET", "/api/v1/admin/users", Some(&admin), None).await;
    let bob_id = users["users"]
        .as_array()
        .unwrap()
        .iter()
        .find(|user| user["username"] == "bob")
        .unwrap()["id"]
        .as_str()
        .unwrap()
        .to_string();

    // Upsert the claim twice (second call overwrites).
    let (status, claim) = request(
        &app,
        "PUT",
        &format!("/api/v1/admin/nics/{nic_id}/claim"),
        Some(&admin),
        Some(json!({"user_id": bob_id, "connected_to": "sw-1", "cable_label": "C-42"})),
    )
    .await;
    assert_eq!(status, StatusCode::OK);
    assert_eq!(claim["user_display_name"], "bob");
    let (status, claim) = request(
        &app,
        "PUT",
        &format!("/api/v1/admin/nics/{nic_id}/claim"),
        Some(&admin),
        Some(json!({"user_id": bob_id, "connected_to": "sw-2", "comment": "moved"})),
    )
    .await;
    assert_eq!(status, StatusCode::OK);
    assert_eq!(claim["connected_to"], "sw-2");

    // Visible to any user via GET /servers.
    let (status, servers) = request(&app, "GET", "/api/v1/servers", Some(&bob), None).await;
    assert_eq!(status, StatusCode::OK);
    let nic = &server_by_id(&servers, &server_id)["nics"][0];
    assert_eq!(nic["claim"]["connected_to"], "sw-2");
    assert_eq!(nic["claim"]["user_id"], bob_id);

    // Release.
    let (status, _) = request(
        &app,
        "DELETE",
        &format!("/api/v1/admin/nics/{nic_id}/claim"),
        Some(&admin),
        None,
    )
    .await;
    assert_eq!(status, StatusCode::NO_CONTENT);
    let (_, servers) = request(&app, "GET", "/api/v1/servers", Some(&bob), None).await;
    assert!(server_by_id(&servers, &server_id)["nics"][0]["claim"].is_null());
}

#[tokio::test]
async fn nic_claim_accepts_a_free_form_assignee_without_a_login() {
    let (_state, app) = test_app().await;
    let admin = login(&app, "admin", true).await;

    let (_, server) = request(
        &app,
        "POST",
        "/api/v1/admin/servers",
        Some(&admin),
        Some(json!({"name": "guest-host"})),
    )
    .await;
    let server_id = server["id"].as_str().unwrap();
    let (_, nic) = request(
        &app,
        "POST",
        &format!("/api/v1/admin/servers/{server_id}/nics"),
        Some(&admin),
        Some(json!({
            "name": "eno1",
            "pci_address": "0000:04:00.0",
            "nic_type": "Intel X710",
            "speed_gbps": 10
        })),
    )
    .await;
    let nic_id = nic["id"].as_str().unwrap();

    let (status, claim) = request(
        &app,
        "PUT",
        &format!("/api/v1/admin/nics/{nic_id}/claim"),
        Some(&admin),
        Some(json!({
            "assignee_name": "P4 practical course",
            "comment": "Guests do not have RSVP accounts"
        })),
    )
    .await;
    assert_eq!(status, StatusCode::OK);
    assert!(claim["user_id"].is_null());
    assert_eq!(claim["user_display_name"], "P4 practical course");

    let (_, servers) = request(&app, "GET", "/api/v1/servers", Some(&admin), None).await;
    let listed = &server_by_id(&servers, server_id)["nics"][0]["claim"];
    assert!(listed["user_id"].is_null());
    assert_eq!(listed["user_display_name"], "P4 practical course");

    // An owner is optional: without one the row only documents the cable.
    let (status, claim) = request(
        &app,
        "PUT",
        &format!("/api/v1/admin/nics/{nic_id}/claim"),
        Some(&admin),
        Some(json!({"assignee_name": "  ", "cable_label": "C-9"})),
    )
    .await;
    assert_eq!(status, StatusCode::OK);
    assert!(claim["user_id"].is_null());
    assert_eq!(claim["user_display_name"], "");
    assert_eq!(claim["cable_label"], "C-9");
}

#[tokio::test]
async fn reservable_server_can_be_booked_by_regular_users() {
    let (_state, app) = test_app().await;
    let admin = login(&app, "admin", true).await;
    let alice = login(&app, "alice", false).await;
    let bob = login(&app, "bob", false).await;

    let (status, server) = request(
        &app,
        "POST",
        "/api/v1/admin/servers",
        Some(&admin),
        Some(json!({"name": "Compute 01", "reservable": true})),
    )
    .await;
    assert_eq!(status, StatusCode::CREATED);
    assert_eq!(server["reservable"], true);
    let server_id = server["id"].as_str().unwrap().to_string();
    let start = 3_000_000 * HOUR;

    let (status, booking) = request(
        &app,
        "POST",
        "/api/v1/bookings",
        Some(&alice),
        Some(json!({
            "server_id": server_id,
            "start_ts": start,
            "end_ts": start + 2 * HOUR,
            "comment": "bare-metal experiment"
        })),
    )
    .await;
    assert_eq!(status, StatusCode::CREATED);
    assert_eq!(booking["resource_type"], "server");
    assert_eq!(booking["resource_name"], "Compute 01");
    assert_eq!(booking["server_id"], server_id);
    assert!(booking["tofino_id"].is_null());

    let (status, body) = request(
        &app,
        "POST",
        "/api/v1/bookings",
        Some(&bob),
        Some(json!({
            "server_id": server_id,
            "start_ts": start + HOUR,
            "end_ts": start + 3 * HOUR
        })),
    )
    .await;
    assert_eq!(status, StatusCode::CONFLICT);
    assert_eq!(body["error"], "overlaps existing booking");

    let (status, body) = request(
        &app,
        "GET",
        &format!(
            "/api/v1/bookings?server_id={server_id}&from={start}&to={}",
            start + 3 * HOUR
        ),
        Some(&bob),
        None,
    )
    .await;
    assert_eq!(status, StatusCode::OK);
    assert_eq!(body["bookings"].as_array().unwrap().len(), 1);

    let (status, body) = request(
        &app,
        "PATCH",
        &format!("/api/v1/admin/servers/{server_id}"),
        Some(&admin),
        Some(json!({"reservable": false})),
    )
    .await;
    assert_eq!(status, StatusCode::CONFLICT);
    assert!(body["error"].as_str().unwrap().contains("future bookings"));
}

#[tokio::test]
async fn inactive_tofinos_are_hidden_from_non_admins() {
    let (_state, app) = test_app().await;
    let admin = login(&app, "admin", true).await;
    let user = login(&app, "user", false).await;

    let (_, tofino) = request(
        &app,
        "POST",
        "/api/v1/admin/tofinos",
        Some(&admin),
        Some(json!({"name": "hidden", "version": 1, "active": false})),
    )
    .await;
    assert!(tofino["id"].is_string());

    let (_, body) = request(&app, "GET", "/api/v1/tofinos", Some(&user), None).await;
    assert!(body["tofinos"].as_array().unwrap().is_empty());
    let (_, body) = request(&app, "GET", "/api/v1/tofinos", Some(&admin), None).await;
    assert_eq!(body["tofinos"].as_array().unwrap().len(), 1);
}

#[tokio::test]
async fn caldav_calendar_crud_never_returns_password() {
    let (_state, app) = test_app().await;
    let admin = login(&app, "admin", true).await;

    let (status, calendar) = request(
        &app,
        "POST",
        "/api/v1/admin/caldav/calendars",
        Some(&admin),
        Some(json!({
            "name": "Testbed",
            "caldav_url": "https://cloud.example.org/remote.php/dav/calendars/kn/testbed",
            "username": "kn",
            "app_password": "super-secret"
        })),
    )
    .await;
    assert_eq!(status, StatusCode::CREATED);
    assert_eq!(calendar["has_password"], true);
    assert!(calendar.get("app_password").is_none());
    let calendar_id = calendar["id"].as_str().unwrap().to_string();

    // PATCH with empty password keeps the stored one.
    let (status, updated) = request(
        &app,
        "PATCH",
        &format!("/api/v1/admin/caldav/calendars/{calendar_id}"),
        Some(&admin),
        Some(json!({"name": "Renamed", "app_password": ""})),
    )
    .await;
    assert_eq!(status, StatusCode::OK);
    assert_eq!(updated["name"], "Renamed");
    assert_eq!(updated["has_password"], true);
    assert!(updated.get("app_password").is_none());

    let (status, _) = request(
        &app,
        "DELETE",
        &format!("/api/v1/admin/caldav/calendars/{calendar_id}"),
        Some(&admin),
        None,
    )
    .await;
    assert_eq!(status, StatusCode::NO_CONTENT);
}

#[tokio::test]
async fn tofino_with_future_bookings_cannot_be_deleted() {
    let (_state, app) = test_app().await;
    let admin = login(&app, "admin", true).await;

    let (_, tofino) = request(
        &app,
        "POST",
        "/api/v1/admin/tofinos",
        Some(&admin),
        Some(json!({"name": "busy", "version": 1})),
    )
    .await;
    let tofino_id = tofino["id"].as_str().unwrap().to_string();

    // Booking far in the future.
    let start = ((rsvp::db::now_ts() / HOUR) + 100) * HOUR;
    let (status, _) = request(
        &app,
        "POST",
        "/api/v1/bookings",
        Some(&admin),
        Some(json!({"tofino_id": tofino_id, "start_ts": start, "end_ts": start + HOUR})),
    )
    .await;
    assert_eq!(status, StatusCode::CREATED);

    let (status, _) = request(
        &app,
        "DELETE",
        &format!("/api/v1/admin/tofinos/{tofino_id}"),
        Some(&admin),
        None,
    )
    .await;
    assert_eq!(status, StatusCode::CONFLICT);
}

/// Two sections of a tofino.md-shaped document, trimmed to a few ports.
const PORT_DOC: &str = "\
## Port und Mappings

### Carrie

| **Front Panel Port** | **Dev Port** | **Pipe** | **Speed** | **Kabellabel** | **Plugged into** | **Kommentar** |
| -------------------- | ------------ | -------- | --------- | -------------- | ---------------- | ------------- |
| 1/0                  | 132          | 2/4      | 100G      | A22            | Carrie P2        | Local loop    |
| 2/0                  | 140          | 2/12     | 100G      | A22            | Carrie P1        | Local loop    |
| 3/0                  | 148          | 2/20     | 100G      | A23            | Pazuzu P3        | Tofino1 loop  |
| 10/0                 | 48           | 0/48     | 100G      | A12            | Pennywise 65.1   | Debug host    |
| 11/0                 | 40           | 0/40     |           |                | Rack 7 patch     |               |

### Pazuzu

| **Front Panel Port** | **Dev Port** | **Pipe** | **Speed** | **Kabellabel** | **Plugged into** | **Kommentar** |
| -------------------- | ------------ | -------- | --------- | -------------- | ---------------- | ------------- |
| 3/0                  | 144          | 3/16     | 100G      | A23            | Carrie P3        | Tofino1 loop  |
";

async fn create_tofino(app: &axum::Router, admin: &str, name: &str) -> String {
    let (status, tofino) = request(
        app,
        "POST",
        "/api/v1/admin/tofinos",
        Some(admin),
        Some(json!({"name": name, "version": 1})),
    )
    .await;
    assert_eq!(status, StatusCode::CREATED);
    tofino["id"].as_str().unwrap().to_string()
}

#[tokio::test]
async fn tofino_port_import_resolves_peers_to_ports_and_nics() {
    let (_state, app) = test_app().await;
    let admin = login(&app, "admin", true).await;
    let carrie = create_tofino(&app, &admin, "Carrie").await;
    let pazuzu = create_tofino(&app, &admin, "Pazuzu").await;

    let (status, server) = request(
        &app,
        "POST",
        "/api/v1/admin/servers",
        Some(&admin),
        Some(json!({"name": "Pennywise"})),
    )
    .await;
    assert_eq!(status, StatusCode::CREATED);
    let server_id = server["id"].as_str().unwrap().to_string();
    let (status, _) = request(
        &app,
        "POST",
        &format!("/api/v1/admin/servers/{server_id}/nics"),
        Some(&admin),
        Some(json!({
            "name": "65.1", "pci_address": "0000:41:00.1",
            "nic_type": "ConnectX-6", "speed_gbps": 100.0
        })),
    )
    .await;
    assert_eq!(status, StatusCode::CREATED);

    // The Carrie section is picked out of a document holding both tables.
    let (status, result) = request(
        &app,
        "POST",
        &format!("/api/v1/admin/tofinos/{carrie}/ports/import"),
        Some(&admin),
        Some(json!({"markdown": PORT_DOC})),
    )
    .await;
    assert_eq!(status, StatusCode::OK);
    assert_eq!(result["created"], 5);
    assert_eq!(result["updated"], 0);
    // Pazuzu has no ports yet, and the patch panel is not a device we know.
    let unresolved: Vec<&str> = result["unresolved"]
        .as_array()
        .unwrap()
        .iter()
        .map(|value| value.as_str().unwrap())
        .collect();
    assert_eq!(unresolved, vec!["Pazuzu P3", "Rack 7 patch"]);

    let (status, body) = request(
        &app,
        "GET",
        &format!("/api/v1/tofino-ports?tofino_id={carrie}"),
        Some(&admin),
        None,
    )
    .await;
    assert_eq!(status, StatusCode::OK);
    let ports = body["ports"].as_array().unwrap();
    assert_eq!(ports.len(), 5);
    // Hardware facts come straight from the table.
    assert_eq!(ports[0]["fp_port"], "1/0");
    assert_eq!(ports[0]["dev_port"], 132);
    assert_eq!(ports[0]["pipe"], "2/4");
    assert_eq!(ports[0]["speed_gbps"], 100.0);
    // "Carrie P2" is a port of the very Tofino being imported.
    assert_eq!(ports[0]["peer_label"], "Carrie 2/0");
    assert_eq!(ports[0]["peer_port_id"], ports[1]["id"]);
    assert_eq!(ports[1]["peer_port_id"], ports[0]["id"]);
    // "Pennywise 65.1" is a server NIC.
    assert_eq!(ports[3]["peer_label"], "Pennywise 65.1");
    assert!(ports[3]["peer_nic_id"].is_string());
    let (_, servers) = request(&app, "GET", "/api/v1/servers", Some(&admin), None).await;
    let imported_nic_claim = &server_by_id(&servers, &server_id)["nics"][0]["claim"];
    assert_eq!(imported_nic_claim["cable_label"], "A12");
    assert_eq!(imported_nic_claim["comment"], "Debug host");
    assert_eq!(imported_nic_claim["user_display_name"], "");
    // Unknown targets survive as free text rather than being dropped.
    assert_eq!(ports[4]["peer_label"], "Rack 7 patch");
    assert_eq!(ports[4]["peer_text"], "Rack 7 patch");

    // Importing the other endpoint resolves the cross-Tofino link immediately
    // on both sides; re-importing Carrie remains idempotent.
    let (_, result) = request(
        &app,
        "POST",
        &format!("/api/v1/admin/tofinos/{pazuzu}/ports/import"),
        Some(&admin),
        Some(json!({"markdown": PORT_DOC})),
    )
    .await;
    assert_eq!(result["created"], 1);
    let (_, body) = request(
        &app,
        "GET",
        &format!("/api/v1/tofino-ports?tofino_id={carrie}"),
        Some(&admin),
        None,
    )
    .await;
    assert_eq!(body["ports"][2]["peer_label"], "Pazuzu 3/0");
    let (_, result) = request(
        &app,
        "POST",
        &format!("/api/v1/admin/tofinos/{carrie}/ports/import"),
        Some(&admin),
        Some(json!({"markdown": PORT_DOC})),
    )
    .await;
    assert_eq!(result["created"], 0);
    assert_eq!(result["updated"], 5);
    let (_, body) = request(
        &app,
        "GET",
        &format!("/api/v1/tofino-ports?tofino_id={carrie}"),
        Some(&admin),
        None,
    )
    .await;
    assert_eq!(body["ports"][2]["peer_label"], "Pazuzu 3/0");
}

#[tokio::test]
async fn tofino_port_links_are_mirrored_on_the_other_end() {
    let (_state, app) = test_app().await;
    let admin = login(&app, "admin", true).await;
    let frank = create_tofino(&app, &admin, "Frank").await;
    let donnie = create_tofino(&app, &admin, "Donnie").await;

    let mut ids = Vec::new();
    for (tofino, fp_port, dev_port) in [
        (&frank, "3/0", 152),
        (&donnie, "3/0", 152),
        (&donnie, "4/0", 160),
    ] {
        let (status, port) = request(
            &app,
            "POST",
            &format!("/api/v1/admin/tofinos/{tofino}/ports"),
            Some(&admin),
            Some(json!({"fp_port": fp_port, "dev_port": dev_port, "pipe": "1/24"})),
        )
        .await;
        assert_eq!(status, StatusCode::CREATED);
        ids.push(port["id"].as_str().unwrap().to_string());
    }
    let (frank_3, donnie_3, donnie_4) = (&ids[0], &ids[1], &ids[2]);

    let port_by_id = async |id: &str, cookie: &str| -> serde_json::Value {
        let (_, body) = request(&app, "GET", "/api/v1/tofino-ports", Some(cookie), None).await;
        body["ports"]
            .as_array()
            .unwrap()
            .iter()
            .find(|port| port["id"] == id)
            .unwrap()
            .clone()
    };

    // Plugging Frank 3/0 into Donnie 3/0 points Donnie 3/0 back at Frank.
    let (status, updated) = request(
        &app,
        "PATCH",
        &format!("/api/v1/admin/tofino-ports/{frank_3}"),
        Some(&admin),
        Some(json!({
            "speed_gbps": 400.0,
            "comment": "Tofino2 loop",
            "peer": {"kind": "port", "port_id": donnie_3}
        })),
    )
    .await;
    assert_eq!(status, StatusCode::OK);
    assert_eq!(updated["peer_label"], "Donnie 3/0");
    assert_eq!(updated["speed_gbps"], 400.0);
    assert_eq!(
        port_by_id(donnie_3, &admin).await["peer_label"],
        "Frank 3/0"
    );

    // Re-cabling Frank onto Donnie 4/0 frees Donnie 3/0.
    let (status, _) = request(
        &app,
        "PATCH",
        &format!("/api/v1/admin/tofino-ports/{frank_3}"),
        Some(&admin),
        Some(json!({"peer": {"kind": "port", "port_id": donnie_4}})),
    )
    .await;
    assert_eq!(status, StatusCode::OK);
    assert_eq!(port_by_id(donnie_3, &admin).await["peer_label"], "");
    assert_eq!(
        port_by_id(donnie_4, &admin).await["peer_label"],
        "Frank 3/0"
    );

    // Unplugging clears both ends.
    let (status, _) = request(
        &app,
        "PATCH",
        &format!("/api/v1/admin/tofino-ports/{frank_3}"),
        Some(&admin),
        Some(json!({"peer": {"kind": "none"}})),
    )
    .await;
    assert_eq!(status, StatusCode::OK);
    assert_eq!(port_by_id(frank_3, &admin).await["peer_label"], "");
    assert_eq!(port_by_id(donnie_4, &admin).await["peer_label"], "");

    // Free text needs no counterpart; self-links are rejected.
    let (status, updated) = request(
        &app,
        "PATCH",
        &format!("/api/v1/admin/tofino-ports/{frank_3}"),
        Some(&admin),
        Some(json!({"peer": {"kind": "text", "text": "  Rack 7 patch  "}})),
    )
    .await;
    assert_eq!(status, StatusCode::OK);
    assert_eq!(updated["peer_text"], "Rack 7 patch");
    let (status, _) = request(
        &app,
        "PATCH",
        &format!("/api/v1/admin/tofino-ports/{frank_3}"),
        Some(&admin),
        Some(json!({"peer": {"kind": "port", "port_id": frank_3}})),
    )
    .await;
    assert_eq!(status, StatusCode::BAD_REQUEST);
}

#[tokio::test]
async fn tofino_port_and_server_nic_links_stay_bidirectional() {
    let (_state, app) = test_app().await;
    let admin = login(&app, "admin", true).await;
    let tofino = create_tofino(&app, &admin, "BiDi").await;

    let mut port_ids = Vec::new();
    for (fp_port, dev_port) in [("1/0", 132), ("2/0", 140)] {
        let (status, port) = request(
            &app,
            "POST",
            &format!("/api/v1/admin/tofinos/{tofino}/ports"),
            Some(&admin),
            Some(json!({"fp_port": fp_port, "dev_port": dev_port})),
        )
        .await;
        assert_eq!(status, StatusCode::CREATED);
        port_ids.push(port["id"].as_str().unwrap().to_string());
    }
    let (port_1, port_2) = (&port_ids[0], &port_ids[1]);

    let (_, server) = request(
        &app,
        "POST",
        "/api/v1/admin/servers",
        Some(&admin),
        Some(json!({"name": "link-host"})),
    )
    .await;
    let server_id = server["id"].as_str().unwrap().to_string();
    let (_, nic) = request(
        &app,
        "POST",
        &format!("/api/v1/admin/servers/{server_id}/nics"),
        Some(&admin),
        Some(json!({
            "name": "65.1", "pci_address": "0000:65:00.1",
            "nic_type": "ConnectX-6", "speed_gbps": 100.0
        })),
    )
    .await;
    let nic_id = nic["id"].as_str().unwrap().to_string();

    // Linking from the Tofino side is immediately visible on the NIC.
    let (status, _) = request(
        &app,
        "PATCH",
        &format!("/api/v1/admin/tofino-ports/{port_1}"),
        Some(&admin),
        Some(json!({"peer": {"kind": "nic", "nic_id": nic_id}})),
    )
    .await;
    assert_eq!(status, StatusCode::OK);
    let (_, servers) = request(&app, "GET", "/api/v1/servers", Some(&admin), None).await;
    let listed_nic = &server_by_id(&servers, &server_id)["nics"][0];
    assert_eq!(listed_nic["peer_port_id"], port_1.as_str());
    assert_eq!(listed_nic["peer_port_label"], "BiDi 1/0");

    // Linking from the NIC side re-cables the canonical port map.
    let (status, _) = request(
        &app,
        "PUT",
        &format!("/api/v1/admin/nics/{nic_id}/claim"),
        Some(&admin),
        Some(json!({
            "assignee_name": "P4 course",
            "peer": {"kind": "port", "port_id": port_2}
        })),
    )
    .await;
    assert_eq!(status, StatusCode::OK);
    let (_, ports) = request(&app, "GET", "/api/v1/tofino-ports", Some(&admin), None).await;
    let port_by_id = |id: &str| {
        ports["ports"]
            .as_array()
            .unwrap()
            .iter()
            .find(|port| port["id"] == id)
            .unwrap()
    };
    assert!(port_by_id(port_1)["peer_nic_id"].is_null());
    assert_eq!(port_by_id(port_2)["peer_nic_id"], nic_id);

    // Switching to free text disconnects the structured cable on both sides.
    let (status, claim) = request(
        &app,
        "PUT",
        &format!("/api/v1/admin/nics/{nic_id}/claim"),
        Some(&admin),
        Some(json!({
            "assignee_name": "P4 course",
            "peer": {"kind": "text", "text": "  Rack 7 patch  "}
        })),
    )
    .await;
    assert_eq!(status, StatusCode::OK);
    assert_eq!(claim["connected_to"], "Rack 7 patch");
    let (_, ports) = request(&app, "GET", "/api/v1/tofino-ports", Some(&admin), None).await;
    let port_2 = ports["ports"]
        .as_array()
        .unwrap()
        .iter()
        .find(|port| port["id"] == port_2.as_str())
        .unwrap();
    assert!(port_2["peer_nic_id"].is_null());
    let (_, servers) = request(&app, "GET", "/api/v1/servers", Some(&admin), None).await;
    let listed_nic = &server_by_id(&servers, &server_id)["nics"][0];
    assert!(listed_nic["peer_port_id"].is_null());
    assert_eq!(listed_nic["claim"]["connected_to"], "Rack 7 patch");
}

#[tokio::test]
async fn server_nic_links_are_symmetric_and_recable_existing_cables() {
    let (_state, app) = test_app().await;
    let admin = login(&app, "admin", true).await;
    let tofino = create_tofino(&app, &admin, "NIC links").await;
    let (_, port) = request(
        &app,
        "POST",
        &format!("/api/v1/admin/tofinos/{tofino}/ports"),
        Some(&admin),
        Some(json!({"fp_port": "1/0", "dev_port": 132})),
    )
    .await;
    let port_id = port["id"].as_str().unwrap().to_string();

    let mut servers = Vec::new();
    let mut nics = Vec::new();
    for index in 1..=3 {
        let (_, server) = request(
            &app,
            "POST",
            "/api/v1/admin/servers",
            Some(&admin),
            Some(json!({"name": format!("nic-host-{index}")})),
        )
        .await;
        let server_id = server["id"].as_str().unwrap().to_string();
        let (_, nic) = request(
            &app,
            "POST",
            &format!("/api/v1/admin/servers/{server_id}/nics"),
            Some(&admin),
            Some(json!({
                "name": format!("8{index}.0"),
                "pci_address": format!("0000:8{index}:00.0"),
                "nic_type": "ConnectX-6",
                "speed_gbps": 100
            })),
        )
        .await;
        servers.push(server_id);
        nics.push(nic["id"].as_str().unwrap().to_string());
    }

    // Start with NIC 1 on a Tofino port.
    let (status, _) = request(
        &app,
        "PATCH",
        &format!("/api/v1/admin/tofino-ports/{port_id}"),
        Some(&admin),
        Some(json!({"peer": {"kind": "nic", "nic_id": nics[0]}})),
    )
    .await;
    assert_eq!(status, StatusCode::OK);

    // Connecting NIC 1 to NIC 2 detaches the Tofino and appears on both NICs.
    let (status, _) = request(
        &app,
        "PUT",
        &format!("/api/v1/admin/nics/{}/claim", nics[0]),
        Some(&admin),
        Some(json!({
            "assignee_name": "direct link",
            "peer": {"kind": "nic", "nic_id": nics[1]}
        })),
    )
    .await;
    assert_eq!(status, StatusCode::OK);
    let (_, listed) = request(&app, "GET", "/api/v1/servers", Some(&admin), None).await;
    let first = &server_by_id(&listed, &servers[0])["nics"][0];
    let second = &server_by_id(&listed, &servers[1])["nics"][0];
    assert_eq!(first["peer_nic_id"], nics[1]);
    assert_eq!(first["peer_nic_label"], "nic-host-2 82.0");
    assert_eq!(second["peer_nic_id"], nics[0]);
    assert_eq!(second["peer_nic_label"], "nic-host-1 81.0");
    assert!(first["peer_port_id"].is_null());
    let (_, ports) = request(&app, "GET", "/api/v1/tofino-ports", Some(&admin), None).await;
    assert!(ports["ports"][0]["peer_nic_id"].is_null());

    // Re-cabling NIC 1 to NIC 3 clears NIC 2's back-link.
    let (status, _) = request(
        &app,
        "PUT",
        &format!("/api/v1/admin/nics/{}/claim", nics[0]),
        Some(&admin),
        Some(json!({
            "assignee_name": "direct link",
            "peer": {"kind": "nic", "nic_id": nics[2]}
        })),
    )
    .await;
    assert_eq!(status, StatusCode::OK);
    let (_, listed) = request(&app, "GET", "/api/v1/servers", Some(&admin), None).await;
    assert!(server_by_id(&listed, &servers[1])["nics"][0]["peer_nic_id"].is_null());
    assert_eq!(
        server_by_id(&listed, &servers[2])["nics"][0]["peer_nic_id"],
        nics[0]
    );

    let (status, _) = request(
        &app,
        "PUT",
        &format!("/api/v1/admin/nics/{}/claim", nics[0]),
        Some(&admin),
        Some(json!({
            "assignee_name": "direct link",
            "peer": {"kind": "nic", "nic_id": nics[0]}
        })),
    )
    .await;
    assert_eq!(status, StatusCode::BAD_REQUEST);

    // Connecting from the Tofino side also clears the direct NIC link on both
    // endpoints.
    let (status, _) = request(
        &app,
        "PATCH",
        &format!("/api/v1/admin/tofino-ports/{port_id}"),
        Some(&admin),
        Some(json!({"peer": {"kind": "nic", "nic_id": nics[0]}})),
    )
    .await;
    assert_eq!(status, StatusCode::OK);
    let (_, listed) = request(&app, "GET", "/api/v1/servers", Some(&admin), None).await;
    assert!(server_by_id(&listed, &servers[2])["nics"][0]["peer_nic_id"].is_null());
    assert_eq!(
        server_by_id(&listed, &servers[0])["nics"][0]["peer_port_id"],
        port_id
    );
}

#[tokio::test]
async fn tofino_ports_are_readable_by_users_but_only_admins_edit() {
    let (_state, app) = test_app().await;
    let admin = login(&app, "admin", true).await;
    let user = login(&app, "bob", false).await;
    let tofino = create_tofino(&app, &admin, "Carrie").await;

    let (status, port) = request(
        &app,
        "POST",
        &format!("/api/v1/admin/tofinos/{tofino}/ports"),
        Some(&admin),
        Some(json!({"fp_port": "P1", "dev_port": 132, "pipe": "2/4"})),
    )
    .await;
    assert_eq!(status, StatusCode::CREATED);
    // "P1" is stored in the canonical front-panel notation.
    assert_eq!(port["fp_port"], "1/0");
    let port_id = port["id"].as_str().unwrap().to_string();

    // Documenting the same front-panel port twice is a conflict.
    let (status, _) = request(
        &app,
        "POST",
        &format!("/api/v1/admin/tofinos/{tofino}/ports"),
        Some(&admin),
        Some(json!({"fp_port": "1/0", "dev_port": 132})),
    )
    .await;
    assert_eq!(status, StatusCode::CONFLICT);

    // Users read the port map...
    let (status, body) = request(&app, "GET", "/api/v1/tofino-ports", Some(&user), None).await;
    assert_eq!(status, StatusCode::OK);
    assert_eq!(body["ports"].as_array().unwrap().len(), 1);

    // ...but cannot document it.
    for (method, uri, body) in [
        (
            "PATCH",
            format!("/api/v1/admin/tofino-ports/{port_id}"),
            Some(json!({"comment": "mine now"})),
        ),
        (
            "DELETE",
            format!("/api/v1/admin/tofino-ports/{port_id}"),
            None,
        ),
        (
            "POST",
            format!("/api/v1/admin/tofinos/{tofino}/ports/import"),
            Some(json!({"markdown": PORT_DOC})),
        ),
    ] {
        let (status, _) = request(&app, method, &uri, Some(&user), body).await;
        assert_eq!(status, StatusCode::FORBIDDEN, "{method} {uri}");
    }

    let (status, _) = request(
        &app,
        "DELETE",
        &format!("/api/v1/admin/tofino-ports/{port_id}"),
        Some(&admin),
        None,
    )
    .await;
    assert_eq!(status, StatusCode::NO_CONTENT);
}

#[tokio::test]
async fn server_and_nic_hardware_details_round_trip() {
    let (_state, app) = test_app().await;
    let admin = login(&app, "admin", true).await;

    let (status, server) = request(
        &app,
        "POST",
        "/api/v1/admin/servers",
        Some(&admin),
        Some(json!({
            "name": "pennywise",
            "cpu_model": "AMD EPYC 7443P 24-Core Processor",
            "cpu_sockets": 2, "cpu_cores": 48, "cpu_threads": 96,
            "cpu_mhz": 4035.0, "memory_gb": 503.6
        })),
    )
    .await;
    assert_eq!(status, StatusCode::CREATED);
    assert_eq!(server["cpu_cores"], 48);
    assert_eq!(server["memory_gb"], 503.6);
    let server_id = server["id"].as_str().unwrap().to_string();

    let (status, nic) = request(
        &app,
        "POST",
        &format!("/api/v1/admin/servers/{server_id}/nics"),
        Some(&admin),
        Some(json!({
            "name": "65.1", "pci_address": "0000:65:00.1", "nic_type": "ConnectX-6",
            "speed_gbps": 100.0, "ifname": "ens65f0np1", "mac": "02:00:00:00:00:01",
            "numa_node": 1, "kind": "vf", "usage": "Management"
        })),
    )
    .await;
    assert_eq!(status, StatusCode::CREATED);
    // MACs are stored lowercase so they compare predictably.
    assert_eq!(nic["mac"], "02:00:00:00:00:01");
    assert_eq!(nic["ifname"], "ens65f0np1");
    assert_eq!(nic["numa_node"], 1);
    assert_eq!(nic["kind"], "vf");
    assert_eq!(nic["usage"], "Management");
    let nic_id = nic["id"].as_str().unwrap().to_string();

    // The details survive the round trip through GET /servers.
    let (_, body) = request(&app, "GET", "/api/v1/servers", Some(&admin), None).await;
    let listed = server_by_id(&body, &server_id);
    assert_eq!(listed["cpu_model"], "AMD EPYC 7443P 24-Core Processor");
    assert_eq!(listed["cpu_sockets"], 2);
    assert_eq!(listed["nics"][0]["ifname"], "ens65f0np1");
    assert_eq!(listed["nics"][0]["numa_node"], 1);
    assert_eq!(listed["nics"][0]["usage"], "Management");

    // A NIC without NUMA affinity reports -1; that is stored as null.
    let (status, nic) = request(
        &app,
        "PATCH",
        &format!("/api/v1/admin/nics/{nic_id}"),
        Some(&admin),
        Some(json!({"numa_node": -1, "kind": "pf", "usage": "DPDK"})),
    )
    .await;
    assert_eq!(status, StatusCode::OK);
    assert!(nic["numa_node"].is_null());
    assert_eq!(nic["kind"], "pf");
    assert_eq!(nic["usage"], "DPDK");
    // Untouched fields stay put.
    assert_eq!(nic["ifname"], "ens65f0np1");

    // Zero is the stored representation for an unknown nominal speed.
    let (status, nic) = request(
        &app,
        "PATCH",
        &format!("/api/v1/admin/nics/{nic_id}"),
        Some(&admin),
        Some(json!({"speed_gbps": 0})),
    )
    .await;
    assert_eq!(status, StatusCode::OK);
    assert_eq!(nic["speed_gbps"], 0.0);

    // Negative speeds are invalid and must not reach SQLite through the API.
    let (status, body) = request(
        &app,
        "PATCH",
        &format!("/api/v1/admin/nics/{nic_id}"),
        Some(&admin),
        Some(json!({"speed_gbps": -1})),
    )
    .await;
    assert_eq!(status, StatusCode::BAD_REQUEST);
    assert!(body["error"].as_str().unwrap().contains("zero (unknown)"));

    let (status, body) = request(
        &app,
        "PATCH",
        &format!("/api/v1/admin/nics/{nic_id}"),
        Some(&admin),
        Some(json!({"kind": "sriov"})),
    )
    .await;
    assert_eq!(status, StatusCode::BAD_REQUEST);
    assert!(body["error"].as_str().unwrap().contains("kind must be"));

    // Zero clears a server hardware number, omitted fields are kept.
    let (status, server) = request(
        &app,
        "PATCH",
        &format!("/api/v1/admin/servers/{server_id}"),
        Some(&admin),
        Some(json!({"cpu_mhz": 0, "memory_gb": 1024.0})),
    )
    .await;
    assert_eq!(status, StatusCode::OK);
    assert!(server["cpu_mhz"].is_null());
    assert_eq!(server["memory_gb"], 1024.0);
    assert_eq!(server["cpu_cores"], 48);
}

/// The cable label and comment describe the cable, so editing either endpoint
/// of a link must leave both ends saying the same thing.
#[tokio::test]
async fn cable_documentation_follows_the_link_to_both_endpoints() {
    let (_state, app) = test_app().await;
    let admin = login(&app, "admin", true).await;
    let tofino = create_tofino(&app, &admin, "Sync").await;

    let mut ports = Vec::new();
    for (fp_port, dev_port) in [("1/0", 132), ("2/0", 140)] {
        let (_, port) = request(
            &app,
            "POST",
            &format!("/api/v1/admin/tofinos/{tofino}/ports"),
            Some(&admin),
            Some(json!({"fp_port": fp_port, "dev_port": dev_port})),
        )
        .await;
        ports.push(port["id"].as_str().unwrap().to_string());
    }

    let mut servers = Vec::new();
    let mut nics = Vec::new();
    for index in 1..=2 {
        let (_, server) = request(
            &app,
            "POST",
            "/api/v1/admin/servers",
            Some(&admin),
            Some(json!({"name": format!("cable-host-{index}")})),
        )
        .await;
        let server_id = server["id"].as_str().unwrap().to_string();
        let (_, nic) = request(
            &app,
            "POST",
            &format!("/api/v1/admin/servers/{server_id}/nics"),
            Some(&admin),
            Some(json!({
                "name": format!("6{index}.0"),
                "pci_address": format!("0000:6{index}:00.0"),
                "nic_type": "ConnectX-6",
                "speed_gbps": 100,
                "usage": "DPDK"
            })),
        )
        .await;
        servers.push(server_id);
        nics.push(nic["id"].as_str().unwrap().to_string());
    }

    let port_by_id = |body: &Value, id: &str| -> Value {
        body["ports"]
            .as_array()
            .unwrap()
            .iter()
            .find(|port| port["id"] == id)
            .unwrap()
            .clone()
    };

    // Port to port: the mirrored end gets the same documentation.
    let (status, _) = request(
        &app,
        "PATCH",
        &format!("/api/v1/admin/tofino-ports/{}", ports[0]),
        Some(&admin),
        Some(json!({
            "cable_label": "A12",
            "comment": "Loopback",
            "peer": {"kind": "port", "port_id": ports[1]}
        })),
    )
    .await;
    assert_eq!(status, StatusCode::OK);
    let (_, body) = request(&app, "GET", "/api/v1/tofino-ports", Some(&admin), None).await;
    assert_eq!(port_by_id(&body, &ports[1])["cable_label"], "A12");
    assert_eq!(port_by_id(&body, &ports[1])["comment"], "Loopback");

    // Editing the other end wins for both.
    let (status, _) = request(
        &app,
        "PATCH",
        &format!("/api/v1/admin/tofino-ports/{}", ports[1]),
        Some(&admin),
        Some(json!({"cable_label": "A13", "comment": "Relabelled"})),
    )
    .await;
    assert_eq!(status, StatusCode::OK);
    let (_, body) = request(&app, "GET", "/api/v1/tofino-ports", Some(&admin), None).await;
    assert_eq!(port_by_id(&body, &ports[0])["cable_label"], "A13");
    assert_eq!(port_by_id(&body, &ports[0])["comment"], "Relabelled");

    // Port to NIC: an unclaimed NIC still records the shared cable.
    let (status, _) = request(
        &app,
        "PATCH",
        &format!("/api/v1/admin/tofino-ports/{}", ports[0]),
        Some(&admin),
        Some(json!({
            "cable_label": "B7",
            "comment": "Testbed uplink",
            "peer": {"kind": "nic", "nic_id": nics[0]}
        })),
    )
    .await;
    assert_eq!(status, StatusCode::OK);
    let (_, body) = request(&app, "GET", "/api/v1/servers", Some(&admin), None).await;
    let claim = &server_by_id(&body, &servers[0])["nics"][0]["claim"];
    assert_eq!(claim["cable_label"], "B7");
    assert_eq!(claim["comment"], "Testbed uplink");
    // Documentation only: nobody owns the NIC.
    assert!(claim["user_id"].is_null());
    assert_eq!(claim["user_display_name"], "");

    // Editing the NIC side pushes back onto the port.
    let (status, _) = request(
        &app,
        "PUT",
        &format!("/api/v1/admin/nics/{}/claim", nics[0]),
        Some(&admin),
        Some(json!({
            "assignee_name": "P4 course",
            "peer": {"kind": "port", "port_id": ports[0]},
            "cable_label": "B8",
            "comment": "Re-plugged"
        })),
    )
    .await;
    assert_eq!(status, StatusCode::OK);
    let (_, body) = request(&app, "GET", "/api/v1/tofino-ports", Some(&admin), None).await;
    assert_eq!(port_by_id(&body, &ports[0])["cable_label"], "B8");
    assert_eq!(port_by_id(&body, &ports[0])["comment"], "Re-plugged");

    // Releasing the claim keeps the cable documentation, not the owner.
    let (status, _) = request(
        &app,
        "DELETE",
        &format!("/api/v1/admin/nics/{}/claim", nics[0]),
        Some(&admin),
        None,
    )
    .await;
    assert_eq!(status, StatusCode::NO_CONTENT);
    let (_, body) = request(&app, "GET", "/api/v1/servers", Some(&admin), None).await;
    let claim = &server_by_id(&body, &servers[0])["nics"][0]["claim"];
    assert_eq!(claim["cable_label"], "B8");
    assert_eq!(claim["user_display_name"], "");

    // NIC to NIC: both claims and both usage labels line up.
    let (status, _) = request(
        &app,
        "PUT",
        &format!("/api/v1/admin/nics/{}/claim", nics[0]),
        Some(&admin),
        Some(json!({
            "assignee_name": "P4 course",
            "peer": {"kind": "nic", "nic_id": nics[1]},
            "cable_label": "C-3",
            "comment": "Back-to-back"
        })),
    )
    .await;
    assert_eq!(status, StatusCode::OK);
    let (_, body) = request(&app, "GET", "/api/v1/servers", Some(&admin), None).await;
    let peer_claim = &server_by_id(&body, &servers[1])["nics"][0]["claim"];
    assert_eq!(peer_claim["cable_label"], "C-3");
    assert_eq!(peer_claim["comment"], "Back-to-back");
    // The port it used to be plugged into keeps its own history.
    let (_, ports_body) = request(&app, "GET", "/api/v1/tofino-ports", Some(&admin), None).await;
    assert!(port_by_id(&ports_body, &ports[0])["peer_nic_id"].is_null());

    // `usage` describes the NIC (which VM owns it), not the cable, so it stays
    // on the NIC it was set on.
    let (status, _) = request(
        &app,
        "PATCH",
        &format!("/api/v1/admin/nics/{}", nics[0]),
        Some(&admin),
        Some(json!({"usage": "Teaching"})),
    )
    .await;
    assert_eq!(status, StatusCode::OK);
    let (_, body) = request(&app, "GET", "/api/v1/servers", Some(&admin), None).await;
    assert_eq!(server_by_id(&body, &servers[1])["nics"][0]["usage"], "DPDK");
}
