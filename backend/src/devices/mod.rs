use axum::{
    Json, Router,
    extract::{Path, State},
    http::StatusCode,
    routing::{get, patch, post, put},
};
use serde::{Deserialize, Serialize};
use utoipa::ToSchema;
use uuid::Uuid;

use crate::{
    AppState,
    auth::{AdminUser, CurrentUser},
    db::now_ts,
    error::{ApiError, ApiResult},
    ports,
};

/// Tofino read query, including the read-only management-link label. A macro so
/// the composed strings stay `&'static str`, as sqlx requires.
macro_rules! tofino_select {
    () => {
        "SELECT t.id, t.name, t.version, t.notes, t.active, t.created_at,
                t.updated_at, ms.name AS mgmt_switch_name, mp.name AS mgmt_port_name
         FROM tofinos t
         LEFT JOIN management_switch_ports mp ON mp.id = t.mgmt_peer_port_id
         LEFT JOIN management_switches ms ON ms.id = mp.switch_id"
    };
}

pub fn router() -> Router<AppState> {
    Router::new()
        .route("/servers", get(list_servers))
        .route("/tofinos", get(list_tofinos))
        .route("/admin/servers", post(create_server))
        .route(
            "/admin/servers/{id}",
            patch(update_server).delete(delete_server),
        )
        .route("/admin/servers/{id}/nics", post(create_nic))
        .route("/admin/nics/{id}", patch(update_nic).delete(delete_nic))
        .route(
            "/admin/nics/{id}/claim",
            put(put_nic_claim).delete(delete_nic_claim),
        )
        .route("/admin/tofinos", post(create_tofino))
        .route(
            "/admin/tofinos/{id}",
            patch(update_tofino).delete(delete_tofino),
        )
        .route("/admin/users", get(list_users))
}

#[derive(Serialize, ToSchema)]
pub struct NicClaimView {
    pub user_id: Option<String>,
    pub user_display_name: String,
    pub connected_to: String,
    pub cable_label: String,
    pub comment: String,
    pub updated_at: i64,
}

#[derive(Serialize, ToSchema)]
pub struct NicView {
    pub id: String,
    pub server_id: String,
    pub name: String,
    pub pci_address: String,
    pub nic_type: String,
    pub speed_gbps: f64,
    /// Kernel interface name, e.g. "ens65f0np0".
    pub ifname: String,
    pub mac: String,
    /// NUMA node; null when unknown or the NIC has no affinity.
    pub numa_node: Option<i64>,
    /// "pf" for a physical function, "vf" for an SR-IOV virtual function.
    pub kind: String,
    /// Who uses this NIC: the VM it is passed through to ("281 (kuppler-2)")
    /// or a role such as "Management". Belongs to this NIC alone and is never
    /// copied to the other end of a link.
    pub usage: String,
    /// Tofino port cabled to this NIC, derived from the port map.
    pub peer_port_id: Option<String>,
    pub peer_port_tofino_id: Option<String>,
    /// Display label such as "Donnie 3/0".
    pub peer_port_label: Option<String>,
    /// Server NIC cabled directly to this NIC.
    pub peer_nic_id: Option<String>,
    pub peer_nic_server_id: Option<String>,
    /// Display label such as "Pennywise 65.1".
    pub peer_nic_label: Option<String>,
    /// Management-switch port cabled to this NIC, derived from the management
    /// port map (read-only mirror, edited from the management-switch side).
    pub peer_mgmt_port_id: Option<String>,
    pub peer_mgmt_switch_id: Option<String>,
    /// Display label such as "MgmtSwitch1 12".
    pub peer_mgmt_port_label: Option<String>,
    pub sort_order: i64,
    pub claim: Option<NicClaimView>,
}

#[derive(Serialize, ToSchema)]
pub struct ServerWithNics {
    pub id: String,
    pub name: String,
    pub description: String,
    /// e.g. "AMD EPYC 7443P 24-Core Processor"; empty when not documented.
    pub cpu_model: String,
    pub cpu_sockets: Option<i64>,
    /// Physical cores across all sockets.
    pub cpu_cores: Option<i64>,
    /// Logical CPUs (cores × threads per core).
    pub cpu_threads: Option<i64>,
    /// Maximum clock in MHz.
    pub cpu_mhz: Option<f64>,
    /// Usable RAM in GiB, as the kernel reports it.
    pub memory_gb: Option<f64>,
    /// Whether regular users can reserve this whole server by the hour.
    pub reservable: bool,
    pub sort_order: i64,
    pub created_at: i64,
    pub updated_at: i64,
    pub nics: Vec<NicView>,
}

#[derive(Serialize, ToSchema)]
pub struct ServersResponse {
    pub servers: Vec<ServerWithNics>,
}

#[derive(Serialize, ToSchema)]
pub struct TofinoView {
    pub id: String,
    pub name: String,
    pub version: i64,
    pub notes: String,
    pub active: bool,
    pub created_at: i64,
    pub updated_at: i64,
    /// Management-switch port this Tofino's management port is cabled to,
    /// e.g. "MgmtSwitch1 12"; null when unplugged. Read-only mirror, edited
    /// from the management-switch port side.
    pub mgmt_peer_label: Option<String>,
}

#[derive(Serialize, ToSchema)]
pub struct TofinosResponse {
    pub tofinos: Vec<TofinoView>,
}

#[derive(Serialize, ToSchema)]
pub struct UserSummary {
    pub id: String,
    pub username: String,
    pub display_name: String,
    pub email: Option<String>,
    pub is_admin: bool,
}

