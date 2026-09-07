//! Front-panel port documentation for Tofinos.
//!
//! `fp_port`/`dev_port`/`pipe` are hardware facts (admin-managed, read-only in
//! the port view); speed, cable label, "plugged into" and the free comment are
//! the documentation. Port-to-port links are mirrored: plugging A into B also
//! points B at A.

pub mod markdown;

use axum::{
    Json, Router,
    extract::{Path, Query, State},
    http::StatusCode,
    routing::{get, patch, post},
};
use serde::{Deserialize, Serialize};
use sqlx::{Sqlite, Transaction};
use utoipa::{IntoParams, ToSchema};
use uuid::Uuid;

use crate::{
    AppState,
    auth::{AdminUser, CurrentUser},
    db::now_ts,
    error::{ApiError, ApiResult},
};

pub fn router() -> Router<AppState> {
    Router::new()
        .route("/tofino-ports", get(list_ports))
        .route("/admin/tofinos/{id}/ports", post(create_port))
        .route("/admin/tofinos/{id}/ports/import", post(import_ports))
        .route(
            "/admin/tofino-ports/{id}",
            patch(update_port).delete(delete_port),
        )
}

#[derive(Serialize, ToSchema)]
pub struct TofinoPortView {
    pub id: String,
    pub tofino_id: String,
    pub tofino_name: String,
    /// Front-panel port, e.g. "1/0".
    pub fp_port: String,
    pub dev_port: i64,
    /// Pipe/lane, e.g. "2/4".
    pub pipe: String,
    /// Link speed in Gbit/s; 0 means "not documented".
    pub speed_gbps: f64,
    pub cable_label: String,
    /// Set when this port is cabled to another Tofino port.
    pub peer_port_id: Option<String>,
    pub peer_port_tofino_id: Option<String>,
    /// Set when this port is cabled to a server NIC.
    pub peer_nic_id: Option<String>,
    pub peer_nic_server_id: Option<String>,
    /// Free-text peer, used when neither a port nor a NIC is referenced.
    pub peer_text: String,
    /// Display label of whatever this port is plugged into ("Donnie 3/0",
    /// "Pennywise 65.1", or the free text); empty when unplugged.
    pub peer_label: String,
    pub comment: String,
    pub sort_order: i64,
    pub updated_by_display_name: Option<String>,
    pub updated_at: i64,
}

#[derive(Serialize, ToSchema)]
pub struct TofinoPortsResponse {
    pub ports: Vec<TofinoPortView>,
}

#[derive(Deserialize, IntoParams)]
pub(crate) struct ListPortsQuery {
    /// Restrict to one Tofino; omit for every port (peer picker).
    pub tofino_id: Option<String>,
}

#[derive(Deserialize, ToSchema)]
pub struct CreatePortRequest {
    /// "1/0", "P1" and "1" all mean front-panel port 1.
    pub fp_port: String,
    pub dev_port: i64,
    pub pipe: Option<String>,
    pub speed_gbps: Option<f64>,
    pub cable_label: Option<String>,
    pub comment: Option<String>,
    pub sort_order: Option<i64>,
}

#[derive(Deserialize, ToSchema)]
pub struct UpdatePortRequest {
    pub fp_port: Option<String>,
    pub dev_port: Option<i64>,
    pub pipe: Option<String>,
    pub speed_gbps: Option<f64>,
    pub cable_label: Option<String>,
    pub comment: Option<String>,
    pub sort_order: Option<i64>,
    /// Replaces the whole "plugged into" side when present.
    pub peer: Option<PeerInput>,
}

/// What a port is plugged into. `port` links are mirrored onto the other end.
#[derive(Deserialize, ToSchema)]
#[serde(tag = "kind", rename_all = "snake_case")]
pub enum PeerInput {
    None,
    Port { port_id: String },
    Nic { nic_id: String },
    Text { text: String },
}

#[derive(Deserialize, ToSchema)]
pub struct ImportPortsRequest {
    /// A Markdown port table, or a whole tofino.md — the section named after
    /// this Tofino wins.
    pub markdown: String,
}

#[derive(Serialize, ToSchema)]
pub struct ImportPortsResponse {
    pub created: i64,
    pub updated: i64,
    /// "Plugged into" values that matched no port or NIC and were kept as text.
    pub unresolved: Vec<String>,
}

#[derive(sqlx::FromRow)]
struct PortRow {
    id: String,
    tofino_id: String,
    tofino_name: String,
    fp_port: String,
    dev_port: i64,
    pipe: String,
    speed_gbps: f64,
    cable_label: String,
    peer_port_id: Option<String>,
    peer_port_tofino_id: Option<String>,
    peer_port_tofino_name: Option<String>,
    peer_port_fp_port: Option<String>,
    peer_nic_id: Option<String>,
    peer_nic_name: Option<String>,
    peer_nic_server_id: Option<String>,
    peer_nic_server_name: Option<String>,
    peer_text: String,
    comment: String,
    sort_order: i64,
    updated_by_display_name: Option<String>,
    updated_at: i64,
}

