//! Management-switch ports, their VLAN membership, and physical links.
//!
//! A port is "plugged into" at most one of: another management-switch port
//! (mirrored A↔B), a server NIC, a Tofino's management port (mirrored onto
//! `tofinos.mgmt_peer_port_id`), or free text. The mirroring, back-link
//! clearing, single-cable-per-NIC invariant and shared cable documentation
//! follow the Tofino port map (`crate::ports`) exactly.

use axum::{
    Json, Router,
    extract::{Path, Query, State},
    http::StatusCode,
    routing::{get, patch, post},
};
use serde::{Deserialize, Serialize};
use sqlx::{Sqlite, Transaction};
use std::collections::HashMap;
use utoipa::{IntoParams, ToSchema};
use uuid::Uuid;

use crate::{
    AppState,
    auth::AdminUser,
    db::now_ts,
    error::{ApiError, ApiResult},
    ports::write_nic_cable_documentation,
};

pub fn router() -> Router<AppState> {
    Router::new()
        .route("/management-switch-ports", get(list_ports))
        .route("/admin/management-switches/{id}/ports", post(create_port))
        .route(
            "/admin/management-switches/{id}/import",
            post(import_switch),
        )
        .route("/admin/management-switch-ports/{id}", patch(update_port))
}

// ---------------------------------------------------------------------------
// Views
// ---------------------------------------------------------------------------

#[derive(Serialize, ToSchema, Clone)]
pub struct PortVlanView {
    /// 802.1Q VLAN number.
    pub vlan_id: i64,
    /// Row id in the global VLAN database.
    pub vlan_db_id: String,
    pub name: String,
    pub purpose: String,
    /// true = tagged (trunk), false = untagged (native/access).
    pub tagged: bool,
}

#[derive(Serialize, ToSchema)]
pub struct ManagementPortView {
    pub id: String,
    pub switch_id: String,
    pub switch_name: String,
    /// Port label, e.g. "1" / "Gi0/1".
    pub name: String,
    pub ifname: String,
    pub ifindex: Option<i64>,
    pub speed_gbps: f64,
    pub cable_label: String,
    /// Set when cabled to another management-switch port.
    pub peer_port_id: Option<String>,
    pub peer_port_switch_id: Option<String>,
    /// Set when cabled to a server NIC.
    pub peer_nic_id: Option<String>,
    pub peer_nic_server_id: Option<String>,
    /// Set when cabled to a Tofino's management port.
    pub peer_tofino_id: Option<String>,
    /// Set when plugged into a whole server (no specific NIC), e.g. its IPMI port.
    pub peer_server_id: Option<String>,
    /// Free-text peer, used when none of the structured peers is referenced.
    pub peer_text: String,
    /// Display label of whatever this port is plugged into; empty when unplugged.
    pub peer_label: String,
    pub comment: String,
    pub sort_order: i64,
    pub updated_by_display_name: Option<String>,
    pub updated_at: i64,
    pub vlans: Vec<PortVlanView>,
}

#[derive(Serialize, ToSchema)]
pub struct ManagementPortsResponse {
    pub ports: Vec<ManagementPortView>,
}

#[derive(Deserialize, IntoParams)]
pub(crate) struct ListPortsQuery {
    /// Restrict to one switch; omit for every port (peer picker / topology).
    pub switch_id: Option<String>,
}

#[derive(Deserialize, ToSchema)]
pub struct PortVlanInput {
    pub vlan_id: i64,
    pub tagged: bool,
}

#[derive(Deserialize, ToSchema)]
pub struct CreatePortRequest {
    pub name: String,
    pub ifname: Option<String>,
    pub ifindex: Option<i64>,
    pub speed_gbps: Option<f64>,
    pub cable_label: Option<String>,
    pub comment: Option<String>,
    pub sort_order: Option<i64>,
}

#[derive(Deserialize, ToSchema)]
pub struct UpdatePortRequest {
    pub name: Option<String>,
    pub ifname: Option<String>,
    pub ifindex: Option<i64>,
    pub speed_gbps: Option<f64>,
    pub cable_label: Option<String>,
    pub comment: Option<String>,
    pub sort_order: Option<i64>,
    /// Replaces the whole "plugged into" side when present.
    pub peer: Option<PeerInput>,
    /// Replaces the whole VLAN membership set when present.
    pub vlans: Option<Vec<PortVlanInput>>,
}

/// What a port is plugged into. `port`/`tofino` links are mirrored onto the
/// other end.
#[derive(Deserialize, ToSchema)]
#[serde(tag = "kind", rename_all = "snake_case")]
pub enum PeerInput {
    None,
    Port {
        port_id: String,
    },
    Nic {
        nic_id: String,
    },
    Tofino {
        tofino_id: String,
    },
    /// A whole server, with no specific NIC/interface (e.g. its dedicated
    /// IPMI/BMC port). Not mirrored — the server has no back-link.
    Server {
        server_id: String,
    },
    Text {
        text: String,
    },
}

// ---------------------------------------------------------------------------
// SELECT + row mapping
// ---------------------------------------------------------------------------