#[derive(Serialize, ToSchema)]
pub struct UsersResponse {
    pub users: Vec<UserSummary>,
}

/// Current NIC values a PATCH may leave untouched.
type EditableNicRow = (
    String,
    String,
    String,
    String,
    f64,
    String,
    String,
    Option<i64>,
    String,
    String,
    i64,
);

#[derive(sqlx::FromRow)]
struct ServerRow {
    id: String,
    name: String,
    description: String,
    cpu_model: String,
    cpu_sockets: Option<i64>,
    cpu_cores: Option<i64>,
    cpu_threads: Option<i64>,
    cpu_mhz: Option<f64>,
    memory_gb: Option<f64>,
    reservable: i64,
    sort_order: i64,
    created_at: i64,
    updated_at: i64,
}

fn server_view(row: ServerRow) -> ServerWithNics {
    ServerWithNics {
        id: row.id,
        name: row.name,
        description: row.description,
        cpu_model: row.cpu_model,
        cpu_sockets: row.cpu_sockets,
        cpu_cores: row.cpu_cores,
        cpu_threads: row.cpu_threads,
        cpu_mhz: row.cpu_mhz,
        memory_gb: row.memory_gb,
        reservable: row.reservable != 0,
        sort_order: row.sort_order,
        created_at: row.created_at,
        updated_at: row.updated_at,
        nics: Vec::new(),
    }
}

/// A NIC joined with its optional claim, named rather than positional.
#[derive(sqlx::FromRow)]
struct NicRow {
    id: String,
    server_id: String,
    name: String,
    pci_address: String,
    nic_type: String,
    speed_gbps: f64,
    ifname: String,
    mac: String,
    numa_node: Option<i64>,
    kind: String,
    usage: String,
    peer_port_id: Option<String>,
    peer_port_tofino_id: Option<String>,
    peer_port_tofino_name: Option<String>,
    peer_port_fp_port: Option<String>,
    peer_nic_id: Option<String>,
    peer_nic_server_id: Option<String>,
    peer_nic_server_name: Option<String>,
    peer_nic_name: Option<String>,
    peer_mgmt_port_id: Option<String>,
    peer_mgmt_switch_id: Option<String>,
    peer_mgmt_switch_name: Option<String>,
    peer_mgmt_port_name: Option<String>,
    sort_order: i64,
    claim_id: Option<String>,
    claim_user_id: Option<String>,
    claim_display_name: Option<String>,
    claim_assignee_name: Option<String>,
    connected_to: Option<String>,
    cable_label: Option<String>,
    comment: Option<String>,
    claim_updated_at: Option<i64>,
}

#[derive(Deserialize, ToSchema)]
pub struct CreateServerRequest {
    pub name: String,
    pub description: Option<String>,
    pub sort_order: Option<i64>,
    pub cpu_model: Option<String>,
    pub cpu_sockets: Option<i64>,
    pub cpu_cores: Option<i64>,
    pub cpu_threads: Option<i64>,
    pub cpu_mhz: Option<f64>,
    pub memory_gb: Option<f64>,
    pub reservable: Option<bool>,
}

#[derive(Deserialize, ToSchema)]
pub struct UpdateServerRequest {
    pub name: Option<String>,
    pub description: Option<String>,
    pub sort_order: Option<i64>,
    /// Zero or negative numerics clear the field.
    pub cpu_model: Option<String>,
    pub cpu_sockets: Option<i64>,
    pub cpu_cores: Option<i64>,
    pub cpu_threads: Option<i64>,
    pub cpu_mhz: Option<f64>,
    pub memory_gb: Option<f64>,
    pub reservable: Option<bool>,
}

#[derive(Deserialize, ToSchema)]
pub struct CreateNicRequest {
    pub name: String,
    pub pci_address: String,
    pub nic_type: String,
    pub speed_gbps: f64,
    pub ifname: Option<String>,
    pub mac: Option<String>,
    /// Negative values mean "no affinity" and are stored as null.
    pub numa_node: Option<i64>,
    /// "pf" (default) or "vf".
    pub kind: Option<String>,
    pub usage: Option<String>,
    pub sort_order: Option<i64>,
}

#[derive(Deserialize, ToSchema)]
pub struct UpdateNicRequest {
    pub name: Option<String>,
    pub pci_address: Option<String>,
    pub nic_type: Option<String>,
    pub speed_gbps: Option<f64>,
    pub ifname: Option<String>,
    pub mac: Option<String>,
    pub numa_node: Option<i64>,
    pub kind: Option<String>,
    pub usage: Option<String>,
    pub sort_order: Option<i64>,
}

#[derive(Deserialize, ToSchema)]
pub struct NicClaimRequest {
    /// Authentik-backed user when one is available.
    pub user_id: Option<String>,
    /// Free-form assignee for people or projects without an account.
    pub assignee_name: Option<String>,
    /// Structured cabling update. Omit to preserve the current link.
    pub peer: Option<NicPeerInput>,
    pub connected_to: Option<String>,
    pub cable_label: Option<String>,
    pub comment: Option<String>,
}

/// What the server NIC is plugged into. Tofino-port and management-port links
/// are stored in the respective port maps and therefore appear from both
/// sides.
#[derive(Deserialize, ToSchema)]
#[serde(tag = "kind", rename_all = "snake_case")]
pub enum NicPeerInput {
    None,
    Port {
        port_id: String,
    },
    /// A management-switch port (`management_switch_ports.id`).
    Mgmt {
        port_id: String,
    },
    Nic {
        nic_id: String,
    },
    Text {
        text: String,
    },
}