/// Current values a PATCH may leave untouched: fp_port, dev_port, pipe,
/// speed_gbps, cable_label, comment, sort_order, peer_port_id.
type EditableRow = (
    String,
    i64,
    String,
    f64,
    String,
    String,
    i64,
    Option<String>,
);

/// Shared SELECT list — a macro so the variants below stay `&'static str`,
/// which is what sqlx accepts without an injection audit.
macro_rules! port_select {
    () => {
        "SELECT p.id, p.tofino_id, t.name AS tofino_name, p.fp_port, p.dev_port,
                p.pipe, p.speed_gbps, p.cable_label,
                p.peer_port_id, pp.tofino_id AS peer_port_tofino_id,
                pt.name AS peer_port_tofino_name, pp.fp_port AS peer_port_fp_port,
                p.peer_nic_id, n.name AS peer_nic_name,
                n.server_id AS peer_nic_server_id, s.name AS peer_nic_server_name,
                p.peer_text, p.comment, p.sort_order,
                u.display_name AS updated_by_display_name, p.updated_at
         FROM tofino_ports p
         JOIN tofinos t ON t.id = p.tofino_id
         LEFT JOIN tofino_ports pp ON pp.id = p.peer_port_id
         LEFT JOIN tofinos pt ON pt.id = pp.tofino_id
         LEFT JOIN nics n ON n.id = p.peer_nic_id
         LEFT JOIN servers s ON s.id = n.server_id
         LEFT JOIN users u ON u.id = p.updated_by"
    };
}

fn port_view(row: PortRow) -> TofinoPortView {
    let peer_label = match (
        row.peer_port_tofino_name.as_deref(),
        row.peer_port_fp_port.as_deref(),
        row.peer_nic_server_name.as_deref(),
        row.peer_nic_name.as_deref(),
    ) {
        (Some(tofino), Some(fp_port), _, _) => format!("{tofino} {fp_port}"),
        (_, _, Some(server), Some(nic)) => format!("{server} {nic}"),
        _ => row.peer_text.clone(),
    };

    TofinoPortView {
        id: row.id,
        tofino_id: row.tofino_id,
        tofino_name: row.tofino_name,
        fp_port: row.fp_port,
        dev_port: row.dev_port,
        pipe: row.pipe,
        speed_gbps: row.speed_gbps,
        cable_label: row.cable_label,
        peer_port_id: row.peer_port_id,
        peer_port_tofino_id: row.peer_port_tofino_id,
        peer_nic_id: row.peer_nic_id,
        peer_nic_server_id: row.peer_nic_server_id,
        peer_text: row.peer_text,
        peer_label,
        comment: row.comment,
        sort_order: row.sort_order,
        updated_by_display_name: row.updated_by_display_name,
        updated_at: row.updated_at,
    }
}

async fn load_port_view(state: &AppState, id: &str) -> ApiResult<TofinoPortView> {
    let row: Option<PortRow> = sqlx::query_as(concat!(port_select!(), " WHERE p.id = ?"))
        .bind(id)
        .fetch_optional(&state.db)
        .await?;
    row.map(port_view).ok_or(ApiError::NotFound)
}

#[utoipa::path(
    get,
    path = "/api/v1/tofino-ports",
    tag = "devices",
    params(ListPortsQuery),
    responses((status = 200, body = TofinoPortsResponse))
)]
pub(crate) async fn list_ports(
    State(state): State<AppState>,
    user: CurrentUser,
    Query(query): Query<ListPortsQuery>,
) -> ApiResult<Json<TofinoPortsResponse>> {
    // Inactive Tofinos are hidden from non-admins, exactly like GET /tofinos.
    let sql = if user.is_admin {
        concat!(
            port_select!(),
            " WHERE (? IS NULL OR p.tofino_id = ?)
              ORDER BY t.name, p.sort_order, p.dev_port"
        )
    } else {
        concat!(
            port_select!(),
            " WHERE (? IS NULL OR p.tofino_id = ?) AND t.active = 1
              ORDER BY t.name, p.sort_order, p.dev_port"
        )
    };
    let rows: Vec<PortRow> = sqlx::query_as(sql)
        .bind(&query.tofino_id)
        .bind(&query.tofino_id)
        .fetch_all(&state.db)
        .await?;

    Ok(Json(TofinoPortsResponse {
        ports: rows.into_iter().map(port_view).collect(),
    }))
}