#[derive(sqlx::FromRow)]
struct PortRow {
    id: String,
    switch_id: String,
    switch_name: String,
    name: String,
    ifname: String,
    ifindex: Option<i64>,
    speed_gbps: f64,
    cable_label: String,
    peer_port_id: Option<String>,
    peer_port_switch_id: Option<String>,
    peer_port_switch_name: Option<String>,
    peer_port_name: Option<String>,
    peer_nic_id: Option<String>,
    peer_nic_name: Option<String>,
    peer_nic_server_id: Option<String>,
    peer_nic_server_name: Option<String>,
    peer_tofino_id: Option<String>,
    peer_tofino_name: Option<String>,
    peer_server_id: Option<String>,
    peer_server_name: Option<String>,
    peer_text: String,
    comment: String,
    sort_order: i64,
    updated_by_display_name: Option<String>,
    updated_at: i64,
}

/// Current values a PATCH may leave untouched, plus the previous structured
/// peers needed to clear stale back-links: (name, ifname, ifindex, speed,
/// cable_label, comment, sort_order, peer_port_id, peer_tofino_id).
type EditableRow = (
    String,
    String,
    Option<i64>,
    f64,
    String,
    String,
    i64,
    Option<String>,
    Option<String>,
);

macro_rules! port_select {
    () => {
        "SELECT p.id, p.switch_id, sw.name AS switch_name, p.name, p.ifname, p.ifindex,
                p.speed_gbps, p.cable_label,
                p.peer_port_id, pp.switch_id AS peer_port_switch_id,
                pps.name AS peer_port_switch_name, pp.name AS peer_port_name,
                p.peer_nic_id, n.name AS peer_nic_name,
                n.server_id AS peer_nic_server_id, s.name AS peer_nic_server_name,
                p.peer_tofino_id, tof.name AS peer_tofino_name,
                p.peer_server_id, psrv.name AS peer_server_name,
                p.peer_text, p.comment, p.sort_order,
                u.display_name AS updated_by_display_name, p.updated_at
         FROM management_switch_ports p
         JOIN management_switches sw ON sw.id = p.switch_id
         LEFT JOIN management_switch_ports pp ON pp.id = p.peer_port_id
         LEFT JOIN management_switches pps ON pps.id = pp.switch_id
         LEFT JOIN nics n ON n.id = p.peer_nic_id
         LEFT JOIN servers s ON s.id = n.server_id
         LEFT JOIN tofinos tof ON tof.id = p.peer_tofino_id
         LEFT JOIN servers psrv ON psrv.id = p.peer_server_id
         LEFT JOIN users u ON u.id = p.updated_by"
    };
}

fn port_view(row: PortRow, vlans: Vec<PortVlanView>) -> ManagementPortView {
    let peer_label = match (
        row.peer_port_switch_name.as_deref(),
        row.peer_port_name.as_deref(),
        row.peer_nic_server_name.as_deref(),
        row.peer_nic_name.as_deref(),
        row.peer_tofino_name.as_deref(),
        row.peer_server_name.as_deref(),
    ) {
        (Some(switch), Some(port), _, _, _, _) => format!("{switch} {port}"),
        (_, _, Some(server), Some(nic), _, _) => format!("{server} {nic}"),
        (_, _, _, _, Some(tofino), _) => format!("{tofino} (mgmt)"),
        (_, _, _, _, _, Some(server)) => format!("{server} (IPMI)"),
        _ => row.peer_text.clone(),
    };

    ManagementPortView {
        id: row.id,
        switch_id: row.switch_id,
        switch_name: row.switch_name,
        name: row.name,
        ifname: row.ifname,
        ifindex: row.ifindex,
        speed_gbps: row.speed_gbps,
        cable_label: row.cable_label,
        peer_port_id: row.peer_port_id,
        peer_port_switch_id: row.peer_port_switch_id,
        peer_nic_id: row.peer_nic_id,
        peer_nic_server_id: row.peer_nic_server_id,
        peer_tofino_id: row.peer_tofino_id,
        peer_server_id: row.peer_server_id,
        peer_text: row.peer_text,
        peer_label,
        comment: row.comment,
        sort_order: row.sort_order,
        updated_by_display_name: row.updated_by_display_name,
        updated_at: row.updated_at,
        vlans,
    }
}

#[derive(sqlx::FromRow)]
struct VlanMemberRow {
    port_id: String,
    vlan_id: i64,
    vlan_db_id: String,
    name: String,
    purpose: String,
    tagged: i64,
}

macro_rules! vlan_member_select {
    () => {
        "SELECT mpv.port_id, v.vlan_id, v.id AS vlan_db_id, v.name, v.purpose, mpv.tagged
         FROM management_port_vlans mpv
         JOIN vlans v ON v.id = mpv.vlan_id"
    };
}

fn member_view(row: &VlanMemberRow) -> PortVlanView {
    PortVlanView {
        vlan_id: row.vlan_id,
        vlan_db_id: row.vlan_db_id.clone(),
        name: row.name.clone(),
        purpose: row.purpose.clone(),
        tagged: row.tagged != 0,
    }
}