#[derive(Deserialize, ToSchema)]
pub struct CreateTofinoRequest {
    pub name: String,
    pub version: i64,
    pub notes: Option<String>,
    pub active: Option<bool>,
}

#[derive(Deserialize, ToSchema)]
pub struct UpdateTofinoRequest {
    pub name: Option<String>,
    pub version: Option<i64>,
    pub notes: Option<String>,
    pub active: Option<bool>,
}

#[utoipa::path(
    get,
    path = "/api/v1/servers",
    tag = "devices",
    responses((status = 200, body = ServersResponse))
)]
pub(crate) async fn list_servers(
    State(state): State<AppState>,
    _user: CurrentUser,
) -> ApiResult<Json<ServersResponse>> {
    let server_rows: Vec<ServerRow> = sqlx::query_as(
        "SELECT id, name, description, cpu_model, cpu_sockets, cpu_cores, cpu_threads,
                cpu_mhz, memory_gb, reservable, sort_order, created_at, updated_at
         FROM servers ORDER BY sort_order, name",
    )
    .fetch_all(&state.db)
    .await?;

    let nic_rows: Vec<NicRow> = sqlx::query_as(
        "SELECT n.id, n.server_id, n.name, n.pci_address, n.nic_type, n.speed_gbps,
                n.ifname, n.mac, n.numa_node, n.kind, n.usage,
                tp.id AS peer_port_id, tp.tofino_id AS peer_port_tofino_id,
                tt.name AS peer_port_tofino_name, tp.fp_port AS peer_port_fp_port,
                pn.id AS peer_nic_id, pn.server_id AS peer_nic_server_id,
                ps.name AS peer_nic_server_name, pn.name AS peer_nic_name,
                mp.id AS peer_mgmt_port_id, mp.switch_id AS peer_mgmt_switch_id,
                msw.name AS peer_mgmt_switch_name, mp.name AS peer_mgmt_port_name,
                n.sort_order,
                c.id AS claim_id, c.user_id AS claim_user_id,
                u.display_name AS claim_display_name,
                c.assignee_name AS claim_assignee_name,
                c.connected_to, c.cable_label, c.comment,
                c.updated_at AS claim_updated_at
         FROM nics n
         LEFT JOIN tofino_ports tp ON tp.id = (
             SELECT linked.id FROM tofino_ports linked
             WHERE linked.peer_nic_id = n.id
             ORDER BY linked.sort_order, linked.id LIMIT 1
         )
         LEFT JOIN tofinos tt ON tt.id = tp.tofino_id
         LEFT JOIN nics pn ON pn.id = n.peer_nic_id
         LEFT JOIN servers ps ON ps.id = pn.server_id
         LEFT JOIN management_switch_ports mp ON mp.id = (
             SELECT linked.id FROM management_switch_ports linked
             WHERE linked.peer_nic_id = n.id
             ORDER BY linked.sort_order, linked.id LIMIT 1
         )
         LEFT JOIN management_switches msw ON msw.id = mp.switch_id
         LEFT JOIN nic_claims c ON c.nic_id = n.id
         LEFT JOIN users u ON u.id = c.user_id
         ORDER BY n.sort_order, n.name",
    )
    .fetch_all(&state.db)
    .await?;

    let mut servers: Vec<ServerWithNics> = server_rows.into_iter().map(server_view).collect();
    for row in nic_rows {
        let claim = match row.claim_id {
            Some(_) => Some(NicClaimView {
                user_id: row.claim_user_id,
                user_display_name: row
                    .claim_display_name
                    .filter(|name| !name.trim().is_empty())
                    .or(row.claim_assignee_name)
                    .unwrap_or_default(),
                connected_to: row.connected_to.unwrap_or_default(),
                cable_label: row.cable_label.unwrap_or_default(),
                comment: row.comment.unwrap_or_default(),
                updated_at: row.claim_updated_at.unwrap_or_default(),
            }),
            None => None,
        };
        if let Some(server) = servers.iter_mut().find(|server| server.id == row.server_id) {
            let peer_port_label = match (
                row.peer_port_tofino_name.as_deref(),
                row.peer_port_fp_port.as_deref(),
            ) {
                (Some(tofino), Some(fp_port)) => Some(format!("{tofino} {fp_port}")),
                _ => None,
            };
            let peer_nic_label = match (
                row.peer_nic_server_name.as_deref(),
                row.peer_nic_name.as_deref(),
            ) {
                (Some(server), Some(nic)) => Some(format!("{server} {nic}")),
                _ => None,
            };
            let peer_mgmt_port_label = match (
                row.peer_mgmt_switch_name.as_deref(),
                row.peer_mgmt_port_name.as_deref(),
            ) {
                (Some(switch), Some(port)) => Some(format!("{switch} {port}")),
                _ => None,
            };
            server.nics.push(NicView {
                id: row.id,
                server_id: row.server_id,
                name: row.name,
                pci_address: row.pci_address,
                nic_type: row.nic_type,
                speed_gbps: row.speed_gbps,
                ifname: row.ifname,
                mac: row.mac,
                numa_node: row.numa_node,
                kind: row.kind,
                usage: row.usage,
                peer_port_id: row.peer_port_id,
                peer_port_tofino_id: row.peer_port_tofino_id,
                peer_port_label,
                peer_nic_id: row.peer_nic_id,
                peer_nic_server_id: row.peer_nic_server_id,
                peer_nic_label,
                peer_mgmt_port_id: row.peer_mgmt_port_id,
                peer_mgmt_switch_id: row.peer_mgmt_switch_id,
                peer_mgmt_port_label,
                sort_order: row.sort_order,
                claim,
            });
        }
    }

    Ok(Json(ServersResponse { servers }))
}