#[utoipa::path(
    post,
    path = "/api/v1/admin/tofinos/{id}/ports",
    tag = "admin",
    params(("id" = String, Path)),
    request_body = CreatePortRequest,
    responses(
        (status = 201, body = TofinoPortView),
        (status = 409, description = "Port already documented", body = crate::error::ErrorResponse)
    )
)]
pub(crate) async fn create_port(
    State(state): State<AppState>,
    admin: AdminUser,
    Path(tofino_id): Path<String>,
    Json(input): Json<CreatePortRequest>,
) -> ApiResult<(StatusCode, Json<TofinoPortView>)> {
    ensure_tofino_exists(&state, &tofino_id).await?;
    let fp_port = markdown::normalize_fp_port(&input.fp_port);
    if fp_port.is_empty() {
        return Err(ApiError::BadRequest("fp_port must not be empty".into()));
    }
    validate_speed(input.speed_gbps.unwrap_or(0.0))?;

    let id = Uuid::new_v4().to_string();
    let now = now_ts();
    sqlx::query(
        "INSERT INTO tofino_ports (id, tofino_id, fp_port, dev_port, pipe, speed_gbps,
                                   cable_label, comment, sort_order, updated_by,
                                   created_at, updated_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)",
    )
    .bind(&id)
    .bind(&tofino_id)
    .bind(&fp_port)
    .bind(input.dev_port)
    .bind(input.pipe.as_deref().unwrap_or("").trim())
    .bind(input.speed_gbps.unwrap_or(0.0))
    .bind(input.cable_label.as_deref().unwrap_or("").trim())
    .bind(input.comment.as_deref().unwrap_or("").trim())
    .bind(input.sort_order.unwrap_or(0))
    .bind(&admin.0.id)
    .bind(now)
    .bind(now)
    .execute(&state.db)
    .await
    .map_err(|err| ApiError::conflict_on_unique(err, "this front-panel port already exists"))?;

    Ok((
        StatusCode::CREATED,
        Json(load_port_view(&state, &id).await?),
    ))
}

#[utoipa::path(
    patch,
    path = "/api/v1/admin/tofino-ports/{id}",
    tag = "admin",
    params(("id" = String, Path)),
    request_body = UpdatePortRequest,
    responses(
        (status = 200, body = TofinoPortView),
        (status = 409, description = "Port already documented", body = crate::error::ErrorResponse)
    )
)]
pub(crate) async fn update_port(
    State(state): State<AppState>,
    admin: AdminUser,
    Path(id): Path<String>,
    Json(input): Json<UpdatePortRequest>,
) -> ApiResult<Json<TofinoPortView>> {
    let existing: Option<EditableRow> = sqlx::query_as(
        "SELECT fp_port, dev_port, pipe, speed_gbps, cable_label, comment, sort_order,
                peer_port_id
         FROM tofino_ports WHERE id = ?",
    )
    .bind(&id)
    .fetch_optional(&state.db)
    .await?;
    let (fp_port, dev_port, pipe, speed_gbps, cable_label, comment, sort_order, peer_port_id) =
        existing.ok_or(ApiError::NotFound)?;

    let fp_port = match input.fp_port {
        Some(value) => {
            let normalized = markdown::normalize_fp_port(&value);
            if normalized.is_empty() {
                return Err(ApiError::BadRequest("fp_port must not be empty".into()));
            }
            normalized
        }
        None => fp_port,
    };
    let dev_port = input.dev_port.unwrap_or(dev_port);
    let pipe = input.pipe.unwrap_or(pipe);
    let speed_gbps = input.speed_gbps.unwrap_or(speed_gbps);
    validate_speed(speed_gbps)?;
    let cable_label = input.cable_label.unwrap_or(cable_label);
    let comment = input.comment.unwrap_or(comment);
    let sort_order = input.sort_order.unwrap_or(sort_order);
    let now = now_ts();

    let mut tx = state.db.begin_with("BEGIN IMMEDIATE").await?;
    sqlx::query(
        "UPDATE tofino_ports SET fp_port = ?, dev_port = ?, pipe = ?, speed_gbps = ?,
                                 cable_label = ?, comment = ?, sort_order = ?, updated_by = ?,
                                 updated_at = ?
         WHERE id = ?",
    )
    .bind(&fp_port)
    .bind(dev_port)
    .bind(pipe.trim())
    .bind(speed_gbps)
    .bind(cable_label.trim())
    .bind(comment.trim())
    .bind(sort_order)
    .bind(&admin.0.id)
    .bind(now)
    .bind(&id)
    .execute(&mut *tx)
    .await
    .map_err(|err| ApiError::conflict_on_unique(err, "this front-panel port already exists"))?;

    if let Some(peer) = &input.peer {
        let (peer_port, peer_nic, peer_text) =
            apply_peer(&mut tx, &id, peer_port_id.as_deref(), peer, now).await?;
        sqlx::query(
            "UPDATE tofino_ports SET peer_port_id = ?, peer_nic_id = ?, peer_text = ?
             WHERE id = ?",
        )
        .bind(&peer_port)
        .bind(&peer_nic)
        .bind(&peer_text)
        .bind(&id)
        .execute(&mut *tx)
        .await?;
    }
    // Runs after the peer switch so a re-cabled link takes the documentation
    // with it instead of leaving it on the old endpoint.
    sync_cable_documentation(
        &mut tx,
        LinkEndpoint::Port(&id),
        cable_label.trim(),
        comment.trim(),
        &admin.0.id,
        now,
    )
    .await?;
    tx.commit().await?;

    Ok(Json(load_port_view(&state, &id).await?))
}