async fn load_port_view(state: &AppState, id: &str) -> ApiResult<ManagementPortView> {
    let row: Option<PortRow> = sqlx::query_as(concat!(port_select!(), " WHERE p.id = ?"))
        .bind(id)
        .fetch_optional(&state.db)
        .await?;
    let row = row.ok_or(ApiError::NotFound)?;
    let members: Vec<VlanMemberRow> = sqlx::query_as(concat!(
        vlan_member_select!(),
        " WHERE mpv.port_id = ? ORDER BY v.vlan_id"
    ))
    .bind(id)
    .fetch_all(&state.db)
    .await?;
    let vlans = members.iter().map(member_view).collect();
    Ok(port_view(row, vlans))
}

// ---------------------------------------------------------------------------
// Read
// ---------------------------------------------------------------------------

#[utoipa::path(
    get,
    path = "/api/v1/management-switch-ports",
    tag = "management",
    operation_id = "management_list_ports",
    params(ListPortsQuery),
    responses((status = 200, body = ManagementPortsResponse))
)]
pub(crate) async fn list_ports(
    State(state): State<AppState>,
    _admin: AdminUser,
    Query(query): Query<ListPortsQuery>,
) -> ApiResult<Json<ManagementPortsResponse>> {
    let rows: Vec<PortRow> = sqlx::query_as(concat!(
        port_select!(),
        " WHERE (? IS NULL OR p.switch_id = ?)
          ORDER BY sw.name, p.sort_order, p.name"
    ))
    .bind(&query.switch_id)
    .bind(&query.switch_id)
    .fetch_all(&state.db)
    .await?;

    let members: Vec<VlanMemberRow> = sqlx::query_as(concat!(
        vlan_member_select!(),
        " JOIN management_switch_ports p ON p.id = mpv.port_id
          WHERE (? IS NULL OR p.switch_id = ?)
          ORDER BY v.vlan_id"
    ))
    .bind(&query.switch_id)
    .bind(&query.switch_id)
    .fetch_all(&state.db)
    .await?;

    let mut by_port: HashMap<String, Vec<PortVlanView>> = HashMap::new();
    for row in &members {
        by_port
            .entry(row.port_id.clone())
            .or_default()
            .push(member_view(row));
    }

    Ok(Json(ManagementPortsResponse {
        ports: rows
            .into_iter()
            .map(|row| {
                let vlans = by_port.remove(&row.id).unwrap_or_default();
                port_view(row, vlans)
            })
            .collect(),
    }))
}

// ---------------------------------------------------------------------------
// Create / update / delete
// ---------------------------------------------------------------------------

#[utoipa::path(
    post,
    path = "/api/v1/admin/management-switches/{id}/ports",
    tag = "admin",
    operation_id = "management_create_port",
    params(("id" = String, Path)),
    request_body = CreatePortRequest,
    responses(
        (status = 201, body = ManagementPortView),
        (status = 409, description = "Port already documented", body = crate::error::ErrorResponse)
    )
)]
pub(crate) async fn create_port(
    State(state): State<AppState>,
    admin: AdminUser,
    Path(switch_id): Path<String>,
    Json(input): Json<CreatePortRequest>,
) -> ApiResult<(StatusCode, Json<ManagementPortView>)> {
    ensure_switch_exists(&state, &switch_id).await?;
    let name = input.name.trim();
    if name.is_empty() {
        return Err(ApiError::BadRequest("name must not be empty".into()));
    }
    validate_speed(input.speed_gbps.unwrap_or(0.0))?;

    let id = Uuid::new_v4().to_string();
    let now = now_ts();
    sqlx::query(
        "INSERT INTO management_switch_ports (id, switch_id, name, ifname, ifindex, speed_gbps,
                                              cable_label, comment, sort_order, updated_by,
                                              created_at, updated_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)",
    )
    .bind(&id)
    .bind(&switch_id)
    .bind(name)
    .bind(input.ifname.as_deref().unwrap_or("").trim())
    .bind(input.ifindex)
    .bind(input.speed_gbps.unwrap_or(0.0))
    .bind(input.cable_label.as_deref().unwrap_or("").trim())
    .bind(input.comment.as_deref().unwrap_or("").trim())
    .bind(input.sort_order.unwrap_or(0))
    .bind(&admin.0.id)
    .bind(now)
    .bind(now)
    .execute(&state.db)
    .await
    .map_err(|err| ApiError::conflict_on_unique(err, "this port already exists"))?;

    Ok((
        StatusCode::CREATED,
        Json(load_port_view(&state, &id).await?),
    ))
}