#[utoipa::path(
    get,
    path = "/api/v1/tofinos",
    tag = "devices",
    responses((status = 200, body = TofinosResponse))
)]
pub(crate) async fn list_tofinos(
    State(state): State<AppState>,
    user: CurrentUser,
) -> ApiResult<Json<TofinosResponse>> {
    let sql = if user.is_admin {
        concat!(tofino_select!(), " ORDER BY t.name")
    } else {
        concat!(tofino_select!(), " WHERE t.active = 1 ORDER BY t.name")
    };
    let rows: Vec<TofinoRow> = sqlx::query_as(sql).fetch_all(&state.db).await?;
    Ok(Json(TofinosResponse {
        tofinos: rows.into_iter().map(tofino_view).collect(),
    }))
}

/// (id, name, version, notes, active, created_at, updated_at, mgmt_switch_name,
/// mgmt_port_name) — the last two derive the read-only management link label.
type TofinoRow = (
    String,
    String,
    i64,
    String,
    i64,
    i64,
    i64,
    Option<String>,
    Option<String>,
);

fn tofino_view(row: TofinoRow) -> TofinoView {
    let (id, name, version, notes, active, created_at, updated_at, mgmt_switch, mgmt_port) = row;
    let mgmt_peer_label = match (mgmt_switch, mgmt_port) {
        (Some(switch), Some(port)) => Some(format!("{switch} {port}")),
        _ => None,
    };
    TofinoView {
        id,
        name,
        version,
        notes,
        active: active != 0,
        created_at,
        updated_at,
        mgmt_peer_label,
    }
}

async fn load_tofino(state: &AppState, id: &str) -> ApiResult<TofinoView> {
    let row: Option<TofinoRow> = sqlx::query_as(concat!(tofino_select!(), " WHERE t.id = ?"))
        .bind(id)
        .fetch_optional(&state.db)
        .await?;
    row.map(tofino_view).ok_or(ApiError::NotFound)
}

#[utoipa::path(
    post,
    path = "/api/v1/admin/servers",
    tag = "admin",
    request_body = CreateServerRequest,
    responses((status = 201, body = ServerWithNics), (status = 409, body = crate::error::ErrorResponse))
)]
pub(crate) async fn create_server(
    State(state): State<AppState>,
    _admin: AdminUser,
    Json(input): Json<CreateServerRequest>,
) -> ApiResult<(StatusCode, Json<ServerWithNics>)> {
    let name = require_non_empty(&input.name, "name")?;
    let id = Uuid::new_v4().to_string();
    let now = now_ts();
    sqlx::query(
        "INSERT INTO servers (id, name, description, cpu_model, cpu_sockets, cpu_cores,
                              cpu_threads, cpu_mhz, memory_gb, reservable, sort_order,
                              created_at, updated_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)",
    )
    .bind(&id)
    .bind(&name)
    .bind(input.description.as_deref().unwrap_or(""))
    .bind(input.cpu_model.as_deref().unwrap_or("").trim())
    .bind(merge_count(input.cpu_sockets, None))
    .bind(merge_count(input.cpu_cores, None))
    .bind(merge_count(input.cpu_threads, None))
    .bind(merge_measure(input.cpu_mhz, None))
    .bind(merge_measure(input.memory_gb, None))
    .bind(input.reservable.unwrap_or(false) as i64)
    .bind(input.sort_order.unwrap_or(0))
    .bind(now)
    .bind(now)
    .execute(&state.db)
    .await
    .map_err(|err| ApiError::conflict_on_unique(err, "server name already exists"))?;

    Ok((StatusCode::CREATED, Json(load_server(&state, &id).await?)))
}

#[utoipa::path(
    patch,
    path = "/api/v1/admin/servers/{id}",
    tag = "admin",
    params(("id" = String, Path)),
    request_body = UpdateServerRequest,
    responses((status = 200, body = ServerWithNics))
)]
pub(crate) async fn update_server(
    State(state): State<AppState>,
    _admin: AdminUser,
    Path(id): Path<String>,
    Json(input): Json<UpdateServerRequest>,
) -> ApiResult<Json<ServerWithNics>> {
    let existing = load_server(&state, &id).await?;
    let reservable = input.reservable.unwrap_or(existing.reservable);
    if existing.reservable && !reservable {
        let (future_bookings,): (i64,) =
            sqlx::query_as("SELECT COUNT(*) FROM bookings WHERE server_id = ? AND end_ts > ?")
                .bind(&id)
                .bind(now_ts())
                .fetch_one(&state.db)
                .await?;
        if future_bookings > 0 {
            return Err(ApiError::Conflict(
                "server has future bookings and cannot be made non-reservable".into(),
            ));
        }
    }
    let name = match input.name {
        Some(value) => require_non_empty(&value, "name")?,
        None => existing.name,
    };
    let description = input.description.unwrap_or(existing.description);
    let cpu_model = match input.cpu_model {
        Some(value) => value.trim().to_string(),
        None => existing.cpu_model,
    };
    let sort_order = input.sort_order.unwrap_or(existing.sort_order);
    sqlx::query(
        "UPDATE servers SET name = ?, description = ?, cpu_model = ?, cpu_sockets = ?,
                            cpu_cores = ?, cpu_threads = ?, cpu_mhz = ?, memory_gb = ?,
                            reservable = ?, sort_order = ?, updated_at = ?
         WHERE id = ?",
    )
    .bind(&name)
    .bind(&description)
    .bind(&cpu_model)
    .bind(merge_count(input.cpu_sockets, existing.cpu_sockets))
    .bind(merge_count(input.cpu_cores, existing.cpu_cores))
    .bind(merge_count(input.cpu_threads, existing.cpu_threads))
    .bind(merge_measure(input.cpu_mhz, existing.cpu_mhz))
    .bind(merge_measure(input.memory_gb, existing.memory_gb))
    .bind(reservable as i64)
    .bind(sort_order)
    .bind(now_ts())
    .bind(&id)
    .execute(&state.db)
    .await
    .map_err(|err| ApiError::conflict_on_unique(err, "server name already exists"))?;

    Ok(Json(load_server(&state, &id).await?))
}