/// Points the other end back at `port_id` and detaches links this change
/// breaks. Returns the peer columns to store on `port_id` itself.
async fn apply_peer(
    tx: &mut Transaction<'_, Sqlite>,
    port_id: &str,
    previous_peer_port: Option<&str>,
    peer: &PeerInput,
    now: i64,
) -> ApiResult<(Option<String>, Option<String>, String)> {
    let new_peer_port = match peer {
        PeerInput::Port { port_id } => Some(port_id.as_str()),
        _ => None,
    };

    // The port this one used to be cabled to loses its back-link.
    if let Some(previous) = previous_peer_port
        && Some(previous) != new_peer_port
    {
        clear_back_link(tx, previous, port_id, now).await?;
    }

    match peer {
        PeerInput::None => Ok((None, None, String::new())),
        PeerInput::Text { text } => Ok((None, None, text.trim().to_string())),
        PeerInput::Nic { nic_id } => {
            let nic: Option<(String,)> = sqlx::query_as("SELECT id FROM nics WHERE id = ?")
                .bind(nic_id)
                .fetch_optional(&mut **tx)
                .await?;
            nic.ok_or_else(|| ApiError::BadRequest("nic_id does not exist".into()))?;
            // A NIC has exactly one physical cable, regardless of whether its
            // previous peer was a Tofino port or another server NIC.
            disconnect_nic_peer(tx, nic_id, now).await?;
            // A physical NIC has one cable. Re-cabling it here detaches any
            // Tofino port that previously pointed at the same NIC.
            sqlx::query(
                "UPDATE tofino_ports SET peer_nic_id = NULL, updated_at = ?
                 WHERE peer_nic_id = ? AND id != ?",
            )
            .bind(now)
            .bind(nic_id)
            .bind(port_id)
            .execute(&mut **tx)
            .await?;
            // ...and any management-switch port cabled to the same NIC.
            detach_nic_from_management_ports(tx, nic_id, now).await?;
            Ok((None, Some(nic_id.clone()), String::new()))
        }
        PeerInput::Port { port_id: target } => {
            if target == port_id {
                return Err(ApiError::BadRequest(
                    "a port cannot be plugged into itself".into(),
                ));
            }
            let row: Option<(Option<String>,)> =
                sqlx::query_as("SELECT peer_port_id FROM tofino_ports WHERE id = ?")
                    .bind(target)
                    .fetch_optional(&mut **tx)
                    .await?;
            let (target_peer,) =
                row.ok_or_else(|| ApiError::BadRequest("port_id does not exist".into()))?;

            // Whoever the target was cabled to loses its back-link too.
            if let Some(third) = target_peer.as_deref()
                && third != port_id
            {
                clear_back_link(tx, third, target, now).await?;
            }
            sqlx::query(
                "UPDATE tofino_ports SET peer_port_id = ?, peer_nic_id = NULL, peer_text = '',
                                         updated_at = ?
                 WHERE id = ?",
            )
            .bind(port_id)
            .bind(now)
            .bind(target)
            .execute(&mut **tx)
            .await?;
            Ok((Some(target.clone()), None, String::new()))
        }
    }
}