#[utoipa::path(
    patch,
    path = "/api/v1/admin/management-switch-ports/{id}",
    tag = "admin",
    operation_id = "management_update_port",
    params(("id" = String, Path)),
    request_body = UpdatePortRequest,
    responses(
        (status = 200, body = ManagementPortView),
        (status = 409, description = "Port already documented", body = crate::error::ErrorResponse)
    )
)]
pub(crate) async fn update_port(
    State(state): State<AppState>,
    admin: AdminUser,
    Path(id): Path<String>,
    Json(input): Json<UpdatePortRequest>,
) -> ApiResult<Json<ManagementPortView>> {
    let existing: Option<EditableRow> = sqlx::query_as(
        "SELECT name, ifname, ifindex, speed_gbps, cable_label, comment, sort_order,
                peer_port_id, peer_tofino_id
         FROM management_switch_ports WHERE id = ?",
    )
    .bind(&id)
    .fetch_optional(&state.db)
    .await?;
    let (
        name,
        ifname,
        ifindex,
        speed_gbps,
        cable_label,
        comment,
        sort_order,
        peer_port_id,
        peer_tofino_id,
    ) = existing.ok_or(ApiError::NotFound)?;

    let name = match input.name {
        Some(value) => {
            let trimmed = value.trim().to_string();
            if trimmed.is_empty() {
                return Err(ApiError::BadRequest("name must not be empty".into()));
            }
            trimmed
        }
        None => name,
    };
    let ifname = input.ifname.unwrap_or(ifname);
    let ifindex = input.ifindex.or(ifindex);
    let speed_gbps = input.speed_gbps.unwrap_or(speed_gbps);
    validate_speed(speed_gbps)?;
    let cable_label = input.cable_label.unwrap_or(cable_label);
    let comment = input.comment.unwrap_or(comment);
    let sort_order = input.sort_order.unwrap_or(sort_order);
    let now = now_ts();

    let mut tx = state.db.begin_with("BEGIN IMMEDIATE").await?;
    sqlx::query(
        "UPDATE management_switch_ports SET name = ?, ifname = ?, ifindex = ?, speed_gbps = ?,
                                            cable_label = ?, comment = ?, sort_order = ?,
                                            updated_by = ?, updated_at = ?
         WHERE id = ?",
    )
    .bind(&name)
    .bind(ifname.trim())
    .bind(ifindex)
    .bind(speed_gbps)
    .bind(cable_label.trim())
    .bind(comment.trim())
    .bind(sort_order)
    .bind(&admin.0.id)
    .bind(now)
    .bind(&id)
    .execute(&mut *tx)
    .await
    .map_err(|err| ApiError::conflict_on_unique(err, "this port already exists"))?;

    if let Some(peer) = &input.peer {
        let (peer_port, peer_nic, peer_tofino, peer_server, peer_text) = apply_peer(
            &mut tx,
            &id,
            peer_port_id.as_deref(),
            peer_tofino_id.as_deref(),
            peer,
            now,
        )
        .await?;
        sqlx::query(
            "UPDATE management_switch_ports SET peer_port_id = ?, peer_nic_id = ?,
                                                peer_tofino_id = ?, peer_server_id = ?,
                                                peer_text = ?
             WHERE id = ?",
        )
        .bind(&peer_port)
        .bind(&peer_nic)
        .bind(&peer_tofino)
        .bind(&peer_server)
        .bind(&peer_text)
        .bind(&id)
        .execute(&mut *tx)
        .await?;
    }
    // Runs after the peer switch so a re-cabled link takes the documentation
    // with it instead of leaving it on the old endpoint.
    sync_cable_documentation(
        &mut tx,
        &id,
        cable_label.trim(),
        comment.trim(),
        &admin.0.id,
        now,
    )
    .await?;

    if let Some(vlans) = &input.vlans {
        replace_linked_port_vlans(&mut tx, &id, vlans).await?;
    } else if matches!(input.peer, Some(PeerInput::Port { .. })) {
        // Linking two existing ports should immediately give both ends one
        // consistent VLAN set. Prefer the edited/source port unless it has no
        // memberships yet, in which case preserve the documented peer set.
        synchronize_new_port_link_vlans(&mut tx, &id).await?;
    }
    tx.commit().await?;

    Ok(Json(load_port_view(&state, &id).await?))
}

// ---------------------------------------------------------------------------
// Link mirroring
// ---------------------------------------------------------------------------