#[utoipa::path(
    delete,
    path = "/api/v1/admin/servers/{id}",
    tag = "admin",
    params(("id" = String, Path)),
    responses((status = 204, description = "Server deleted"))
)]
pub(crate) async fn delete_server(
    State(state): State<AppState>,
    _admin: AdminUser,
    Path(id): Path<String>,
) -> ApiResult<StatusCode> {
    let (future_bookings,): (i64,) =
        sqlx::query_as("SELECT COUNT(*) FROM bookings WHERE server_id = ? AND end_ts > ?")
            .bind(&id)
            .bind(now_ts())
            .fetch_one(&state.db)
            .await?;
    if future_bookings > 0 {
        return Err(ApiError::Conflict(
            "server has future bookings; make it non-reservable instead".into(),
        ));
    }
    let result = sqlx::query("DELETE FROM servers WHERE id = ?")
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
    path = "/api/v1/admin/servers/{id}/nics",
    tag = "admin",
    params(("id" = String, Path)),
    request_body = CreateNicRequest,
    responses((status = 201, body = NicView), (status = 409, body = crate::error::ErrorResponse))
)]
pub(crate) async fn create_nic(
    State(state): State<AppState>,
    _admin: AdminUser,
    Path(server_id): Path<String>,
    Json(input): Json<CreateNicRequest>,
) -> ApiResult<(StatusCode, Json<NicView>)> {
    let name = require_non_empty(&input.name, "name")?;
    let pci_address = require_non_empty(&input.pci_address, "pci_address")?;
    let exists: Option<(String,)> = sqlx::query_as("SELECT id FROM servers WHERE id = ?")
        .bind(&server_id)
        .fetch_optional(&state.db)
        .await?;
    exists.ok_or(ApiError::NotFound)?;

    let id = Uuid::new_v4().to_string();
    let now = now_ts();
    let ifname = input.ifname.unwrap_or_default().trim().to_string();
    let mac = normalize_mac(input.mac.as_deref().unwrap_or(""));
    let numa_node = normalize_numa_node(input.numa_node);
    let kind = normalize_nic_kind(input.kind.as_deref(), "pf")?;
    let usage = input.usage.unwrap_or_default().trim().to_string();
    validate_nic_speed(input.speed_gbps)?;
    sqlx::query(
        "INSERT INTO nics (id, server_id, name, pci_address, nic_type, speed_gbps,
                           ifname, mac, numa_node, kind, usage, sort_order,
                           created_at, updated_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)",
    )
    .bind(&id)
    .bind(&server_id)
    .bind(&name)
    .bind(&pci_address)
    .bind(input.nic_type.trim())
    .bind(input.speed_gbps)
    .bind(&ifname)
    .bind(&mac)
    .bind(numa_node)
    .bind(&kind)
    .bind(&usage)
    .bind(input.sort_order.unwrap_or(0))
    .bind(now)
    .bind(now)
    .execute(&state.db)
    .await
    .map_err(|err| {
        ApiError::conflict_on_unique(err, "a NIC with this PCI address already exists")
    })?;

    Ok((
        StatusCode::CREATED,
        Json(NicView {
            id,
            server_id,
            name,
            pci_address,
            nic_type: input.nic_type.trim().to_string(),
            speed_gbps: input.speed_gbps,
            ifname,
            mac,
            numa_node,
            kind,
            usage,
            peer_port_id: None,
            peer_port_tofino_id: None,
            peer_port_label: None,
            peer_nic_id: None,
            peer_nic_server_id: None,
            peer_nic_label: None,
            peer_mgmt_port_id: None,
            peer_mgmt_switch_id: None,
            peer_mgmt_port_label: None,
            sort_order: input.sort_order.unwrap_or(0),
            claim: None,
        }),
    ))
}