/// Updates the canonical Tofino-port → NIC relation from the NIC editor.
/// Passing no port disconnects the NIC; passing a port reuses the same
/// mirroring/detachment rules as editing the Tofino port directly.
pub(crate) async fn connect_nic_to_port(
    tx: &mut Transaction<'_, Sqlite>,
    nic_id: &str,
    port_id: Option<&str>,
    updated_by: &str,
    now: i64,
) -> ApiResult<()> {
    disconnect_nic_peer(tx, nic_id, now).await?;

    let Some(port_id) = port_id else {
        sqlx::query(
            "UPDATE tofino_ports SET peer_nic_id = NULL, updated_by = ?, updated_at = ?
             WHERE peer_nic_id = ?",
        )
        .bind(updated_by)
        .bind(now)
        .bind(nic_id)
        .execute(&mut **tx)
        .await?;
        return Ok(());
    };

    let current: Option<(Option<String>,)> =
        sqlx::query_as("SELECT peer_port_id FROM tofino_ports WHERE id = ?")
            .bind(port_id)
            .fetch_optional(&mut **tx)
            .await?;
    let (previous_peer_port,) =
        current.ok_or_else(|| ApiError::BadRequest("port_id does not exist".into()))?;
    let peer = PeerInput::Nic {
        nic_id: nic_id.to_string(),
    };
    let (peer_port, peer_nic, peer_text) =
        apply_peer(tx, port_id, previous_peer_port.as_deref(), &peer, now).await?;
    sqlx::query(
        "UPDATE tofino_ports SET peer_port_id = ?, peer_nic_id = ?, peer_text = '',
                                 updated_by = ?, updated_at = ?
         WHERE id = ?",
    )
    .bind(peer_port)
    .bind(peer_nic)
    .bind(updated_by)
    .bind(now)
    .bind(port_id)
    .execute(&mut **tx)
    .await?;

    debug_assert!(peer_text.is_empty());
    Ok(())
}

/// Updates the canonical management-port → NIC relation from the NIC editor.
/// Passing no port disconnects the NIC from any management port; passing a
/// port reuses the same mirroring/detachment rules as editing the management
/// port directly (`management::ports::apply_peer` with `PeerInput::Nic`), so
/// a physical NIC keeps exactly one cable no matter which side it's edited
/// from.
pub(crate) async fn connect_nic_to_mgmt_port(
    tx: &mut Transaction<'_, Sqlite>,
    nic_id: &str,
    port_id: Option<&str>,
    now: i64,
) -> ApiResult<()> {
    let Some(port_id) = port_id else {
        sqlx::query(
            "UPDATE management_switch_ports SET peer_nic_id = NULL, updated_at = ?
             WHERE peer_nic_id = ?",
        )
        .bind(now)
        .bind(nic_id)
        .execute(&mut **tx)
        .await?;
        return Ok(());
    };

    let current: Option<(Option<String>, Option<String>)> = sqlx::query_as(
        "SELECT peer_port_id, peer_tofino_id FROM management_switch_ports WHERE id = ?",
    )
    .bind(port_id)
    .fetch_optional(&mut **tx)
    .await?;
    let (previous_peer_port, previous_peer_tofino) =
        current.ok_or_else(|| ApiError::BadRequest("port_id does not exist".into()))?;

    let peer = crate::management::ports::PeerInput::Nic {
        nic_id: nic_id.to_string(),
    };
    let (peer_port, peer_nic, peer_tofino, peer_server, peer_text) =
        crate::management::ports::apply_peer(
            tx,
            port_id,
            previous_peer_port.as_deref(),
            previous_peer_tofino.as_deref(),
            &peer,
            now,
        )
        .await?;
    sqlx::query(
        "UPDATE management_switch_ports SET peer_port_id = ?, peer_nic_id = ?,
                                            peer_tofino_id = ?, peer_server_id = ?,
                                            peer_text = ?, updated_at = ?
         WHERE id = ?",
    )
    .bind(peer_port)
    .bind(peer_nic)
    .bind(peer_tofino)
    .bind(peer_server)
    .bind(peer_text)
    .bind(now)
    .bind(port_id)
    .execute(&mut **tx)
    .await?;
    Ok(())
}

/// Connects two server NICs symmetrically. Both endpoints lose any previous
/// Tofino-port or NIC peer first, so every physical NIC retains one cable.
pub(crate) async fn connect_nic_to_nic(
    tx: &mut Transaction<'_, Sqlite>,
    nic_id: &str,
    target_id: &str,
    updated_by: &str,
    now: i64,
) -> ApiResult<()> {
    if nic_id == target_id {
        return Err(ApiError::BadRequest(
            "a NIC cannot be plugged into itself".into(),
        ));
    }

    for id in [nic_id, target_id] {
        let exists: Option<(String,)> = sqlx::query_as("SELECT id FROM nics WHERE id = ?")
            .bind(id)
            .fetch_optional(&mut **tx)
            .await?;
        if exists.is_none() {
            return Err(ApiError::BadRequest("nic_id does not exist".into()));
        }
    }

    for id in [nic_id, target_id] {
        sqlx::query(
            "UPDATE tofino_ports SET peer_nic_id = NULL, updated_by = ?, updated_at = ?
             WHERE peer_nic_id = ?",
        )
        .bind(updated_by)
        .bind(now)
        .bind(id)
        .execute(&mut **tx)
        .await?;
        detach_nic_from_management_ports(tx, id, now).await?;
        disconnect_nic_peer(tx, id, now).await?;
    }

    sqlx::query("UPDATE nics SET peer_nic_id = ?, updated_at = ? WHERE id = ?")
        .bind(target_id)
        .bind(now)
        .bind(nic_id)
        .execute(&mut **tx)
        .await?;
    sqlx::query("UPDATE nics SET peer_nic_id = ?, updated_at = ? WHERE id = ?")
        .bind(nic_id)
        .bind(now)
        .bind(target_id)
        .execute(&mut **tx)
        .await?;
    Ok(())
}