/// Points the other end back at `port_id` and detaches links this change
/// breaks. Returns `(peer_port, peer_nic, peer_tofino, peer_server, peer_text)`
/// to store on `port_id` itself.
pub(crate) async fn apply_peer(
    tx: &mut Transaction<'_, Sqlite>,
    port_id: &str,
    previous_peer_port: Option<&str>,
    previous_peer_tofino: Option<&str>,
    peer: &PeerInput,
    now: i64,
) -> ApiResult<(
    Option<String>,
    Option<String>,
    Option<String>,
    Option<String>,
    String,
)> {
    let new_peer_port = match peer {
        PeerInput::Port { port_id } => Some(port_id.as_str()),
        _ => None,
    };
    let new_peer_tofino = match peer {
        PeerInput::Tofino { tofino_id } => Some(tofino_id.as_str()),
        _ => None,
    };

    // Whatever this port used to be cabled to loses its back-link.
    if let Some(previous) = previous_peer_port
        && Some(previous) != new_peer_port
    {
        clear_port_back_link(tx, previous, port_id, now).await?;
    }
    if let Some(previous) = previous_peer_tofino
        && Some(previous) != new_peer_tofino
    {
        clear_tofino_back_link(tx, previous, port_id).await?;
    }

    match peer {
        PeerInput::None => Ok((None, None, None, None, String::new())),
        PeerInput::Text { text } => Ok((None, None, None, None, text.trim().to_string())),
        PeerInput::Server { server_id } => {
            let server: Option<(String,)> = sqlx::query_as("SELECT id FROM servers WHERE id = ?")
                .bind(server_id)
                .fetch_optional(&mut **tx)
                .await?;
            server.ok_or_else(|| ApiError::BadRequest("server_id does not exist".into()))?;
            Ok((None, None, None, Some(server_id.clone()), String::new()))
        }
        PeerInput::Nic { nic_id } => {
            let nic: Option<(String,)> = sqlx::query_as("SELECT id FROM nics WHERE id = ?")
                .bind(nic_id)
                .fetch_optional(&mut **tx)
                .await?;
            nic.ok_or_else(|| ApiError::BadRequest("nic_id does not exist".into()))?;
            // A physical NIC has exactly one cable. Detach it from every kind of
            // link it might currently have: a direct NIC link, a Tofino port,
            // and any other management-switch port.
            detach_nic_everywhere(tx, nic_id, Some(port_id), now).await?;
            Ok((None, Some(nic_id.clone()), None, None, String::new()))
        }
        PeerInput::Port { port_id: target } => {
            if target == port_id {
                return Err(ApiError::BadRequest(
                    "a port cannot be plugged into itself".into(),
                ));
            }
            let row: Option<(Option<String>, Option<String>)> = sqlx::query_as(
                "SELECT peer_port_id, peer_tofino_id FROM management_switch_ports WHERE id = ?",
            )
            .bind(target)
            .fetch_optional(&mut **tx)
            .await?;
            let (target_peer_port, target_peer_tofino) =
                row.ok_or_else(|| ApiError::BadRequest("port_id does not exist".into()))?;

            // Whoever the target was cabled to loses its back-link too.
            if let Some(third) = target_peer_port.as_deref()
                && third != port_id
            {
                clear_port_back_link(tx, third, target, now).await?;
            }
            if let Some(tofino) = target_peer_tofino.as_deref() {
                clear_tofino_back_link(tx, tofino, target).await?;
            }
            sqlx::query(
                "UPDATE management_switch_ports SET peer_port_id = ?, peer_nic_id = NULL,
                                                    peer_tofino_id = NULL, peer_server_id = NULL,
                                                    peer_text = '', updated_at = ?
                 WHERE id = ?",
            )
            .bind(port_id)
            .bind(now)
            .bind(target)
            .execute(&mut **tx)
            .await?;
            Ok((Some(target.clone()), None, None, None, String::new()))
        }
        PeerInput::Tofino { tofino_id } => {
            let tofino: Option<(String,)> = sqlx::query_as("SELECT id FROM tofinos WHERE id = ?")
                .bind(tofino_id)
                .fetch_optional(&mut **tx)
                .await?;
            tofino.ok_or_else(|| ApiError::BadRequest("tofino_id does not exist".into()))?;
            // A Tofino's single management port has one cable: detach any other
            // management-switch port pointing at it, then point it back here.
            sqlx::query(
                "UPDATE management_switch_ports SET peer_tofino_id = NULL, updated_at = ?
                 WHERE peer_tofino_id = ? AND id != ?",
            )
            .bind(now)
            .bind(tofino_id)
            .bind(port_id)
            .execute(&mut **tx)
            .await?;
            sqlx::query("UPDATE tofinos SET mgmt_peer_port_id = ? WHERE id = ?")
                .bind(port_id)
                .bind(tofino_id)
                .execute(&mut **tx)
                .await?;
            Ok((None, None, Some(tofino_id.clone()), None, String::new()))
        }
    }
}

/// Clears `port`'s peer, but only while it still points at `expected_peer`.
async fn clear_port_back_link(
    tx: &mut Transaction<'_, Sqlite>,
    port: &str,
    expected_peer: &str,
    now: i64,
) -> ApiResult<()> {
    sqlx::query(
        "UPDATE management_switch_ports SET peer_port_id = NULL, updated_at = ?
         WHERE id = ? AND peer_port_id = ?",
    )
    .bind(now)
    .bind(port)
    .bind(expected_peer)
    .execute(&mut **tx)
    .await?;
    Ok(())
}

/// Clears a Tofino's management back-link, but only while it still points at
/// `expected_port`.
async fn clear_tofino_back_link(
    tx: &mut Transaction<'_, Sqlite>,
    tofino_id: &str,
    expected_port: &str,
) -> ApiResult<()> {
    sqlx::query(
        "UPDATE tofinos SET mgmt_peer_port_id = NULL WHERE id = ? AND mgmt_peer_port_id = ?",
    )
    .bind(tofino_id)
    .bind(expected_port)
    .execute(&mut **tx)
    .await?;
    Ok(())
}