#[utoipa::path(
    patch,
    path = "/api/v1/admin/nics/{id}",
    tag = "admin",
    params(("id" = String, Path)),
    request_body = UpdateNicRequest,
    responses((status = 200, body = NicView))
)]
pub(crate) async fn update_nic(
    State(state): State<AppState>,
    _admin: AdminUser,
    Path(id): Path<String>,
    Json(input): Json<UpdateNicRequest>,
) -> ApiResult<Json<NicView>> {
    let row: Option<EditableNicRow> = sqlx::query_as(
        "SELECT server_id, name, pci_address, nic_type, speed_gbps, ifname, mac, numa_node,
                kind, usage, sort_order
         FROM nics WHERE id = ?",
    )
    .bind(&id)
    .fetch_optional(&state.db)
    .await?;
    let (
        server_id,
        name,
        pci_address,
        nic_type,
        speed_gbps,
        ifname,
        mac,
        numa_node,
        kind,
        usage,
        sort_order,
    ) = row.ok_or(ApiError::NotFound)?;
    let name = match input.name {
        Some(value) => require_non_empty(&value, "name")?,
        None => name,
    };
    let pci_address = match input.pci_address {
        Some(value) => require_non_empty(&value, "pci_address")?,
        None => pci_address,
    };
    let nic_type = input.nic_type.unwrap_or(nic_type);
    let speed_gbps = input.speed_gbps.unwrap_or(speed_gbps);
    validate_nic_speed(speed_gbps)?;
    let ifname = match input.ifname {
        Some(value) => value.trim().to_string(),
        None => ifname,
    };
    let mac = match input.mac {
        Some(value) => normalize_mac(&value),
        None => mac,
    };
    // A negative NUMA node means "no affinity" and clears the column.
    let numa_node = match input.numa_node {
        Some(node) => normalize_numa_node(Some(node)),
        None => numa_node,
    };
    let kind = normalize_nic_kind(input.kind.as_deref(), &kind)?;
    let usage = input
        .usage
        .map(|value| value.trim().to_string())
        .unwrap_or(usage);
    let sort_order = input.sort_order.unwrap_or(sort_order);
    sqlx::query(
        "UPDATE nics SET name = ?, pci_address = ?, nic_type = ?, speed_gbps = ?, ifname = ?,
                         mac = ?, numa_node = ?, kind = ?, usage = ?, sort_order = ?,
                         updated_at = ?
         WHERE id = ?",
    )
    .bind(&name)
    .bind(&pci_address)
    .bind(&nic_type)
    .bind(speed_gbps)
    .bind(&ifname)
    .bind(&mac)
    .bind(numa_node)
    .bind(&kind)
    .bind(&usage)
    .bind(sort_order)
    .bind(now_ts())
    .bind(&id)
    .execute(&state.db)
    .await
    .map_err(|err| {
        ApiError::conflict_on_unique(err, "a NIC with this PCI address already exists")
    })?;

    Ok(Json(NicView {
        id,
        server_id,
        name,
        pci_address,
        nic_type,
        speed_gbps,
        ifname,
        mac,
        numa_node,
        kind,
        usage,
        peer_port_id: None,
        peer_port_tofino_id: None,
        peer_port_label: None,
        peer_nic_id: None,
        peer_nic_server_id: None,
        peer_nic_label: None,
        peer_mgmt_port_id: None,
        peer_mgmt_switch_id: None,
        peer_mgmt_port_label: None,
        sort_order,
        claim: None,
    }))
}

#[utoipa::path(
    delete,
    path = "/api/v1/admin/nics/{id}",
    tag = "admin",
    params(("id" = String, Path)),
    responses((status = 204, description = "NIC deleted"))
)]
pub(crate) async fn delete_nic(
    State(state): State<AppState>,
    _admin: AdminUser,
    Path(id): Path<String>,
) -> ApiResult<StatusCode> {
    let result = sqlx::query("DELETE FROM nics WHERE id = ?")
        .bind(&id)
        .execute(&state.db)
        .await?;
    if result.rows_affected() == 0 {
        return Err(ApiError::NotFound);
    }
    Ok(StatusCode::NO_CONTENT)
}

#[utoipa::path(
    put,
    path = "/api/v1/admin/nics/{id}/claim",
    tag = "admin",
    params(("id" = String, Path)),
    request_body = NicClaimRequest,
    responses((status = 200, body = NicClaimView))
)]
pub(crate) async fn put_nic_claim(
    State(state): State<AppState>,
    admin: AdminUser,
    Path(nic_id): Path<String>,
    Json(input): Json<NicClaimRequest>,
) -> ApiResult<Json<NicClaimView>> {
    let nic: Option<(String,)> = sqlx::query_as("SELECT id FROM nics WHERE id = ?")
        .bind(&nic_id)
        .fetch_optional(&state.db)
        .await?;
    nic.ok_or(ApiError::NotFound)?;
    let user_id = input
        .user_id
        .as_deref()
        .map(str::trim)
        .filter(|id| !id.is_empty());
    let free_name = input.assignee_name.as_deref().unwrap_or("").trim();
    let mapped_name = if let Some(user_id) = user_id {
        let user: Option<(String,)> = sqlx::query_as("SELECT display_name FROM users WHERE id = ?")
            .bind(user_id)
            .fetch_optional(&state.db)
            .await?;
        Some(
            user.ok_or_else(|| ApiError::BadRequest("user_id does not exist".into()))?
                .0,
        )
    } else {
        None
    };
    // An owner is optional: a NIC that is only cabled still needs a row to
    // hold the cable label and comment shared with the other endpoint.
    let assignee_name = if free_name.is_empty() {
        mapped_name.clone().unwrap_or_default()
    } else {
        free_name.to_string()
    };
    let user_display_name = mapped_name.unwrap_or_else(|| assignee_name.clone());

    let now = now_ts();
    let connected_to = match &input.peer {
        Some(NicPeerInput::Text { text }) => text.trim().to_string(),
        Some(_) => String::new(),
        None => input
            .connected_to
            .as_deref()
            .unwrap_or("")
            .trim()
            .to_string(),
    };
    let cable_label = input
        .cable_label
        .as_deref()
        .unwrap_or("")
        .trim()
        .to_string();
    let comment = input.comment.as_deref().unwrap_or("").trim().to_string();
    let mut tx = state.db.begin_with("BEGIN IMMEDIATE").await?;
    match &input.peer {
        Some(NicPeerInput::None | NicPeerInput::Text { .. }) => {
            ports::connect_nic_to_port(&mut tx, &nic_id, None, &admin.0.id, now).await?;
            ports::connect_nic_to_mgmt_port(&mut tx, &nic_id, None, now).await?;
        }
        Some(NicPeerInput::Port { port_id }) => {
            ports::connect_nic_to_port(&mut tx, &nic_id, Some(port_id), &admin.0.id, now).await?;
            ports::connect_nic_to_mgmt_port(&mut tx, &nic_id, None, now).await?;
        }
        Some(NicPeerInput::Mgmt { port_id }) => {
            ports::connect_nic_to_mgmt_port(&mut tx, &nic_id, Some(port_id), now).await?;
        }
        Some(NicPeerInput::Nic { nic_id: target_id }) => {
            ports::connect_nic_to_nic(&mut tx, &nic_id, target_id, &admin.0.id, now).await?;
        }
        None => {}
    }
    sqlx::query(
        "INSERT INTO nic_claims (id, nic_id, user_id, assignee_name, connected_to,
                                 cable_label, comment, created_by, created_at, updated_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
         ON CONFLICT(nic_id) DO UPDATE SET
             user_id = excluded.user_id,
             assignee_name = excluded.assignee_name,
             connected_to = excluded.connected_to,
             cable_label = excluded.cable_label,
             comment = excluded.comment,
             created_by = excluded.created_by,
             updated_at = excluded.updated_at",
    )
    .bind(Uuid::new_v4().to_string())
    .bind(&nic_id)
    .bind(user_id)
    .bind(&assignee_name)
    .bind(&connected_to)
    .bind(cable_label.as_str())
    .bind(comment.as_str())
    .bind(&admin.0.id)
    .bind(now)
    .bind(now)
    .execute(&mut *tx)
    .await?;
    // The cable label and comment belong to the cable: hand them to whatever
    // this NIC is plugged into now.
    ports::sync_cable_documentation(
        &mut tx,
        ports::LinkEndpoint::Nic(&nic_id),
        &cable_label,
        &comment,
        &admin.0.id,
        now,
    )
    .await?;
    tx.commit().await?;

    Ok(Json(NicClaimView {
        user_id: user_id.map(str::to_string),
        user_display_name,
        connected_to,
        cable_label,
        comment,
        updated_at: now,
    }))
}