/// Detaches a NIC from every management-switch port cabled to it, keeping the
/// single-physical-cable invariant when the data plane claims a NIC.
async fn detach_nic_from_management_ports(
    tx: &mut Transaction<'_, Sqlite>,
    nic_id: &str,
    now: i64,
) -> ApiResult<()> {
    sqlx::query(
        "UPDATE management_switch_ports SET peer_nic_id = NULL, updated_at = ? WHERE peer_nic_id = ?",
    )
    .bind(now)
    .bind(nic_id)
    .execute(&mut **tx)
    .await?;
    Ok(())
}

/// Removes both ends of a direct NIC link, tolerating an old asymmetric row.
async fn disconnect_nic_peer(
    tx: &mut Transaction<'_, Sqlite>,
    nic_id: &str,
    now: i64,
) -> ApiResult<()> {
    sqlx::query(
        "UPDATE nics SET peer_nic_id = NULL, updated_at = ?
         WHERE id = ? OR peer_nic_id = ?",
    )
    .bind(now)
    .bind(nic_id)
    .bind(nic_id)
    .execute(&mut **tx)
    .await?;
    Ok(())
}

/// One end of a physical link, as seen by the documentation sync below.
#[derive(Clone, Copy)]
pub(crate) enum LinkEndpoint<'a> {
    Port(&'a str),
    Nic(&'a str),
}

/// Cable label and comment describe the cable, not the endpoint, so both ends
/// of a link must show the same values. Call this after writing an endpoint
/// (and after its peer has been (re-)linked): whatever the endpoint is plugged
/// into now gets the same cable label and comment.
///
/// The NIC side stores them on the claim row, which is created on demand — a
/// NIC cabled from the port editor usually has no owner. Nothing is created
/// when there is nothing to document.
pub(crate) async fn sync_cable_documentation(
    tx: &mut Transaction<'_, Sqlite>,
    endpoint: LinkEndpoint<'_>,
    cable_label: &str,
    comment: &str,
    updated_by: &str,
    now: i64,
) -> ApiResult<()> {
    let (peer_port, peer_nic) = match endpoint {
        LinkEndpoint::Port(port_id) => {
            let row: Option<(Option<String>, Option<String>)> =
                sqlx::query_as("SELECT peer_port_id, peer_nic_id FROM tofino_ports WHERE id = ?")
                    .bind(port_id)
                    .fetch_optional(&mut **tx)
                    .await?;
            row.unwrap_or((None, None))
        }
        LinkEndpoint::Nic(nic_id) => {
            let port: Option<(String,)> =
                sqlx::query_as("SELECT id FROM tofino_ports WHERE peer_nic_id = ?")
                    .bind(nic_id)
                    .fetch_optional(&mut **tx)
                    .await?;
            let nic: Option<(Option<String>,)> =
                sqlx::query_as("SELECT peer_nic_id FROM nics WHERE id = ?")
                    .bind(nic_id)
                    .fetch_optional(&mut **tx)
                    .await?;
            (port.map(|(id,)| id), nic.and_then(|(peer,)| peer))
        }
    };

    if let Some(port_id) = peer_port {
        sqlx::query(
            "UPDATE tofino_ports SET cable_label = ?, comment = ?, updated_by = ?, updated_at = ?
             WHERE id = ?",
        )
        .bind(cable_label)
        .bind(comment)
        .bind(updated_by)
        .bind(now)
        .bind(&port_id)
        .execute(&mut **tx)
        .await?;
    }
    if let Some(nic_id) = peer_nic {
        write_nic_cable_documentation(tx, &nic_id, cable_label, comment, updated_by, now).await?;
    }
    Ok(())
}

/// Stores the shared cable documentation on a NIC. Reuses the claim row when
/// there is one (keeping its owner), otherwise adds an owner-less one.
pub(crate) async fn write_nic_cable_documentation(
    tx: &mut Transaction<'_, Sqlite>,
    nic_id: &str,
    cable_label: &str,
    comment: &str,
    updated_by: &str,
    now: i64,
) -> ApiResult<()> {
    let updated = sqlx::query(
        "UPDATE nic_claims SET cable_label = ?, comment = ?, updated_at = ? WHERE nic_id = ?",
    )
    .bind(cable_label)
    .bind(comment)
    .bind(now)
    .bind(nic_id)
    .execute(&mut **tx)
    .await?;
    if updated.rows_affected() > 0 || (cable_label.is_empty() && comment.is_empty()) {
        return Ok(());
    }
    sqlx::query(
        "INSERT INTO nic_claims (id, nic_id, user_id, assignee_name, connected_to,
                                 cable_label, comment, created_by, created_at, updated_at)
         VALUES (?, ?, NULL, '', '', ?, ?, ?, ?, ?)",
    )
    .bind(Uuid::new_v4().to_string())
    .bind(nic_id)
    .bind(cable_label)
    .bind(comment)
    .bind(updated_by)
    .bind(now)
    .bind(now)
    .execute(&mut **tx)
    .await?;
    Ok(())
}