/// Removes a NIC from every physical link it might have (a direct NIC link, a
/// Tofino port, and management-switch ports), so it keeps exactly one cable.
/// `keep_port` is the management port that is about to claim it, if any.
/// Shared with `ports::connect_nic_to_mgmt_port` so the NIC editor can link a
/// NIC to a management port too.
pub(crate) async fn detach_nic_everywhere(
    tx: &mut Transaction<'_, Sqlite>,
    nic_id: &str,
    keep_port: Option<&str>,
    now: i64,
) -> ApiResult<()> {
    // Direct NIC↔NIC link, both directions.
    sqlx::query(
        "UPDATE nics SET peer_nic_id = NULL, updated_at = ? WHERE id = ? OR peer_nic_id = ?",
    )
    .bind(now)
    .bind(nic_id)
    .bind(nic_id)
    .execute(&mut **tx)
    .await?;
    // Tofino data-plane port.
    sqlx::query("UPDATE tofino_ports SET peer_nic_id = NULL, updated_at = ? WHERE peer_nic_id = ?")
        .bind(now)
        .bind(nic_id)
        .execute(&mut **tx)
        .await?;
    // Other management-switch ports.
    sqlx::query(
        "UPDATE management_switch_ports SET peer_nic_id = NULL, updated_at = ?
         WHERE peer_nic_id = ? AND (? IS NULL OR id != ?)",
    )
    .bind(now)
    .bind(nic_id)
    .bind(keep_port)
    .bind(keep_port)
    .execute(&mut **tx)
    .await?;
    Ok(())
}

/// Cable label and comment describe the cable, so both ends of a link show the
/// same values. Runs after the peer switch: whatever the port is plugged into
/// now gets the same cable label and comment. The Tofino management port has no
/// storage of its own, so a Tofino peer is intentionally not written to.
async fn sync_cable_documentation(
    tx: &mut Transaction<'_, Sqlite>,
    port_id: &str,
    cable_label: &str,
    comment: &str,
    updated_by: &str,
    now: i64,
) -> ApiResult<()> {
    let row: Option<(Option<String>, Option<String>)> = sqlx::query_as(
        "SELECT peer_port_id, peer_nic_id FROM management_switch_ports WHERE id = ?",
    )
    .bind(port_id)
    .fetch_optional(&mut **tx)
    .await?;
    let (peer_port, peer_nic) = row.unwrap_or((None, None));

    if let Some(peer_port_id) = peer_port {
        sqlx::query(
            "UPDATE management_switch_ports SET cable_label = ?, comment = ?, updated_by = ?,
                                                updated_at = ?
             WHERE id = ?",
        )
        .bind(cable_label)
        .bind(comment)
        .bind(updated_by)
        .bind(now)
        .bind(&peer_port_id)
        .execute(&mut **tx)
        .await?;
    }
    if let Some(nic_id) = peer_nic {
        write_nic_cable_documentation(tx, &nic_id, cable_label, comment, updated_by, now).await?;
    }
    Ok(())
}

/// Replaces a port's whole VLAN membership set. Every referenced VLAN number
/// must already exist in the global VLAN database.
async fn replace_port_vlans(
    tx: &mut Transaction<'_, Sqlite>,
    port_id: &str,
    vlans: &[PortVlanInput],
) -> ApiResult<()> {
    sqlx::query("DELETE FROM management_port_vlans WHERE port_id = ?")
        .bind(port_id)
        .execute(&mut **tx)
        .await?;
    for vlan in vlans {
        let row: Option<(String,)> = sqlx::query_as("SELECT id FROM vlans WHERE vlan_id = ?")
            .bind(vlan.vlan_id)
            .fetch_optional(&mut **tx)
            .await?;
        let (vlan_db_id,) = row.ok_or_else(|| {
            ApiError::BadRequest(format!("VLAN {} is not in the VLAN database", vlan.vlan_id))
        })?;
        sqlx::query(
            "INSERT OR REPLACE INTO management_port_vlans (port_id, vlan_id, tagged)
             VALUES (?, ?, ?)",
        )
        .bind(port_id)
        .bind(&vlan_db_id)
        .bind(vlan.tagged as i64)
        .execute(&mut **tx)
        .await?;
    }
    Ok(())
}

/// Replaces a port's VLAN membership and mirrors the exact set to its linked
/// management-switch peer. VLAN configuration on a physical switch-to-switch
/// cable is deliberately treated as shared link documentation.
async fn replace_linked_port_vlans(
    tx: &mut Transaction<'_, Sqlite>,
    port_id: &str,
    vlans: &[PortVlanInput],
) -> ApiResult<()> {
    replace_port_vlans(tx, port_id, vlans).await?;
    let peer: Option<(String,)> = sqlx::query_as(
        "SELECT peer_port_id FROM management_switch_ports
         WHERE id = ? AND peer_port_id IS NOT NULL",
    )
    .bind(port_id)
    .fetch_optional(&mut **tx)
    .await?;
    if let Some((peer_id,)) = peer {
        replace_port_vlans(tx, &peer_id, vlans).await?;
    }
    Ok(())
}