#[utoipa::path(
    delete,
    path = "/api/v1/admin/nics/{id}/claim",
    tag = "admin",
    params(("id" = String, Path)),
    responses((status = 204, description = "Claim released"))
)]
pub(crate) async fn delete_nic_claim(
    State(state): State<AppState>,
    _admin: AdminUser,
    Path(nic_id): Path<String>,
) -> ApiResult<StatusCode> {
    // Releasing hands back the NIC, not the cable: while it is still plugged
    // into something the row survives without an owner so the cable label and
    // comment stay in sync with the other endpoint.
    let documented: Option<(i64,)> = sqlx::query_as(
        "SELECT EXISTS (
             SELECT 1 FROM nic_claims c
             WHERE c.nic_id = ?
               AND (length(c.cable_label) > 0 OR length(c.comment) > 0)
               AND (
                   EXISTS (SELECT 1 FROM nics n
                           WHERE n.id = c.nic_id AND n.peer_nic_id IS NOT NULL)
                   OR EXISTS (SELECT 1 FROM tofino_ports p WHERE p.peer_nic_id = c.nic_id)
               )
         )",
    )
    .bind(&nic_id)
    .fetch_optional(&state.db)
    .await?;
    let result = if matches!(documented, Some((1,))) {
        sqlx::query(
            "UPDATE nic_claims SET user_id = NULL, assignee_name = '', connected_to = '',
                                   updated_at = ?
             WHERE nic_id = ?",
        )
        .bind(now_ts())
        .bind(&nic_id)
        .execute(&state.db)
        .await?
    } else {
        sqlx::query("DELETE FROM nic_claims WHERE nic_id = ?")
            .bind(&nic_id)
            .execute(&state.db)
            .await?
    };
    if result.rows_affected() == 0 {
        return Err(ApiError::NotFound);
    }
    Ok(StatusCode::NO_CONTENT)
}

#[utoipa::path(
    post,
    path = "/api/v1/admin/tofinos",
    tag = "admin",
    request_body = CreateTofinoRequest,
    responses((status = 201, body = TofinoView), (status = 409, body = crate::error::ErrorResponse))
)]
pub(crate) async fn create_tofino(
    State(state): State<AppState>,
    _admin: AdminUser,
    Json(input): Json<CreateTofinoRequest>,
) -> ApiResult<(StatusCode, Json<TofinoView>)> {
    let name = require_non_empty(&input.name, "name")?;
    validate_tofino_version(input.version)?;
    let id = Uuid::new_v4().to_string();
    let now = now_ts();
    sqlx::query(
        "INSERT INTO tofinos (id, name, version, notes, active, created_at, updated_at)
         VALUES (?, ?, ?, ?, ?, ?, ?)",
    )
    .bind(&id)
    .bind(&name)
    .bind(input.version)
    .bind(input.notes.as_deref().unwrap_or(""))
    .bind(input.active.unwrap_or(true) as i64)
    .bind(now)
    .bind(now)
    .execute(&state.db)
    .await
    .map_err(|err| ApiError::conflict_on_unique(err, "tofino name already exists"))?;

    Ok((StatusCode::CREATED, Json(load_tofino(&state, &id).await?)))
}