/// Clears `port`'s peer, but only while it still points at `expected_peer`.
async fn clear_back_link(
    tx: &mut Transaction<'_, Sqlite>,
    port: &str,
    expected_peer: &str,
    now: i64,
) -> ApiResult<()> {
    sqlx::query(
        "UPDATE tofino_ports SET peer_port_id = NULL, updated_at = ?
         WHERE id = ? AND peer_port_id = ?",
    )
    .bind(now)
    .bind(port)
    .bind(expected_peer)
    .execute(&mut **tx)
    .await?;
    Ok(())
}

#[utoipa::path(
    delete,
    path = "/api/v1/admin/tofino-ports/{id}",
    tag = "admin",
    params(("id" = String, Path)),
    responses((status = 204, description = "Port deleted"))
)]
pub(crate) async fn delete_port(
    State(state): State<AppState>,
    _admin: AdminUser,
    Path(id): Path<String>,
) -> ApiResult<StatusCode> {
    let result = sqlx::query("DELETE FROM tofino_ports WHERE id = ?")
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
    path = "/api/v1/admin/tofinos/{id}/ports/import",
    tag = "admin",
    params(("id" = String, Path)),
    request_body = ImportPortsRequest,
    responses(
        (status = 200, body = ImportPortsResponse),
        (status = 400, description = "Unparsable table", body = crate::error::ErrorResponse)
    )
)]
pub(crate) async fn import_ports(
    State(state): State<AppState>,
    admin: AdminUser,
    Path(tofino_id): Path<String>,
    Json(input): Json<ImportPortsRequest>,
) -> ApiResult<Json<ImportPortsResponse>> {
    let name = ensure_tofino_exists(&state, &tofino_id).await?;
    let parsed =
        markdown::parse_port_tables(&input.markdown, &name).map_err(ApiError::BadRequest)?;

    let now = now_ts();
    let mut created = 0;
    let mut updated = 0;
    let mut unresolved = Vec::new();
    let mut tx = state.db.begin_with("BEGIN IMMEDIATE").await?;

    // The table is authoritative: known ports are overwritten, new ones added.
    for (index, port) in parsed.iter().enumerate() {
        let sort_order = index as i64 + 1;
        let existing: Option<(String,)> =
            sqlx::query_as("SELECT id FROM tofino_ports WHERE tofino_id = ? AND fp_port = ?")
                .bind(&tofino_id)
                .bind(&port.fp_port)
                .fetch_optional(&mut *tx)
                .await?;
        match existing {
            Some((id,)) => {
                sqlx::query(
                    "UPDATE tofino_ports SET dev_port = ?, pipe = ?, speed_gbps = ?,
                                             cable_label = ?, comment = ?, sort_order = ?,
                                             updated_by = ?, updated_at = ?
                     WHERE id = ?",
                )
                .bind(port.dev_port)
                .bind(&port.pipe)
                .bind(port.speed_gbps)
                .bind(&port.cable_label)
                .bind(&port.comment)
                .bind(sort_order)
                .bind(&admin.0.id)
                .bind(now)
                .bind(&id)
                .execute(&mut *tx)
                .await?;
                updated += 1;
            }
            None => {
                sqlx::query(
                    "INSERT INTO tofino_ports (id, tofino_id, fp_port, dev_port, pipe,
                                               speed_gbps, cable_label, comment, sort_order,
                                               updated_by, created_at, updated_at)
                     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)",
                )
                .bind(Uuid::new_v4().to_string())
                .bind(&tofino_id)
                .bind(&port.fp_port)
                .bind(port.dev_port)
                .bind(&port.pipe)
                .bind(port.speed_gbps)
                .bind(&port.cable_label)
                .bind(&port.comment)
                .bind(sort_order)
                .bind(&admin.0.id)
                .bind(now)
                .bind(now)
                .execute(&mut *tx)
                .await?;
                created += 1;
            }
        }
    }

    // Second pass: peers may point at rows this very import created. Use the
    // same recabling path as the interactive editors so reverse links, stale
    // links, and cable documentation stay consistent even when the Markdown
    // only names one end.
    for port in &parsed {
        let (peer_port, peer_nic, peer_text, resolved) = resolve_peer(&mut tx, &port.peer).await?;
        if !resolved {
            unresolved.push(port.peer.trim().to_string());
        }
        let peer = match (peer_port, peer_nic, peer_text) {
            (Some(port_id), None, _) => PeerInput::Port { port_id },
            (None, Some(nic_id), _) => PeerInput::Nic { nic_id },
            (None, None, text) if text.is_empty() => PeerInput::None,
            (None, None, text) => PeerInput::Text { text },
            _ => unreachable!("resolve_peer returns exactly one peer kind"),
        };
        let source: (String, Option<String>) = sqlx::query_as(
            "SELECT id, peer_port_id FROM tofino_ports WHERE tofino_id = ? AND fp_port = ?",
        )
        .bind(&tofino_id)
        .bind(&port.fp_port)
        .fetch_one(&mut *tx)
        .await?;
        let (source_id, previous_peer_port) = source;
        let (peer_port, peer_nic, peer_text) = apply_peer(
            &mut tx,
            &source_id,
            previous_peer_port.as_deref(),
            &peer,
            now,
        )
        .await?;
        sqlx::query(
            "UPDATE tofino_ports SET peer_port_id = ?, peer_nic_id = ?, peer_text = ?
             WHERE id = ?",
        )
        .bind(&peer_port)
        .bind(&peer_nic)
        .bind(&peer_text)
        .bind(&source_id)
        .execute(&mut *tx)
        .await?;
        sync_cable_documentation(
            &mut tx,
            LinkEndpoint::Port(&source_id),
            &port.cable_label,
            &port.comment,
            &admin.0.id,
            now,
        )
        .await?;
    }
    tx.commit().await?;

    Ok(Json(ImportPortsResponse {
        created,
        updated,
        unresolved,
    }))
}