async fn copy_port_vlans(
    tx: &mut Transaction<'_, Sqlite>,
    source_port_id: &str,
    target_port_id: &str,
) -> ApiResult<()> {
    sqlx::query("DELETE FROM management_port_vlans WHERE port_id = ?")
        .bind(target_port_id)
        .execute(&mut **tx)
        .await?;
    sqlx::query(
        "INSERT INTO management_port_vlans (port_id, vlan_id, tagged)
         SELECT ?, vlan_id, tagged FROM management_port_vlans WHERE port_id = ?",
    )
    .bind(target_port_id)
    .bind(source_port_id)
    .execute(&mut **tx)
    .await?;
    Ok(())
}

async fn synchronize_new_port_link_vlans(
    tx: &mut Transaction<'_, Sqlite>,
    port_id: &str,
) -> ApiResult<()> {
    let peer: Option<(String,)> = sqlx::query_as(
        "SELECT peer_port_id FROM management_switch_ports
         WHERE id = ? AND peer_port_id IS NOT NULL",
    )
    .bind(port_id)
    .fetch_optional(&mut **tx)
    .await?;
    let Some((peer_id,)) = peer else {
        return Ok(());
    };

    let source_count: (i64,) =
        sqlx::query_as("SELECT COUNT(*) FROM management_port_vlans WHERE port_id = ?")
            .bind(port_id)
            .fetch_one(&mut **tx)
            .await?;
    let peer_count: (i64,) =
        sqlx::query_as("SELECT COUNT(*) FROM management_port_vlans WHERE port_id = ?")
            .bind(&peer_id)
            .fetch_one(&mut **tx)
            .await?;

    if source_count.0 == 0 && peer_count.0 > 0 {
        copy_port_vlans(tx, &peer_id, port_id).await
    } else {
        copy_port_vlans(tx, port_id, &peer_id).await
    }
}

// ---------------------------------------------------------------------------
// Discovery import (snmpwalk seed)
// ---------------------------------------------------------------------------

#[derive(Deserialize, ToSchema)]
pub struct ImportSwitchRequest {
    /// Fill-gaps metadata for the switch itself (never overwrites a set value).
    pub mgmt_ip: Option<String>,
    pub model: Option<String>,
    /// VLANs to upsert into the global database, by 802.1Q number.
    #[serde(default)]
    pub vlans: Vec<ImportVlan>,
    /// Ports discovered on the switch, with their VLAN membership.
    #[serde(default)]
    pub ports: Vec<ImportPort>,
}

#[derive(Deserialize, ToSchema)]
pub struct ImportVlan {
    pub vlan_id: i64,
    pub name: Option<String>,
    pub purpose: Option<String>,
}

#[derive(Deserialize, ToSchema)]
pub struct ImportPort {
    pub name: String,
    pub ifname: Option<String>,
    pub ifindex: Option<i64>,
    pub speed_gbps: Option<f64>,
    #[serde(default)]
    pub vlans: Vec<PortVlanInput>,
}

#[derive(Serialize, ToSchema)]
pub struct ImportSwitchResponse {
    pub vlans_created: i64,
    pub ports_created: i64,
    pub ports_updated: i64,
}