#[utoipa::path(
    patch,
    path = "/api/v1/admin/tofinos/{id}",
    tag = "admin",
    params(("id" = String, Path)),
    request_body = UpdateTofinoRequest,
    responses((status = 200, body = TofinoView))
)]
pub(crate) async fn update_tofino(
    State(state): State<AppState>,
    _admin: AdminUser,
    Path(id): Path<String>,
    Json(input): Json<UpdateTofinoRequest>,
) -> ApiResult<Json<TofinoView>> {
    let existing = load_tofino(&state, &id).await?;
    let name = match input.name {
        Some(value) => require_non_empty(&value, "name")?,
        None => existing.name,
    };
    let version = input.version.unwrap_or(existing.version);
    validate_tofino_version(version)?;
    let notes = input.notes.unwrap_or(existing.notes);
    let active = input.active.unwrap_or(existing.active);
    sqlx::query(
        "UPDATE tofinos SET name = ?, version = ?, notes = ?, active = ?, updated_at = ?
         WHERE id = ?",
    )
    .bind(&name)
    .bind(version)
    .bind(&notes)
    .bind(active as i64)
    .bind(now_ts())
    .bind(&id)
    .execute(&state.db)
    .await
    .map_err(|err| ApiError::conflict_on_unique(err, "tofino name already exists"))?;

    Ok(Json(load_tofino(&state, &id).await?))
}

#[utoipa::path(
    delete,
    path = "/api/v1/admin/tofinos/{id}",
    tag = "admin",
    params(("id" = String, Path)),
    responses(
        (status = 204, description = "Tofino deleted"),
        (status = 409, description = "Tofino has future bookings", body = crate::error::ErrorResponse)
    )
)]
pub(crate) async fn delete_tofino(
    State(state): State<AppState>,
    _admin: AdminUser,
    Path(id): Path<String>,
) -> ApiResult<StatusCode> {
    let (future_bookings,): (i64,) =
        sqlx::query_as("SELECT COUNT(*) FROM bookings WHERE tofino_id = ? AND end_ts > ?")
            .bind(&id)
            .bind(now_ts())
            .fetch_one(&state.db)
            .await?;
    if future_bookings > 0 {
        return Err(ApiError::Conflict(
            "tofino has future bookings; set active=false instead".into(),
        ));
    }
    let result = sqlx::query("DELETE FROM tofinos WHERE id = ?")
        .bind(&id)
        .execute(&state.db)
        .await?;
    if result.rows_affected() == 0 {
        return Err(ApiError::NotFound);
    }
    Ok(StatusCode::NO_CONTENT)
}

#[utoipa::path(
    get,
    path = "/api/v1/admin/users",
    tag = "admin",
    responses((status = 200, body = UsersResponse))
)]
pub(crate) async fn list_users(
    State(state): State<AppState>,
    _admin: AdminUser,
) -> ApiResult<Json<UsersResponse>> {
    let rows: Vec<(String, String, String, Option<String>, i64)> = sqlx::query_as(
        "SELECT id, username, display_name, email, is_admin FROM users ORDER BY display_name",
    )
    .fetch_all(&state.db)
    .await?;
    Ok(Json(UsersResponse {
        users: rows
            .into_iter()
            .map(
                |(id, username, display_name, email, is_admin)| UserSummary {
                    id,
                    username,
                    display_name,
                    email,
                    is_admin: is_admin != 0,
                },
            )
            .collect(),
    }))
}

async fn load_server(state: &AppState, id: &str) -> ApiResult<ServerWithNics> {
    let row: Option<ServerRow> = sqlx::query_as(
        "SELECT id, name, description, cpu_model, cpu_sockets, cpu_cores, cpu_threads,
                cpu_mhz, memory_gb, reservable, sort_order, created_at, updated_at
         FROM servers WHERE id = ?",
    )
    .bind(id)
    .fetch_optional(&state.db)
    .await?;
    row.map(server_view).ok_or(ApiError::NotFound)
}

/// PATCH semantics for optional hardware counts: absent keeps what is stored,
/// zero or negative clears it (that is how "unknown" is expressed).
fn merge_count(input: Option<i64>, current: Option<i64>) -> Option<i64> {
    match input {
        Some(value) => (value > 0).then_some(value),
        None => current,
    }
}

fn merge_measure(input: Option<f64>, current: Option<f64>) -> Option<f64> {
    match input {
        Some(value) => (value.is_finite() && value > 0.0).then_some(value),
        None => current,
    }
}

fn normalize_mac(value: &str) -> String {
    value.trim().to_lowercase()
}

/// sysfs reports -1 when a device has no NUMA affinity; store that as NULL.
fn normalize_numa_node(value: Option<i64>) -> Option<i64> {
    value.filter(|node| *node >= 0)
}

fn normalize_nic_kind(value: Option<&str>, current: &str) -> ApiResult<String> {
    let Some(kind) = value else {
        return Ok(current.to_string());
    };
    let kind = kind.trim().to_lowercase();
    if kind != "pf" && kind != "vf" {
        return Err(ApiError::BadRequest(
            "kind must be 'pf' (physical function) or 'vf' (SR-IOV virtual function)".into(),
        ));
    }
    Ok(kind)
}

fn validate_nic_speed(speed_gbps: f64) -> ApiResult<()> {
    if !speed_gbps.is_finite() || speed_gbps < 0.0 {
        return Err(ApiError::BadRequest(
            "speed_gbps must be zero (unknown) or positive".into(),
        ));
    }
    Ok(())
}

fn validate_tofino_version(version: i64) -> ApiResult<()> {
    if version != 1 && version != 2 {
        return Err(ApiError::BadRequest("version must be 1 or 2".into()));
    }
    Ok(())
}

fn require_non_empty(value: &str, field: &str) -> ApiResult<String> {
    let trimmed = value.trim();
    if trimmed.is_empty() {
        return Err(ApiError::BadRequest(format!("{field} must not be empty")));
    }
    Ok(trimmed.to_string())
}