/// Maps a raw "Plugged into" cell onto a Tofino port or a server NIC. Anything
/// unknown is kept verbatim as free text and reported back to the admin.
async fn resolve_peer(
    tx: &mut Transaction<'_, Sqlite>,
    raw: &str,
) -> ApiResult<(Option<String>, Option<String>, String, bool)> {
    let raw = raw.trim();
    if raw.is_empty() {
        return Ok((None, None, String::new(), true));
    }
    let Some((device, port_ref)) = markdown::split_peer(raw) else {
        return Ok((None, None, raw.to_string(), false));
    };

    let tofino: Option<(String,)> =
        sqlx::query_as("SELECT id FROM tofinos WHERE lower(name) = lower(?)")
            .bind(device)
            .fetch_optional(&mut **tx)
            .await?;
    if let Some((peer_tofino_id,)) = tofino {
        let fp_port = markdown::normalize_fp_port(port_ref);
        let port: Option<(String,)> =
            sqlx::query_as("SELECT id FROM tofino_ports WHERE tofino_id = ? AND fp_port = ?")
                .bind(&peer_tofino_id)
                .bind(&fp_port)
                .fetch_optional(&mut **tx)
                .await?;
        return Ok(match port {
            Some((id,)) => (Some(id), None, String::new(), true),
            None => (None, None, raw.to_string(), false),
        });
    }

    let nic: Option<(String,)> = sqlx::query_as(
        "SELECT n.id FROM nics n
         JOIN servers s ON s.id = n.server_id
         WHERE lower(s.name) = lower(?) AND lower(n.name) = lower(?)",
    )
    .bind(device)
    .bind(port_ref)
    .fetch_optional(&mut **tx)
    .await?;
    Ok(match nic {
        Some((id,)) => (None, Some(id), String::new(), true),
        None => (None, None, raw.to_string(), false),
    })
}

/// Returns the Tofino's name, which the importer uses to pick its section.
async fn ensure_tofino_exists(state: &AppState, id: &str) -> ApiResult<String> {
    let row: Option<(String,)> = sqlx::query_as("SELECT name FROM tofinos WHERE id = ?")
        .bind(id)
        .fetch_optional(&state.db)
        .await?;
    row.map(|(name,)| name).ok_or(ApiError::NotFound)
}

fn validate_speed(speed_gbps: f64) -> ApiResult<()> {
    if !speed_gbps.is_finite() || speed_gbps < 0.0 {
        return Err(ApiError::BadRequest(
            "speed_gbps must be zero or positive".into(),
        ));
    }
    Ok(())
}