#[utoipa::path(
    post,
    path = "/api/v1/admin/management-switches/{id}/import",
    tag = "admin",
    params(("id" = String, Path)),
    request_body = ImportSwitchRequest,
    responses(
        (status = 200, body = ImportSwitchResponse),
        (status = 400, description = "Invalid payload", body = crate::error::ErrorResponse)
    )
)]
pub(crate) async fn import_switch(
    State(state): State<AppState>,
    admin: AdminUser,
    Path(switch_id): Path<String>,
    Json(input): Json<ImportSwitchRequest>,
) -> ApiResult<Json<ImportSwitchResponse>> {
    ensure_switch_exists(&state, &switch_id).await?;
    let now = now_ts();
    let mut vlans_created = 0;
    let mut ports_created = 0;
    let mut ports_updated = 0;
    let mut tx = state.db.begin_with("BEGIN IMMEDIATE").await?;

    // Fill-gaps on the switch metadata (only where empty).
    if let Some(mgmt_ip) = input
        .mgmt_ip
        .as_deref()
        .map(str::trim)
        .filter(|s| !s.is_empty())
    {
        sqlx::query(
            "UPDATE management_switches SET mgmt_ip = ?, updated_at = ?
             WHERE id = ? AND mgmt_ip = ''",
        )
        .bind(mgmt_ip)
        .bind(now)
        .bind(&switch_id)
        .execute(&mut *tx)
        .await?;
    }
    if let Some(model) = input
        .model
        .as_deref()
        .map(str::trim)
        .filter(|s| !s.is_empty())
    {
        sqlx::query(
            "UPDATE management_switches SET model = ?, updated_at = ? WHERE id = ? AND model = ''",
        )
        .bind(model)
        .bind(now)
        .bind(&switch_id)
        .execute(&mut *tx)
        .await?;
    }

    // Upsert VLANs by number, filling empty names.
    for vlan in &input.vlans {
        validate_import_vlan(vlan.vlan_id)?;
        let existing: Option<(String,)> = sqlx::query_as("SELECT id FROM vlans WHERE vlan_id = ?")
            .bind(vlan.vlan_id)
            .fetch_optional(&mut *tx)
            .await?;
        match existing {
            Some(_) => {
                if let Some(name) = vlan
                    .name
                    .as_deref()
                    .map(str::trim)
                    .filter(|s| !s.is_empty())
                {
                    sqlx::query(
                        "UPDATE vlans SET name = ?, updated_at = ? WHERE vlan_id = ? AND name = ''",
                    )
                    .bind(name)
                    .bind(now)
                    .bind(vlan.vlan_id)
                    .execute(&mut *tx)
                    .await?;
                }
            }
            None => {
                sqlx::query(
                    "INSERT INTO vlans (id, vlan_id, name, purpose, created_at, updated_at)
                     VALUES (?, ?, ?, ?, ?, ?)",
                )
                .bind(Uuid::new_v4().to_string())
                .bind(vlan.vlan_id)
                .bind(vlan.name.as_deref().unwrap_or("").trim())
                .bind(vlan.purpose.as_deref().unwrap_or("").trim())
                .bind(now)
                .bind(now)
                .execute(&mut *tx)
                .await?;
                vlans_created += 1;
            }
        }
    }

    // Upsert ports by (switch_id, name), then replace their VLAN membership.
    for (index, port) in input.ports.iter().enumerate() {
        let name = port.name.trim();
        if name.is_empty() {
            return Err(ApiError::BadRequest("port name must not be empty".into()));
        }
        validate_speed(port.speed_gbps.unwrap_or(0.0))?;
        let sort_order = index as i64 + 1;
        let existing: Option<(String,)> = sqlx::query_as(
            "SELECT id FROM management_switch_ports WHERE switch_id = ? AND name = ?",
        )
        .bind(&switch_id)
        .bind(name)
        .fetch_optional(&mut *tx)
        .await?;
        let port_id = match existing {
            Some((id,)) => {
                // Fill gaps only: never clobber admin-corrected facts.
                sqlx::query(
                    "UPDATE management_switch_ports
                     SET ifname = CASE WHEN ifname = '' THEN ? ELSE ifname END,
                         ifindex = COALESCE(ifindex, ?),
                         speed_gbps = CASE WHEN speed_gbps = 0 THEN ? ELSE speed_gbps END,
                         updated_by = ?, updated_at = ?
                     WHERE id = ?",
                )
                .bind(port.ifname.as_deref().unwrap_or("").trim())
                .bind(port.ifindex)
                .bind(port.speed_gbps.unwrap_or(0.0))
                .bind(&admin.0.id)
                .bind(now)
                .bind(&id)
                .execute(&mut *tx)
                .await?;
                ports_updated += 1;
                id
            }
            None => {
                let id = Uuid::new_v4().to_string();
                sqlx::query(
                    "INSERT INTO management_switch_ports (id, switch_id, name, ifname, ifindex,
                                                          speed_gbps, sort_order, updated_by,
                                                          created_at, updated_at)
                     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)",
                )
                .bind(&id)
                .bind(&switch_id)
                .bind(name)
                .bind(port.ifname.as_deref().unwrap_or("").trim())
                .bind(port.ifindex)
                .bind(port.speed_gbps.unwrap_or(0.0))
                .bind(sort_order)
                .bind(&admin.0.id)
                .bind(now)
                .bind(now)
                .execute(&mut *tx)
                .await?;
                ports_created += 1;
                id
            }
        };
        // Membership is the whole point of re-running discovery: replace it.
        replace_linked_port_vlans(&mut tx, &port_id, &port.vlans).await?;
    }
    tx.commit().await?;

    Ok(Json(ImportSwitchResponse {
        vlans_created,
        ports_created,
        ports_updated,
    }))
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

async fn ensure_switch_exists(state: &AppState, id: &str) -> ApiResult<()> {
    let row: Option<(String,)> = sqlx::query_as("SELECT id FROM management_switches WHERE id = ?")
        .bind(id)
        .fetch_optional(&state.db)
        .await?;
    row.map(|_| ()).ok_or(ApiError::NotFound)
}

fn validate_import_vlan(vlan_id: i64) -> ApiResult<()> {
    if !(1..=4094).contains(&vlan_id) {
        return Err(ApiError::BadRequest(
            "vlan_id must be between 1 and 4094".into(),
        ));
    }
    Ok(())
}

fn validate_speed(speed_gbps: f64) -> ApiResult<()> {
    if !speed_gbps.is_finite() || speed_gbps < 0.0 {
        return Err(ApiError::BadRequest(
            "speed_gbps must be zero or positive".into(),
        ));
    }
    Ok(())
}
