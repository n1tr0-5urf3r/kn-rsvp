//! Infrastructure / management switches, their VLAN database, and (in the
//! `ports` submodule) their ports and physical links.
//!
//! The whole feature is admin-only (knstaff/knadmin): every handler here,
//! including the reads, requires [`AdminUser`]. Management switches are not
//! bookable. Port links are mirrored exactly like Tofino port links — see
//! [`ports`].

pub mod ports;

use axum::{
    Json, Router,
    extract::{Path, State},
    http::StatusCode,
    routing::{get, patch, post},
};
use serde::{Deserialize, Serialize};
use utoipa::ToSchema;
use uuid::Uuid;

use crate::{
    AppState,
    auth::AdminUser,
    db::now_ts,
    error::{ApiError, ApiResult},
};

pub fn router() -> Router<AppState> {
    Router::new()
        .route("/management-switches", get(list_switches))
        .route("/admin/management-switches", post(create_switch))
        .route(
            "/admin/management-switches/{id}",
            patch(update_switch).delete(delete_switch),
        )
        .route("/vlans", get(list_vlans))
        .route("/admin/vlans", post(create_vlan))
        .route("/admin/vlans/{id}", patch(update_vlan).delete(delete_vlan))
        .merge(ports::router())
}

// ---------------------------------------------------------------------------
// Management switches
// ---------------------------------------------------------------------------

#[derive(Serialize, ToSchema)]
pub struct ManagementSwitchView {
    pub id: String,
    pub name: String,
    /// Management IP or hostname; empty when not documented.
    pub mgmt_ip: String,
    /// Vendor/model, e.g. "Aruba 6300M"; empty when not documented.
    pub model: String,
    pub notes: String,
    pub active: bool,
    pub sort_order: i64,
    pub created_at: i64,
    pub updated_at: i64,
}

#[derive(Serialize, ToSchema)]
pub struct ManagementSwitchesResponse {
    pub switches: Vec<ManagementSwitchView>,
}

#[derive(Deserialize, ToSchema)]
pub struct CreateManagementSwitchRequest {
    pub name: String,
    pub mgmt_ip: Option<String>,
    pub model: Option<String>,
    pub notes: Option<String>,
    pub active: Option<bool>,
    pub sort_order: Option<i64>,
    /// Create-only: auto-generate this many front-panel ports named "1".."N".
    pub num_ports: Option<u32>,
}

#[derive(Deserialize, ToSchema)]
pub struct UpdateManagementSwitchRequest {
    pub name: Option<String>,
    pub mgmt_ip: Option<String>,
    pub model: Option<String>,
    pub notes: Option<String>,
    pub active: Option<bool>,
    pub sort_order: Option<i64>,
}

type SwitchRow = (String, String, String, String, String, i64, i64, i64, i64);

fn switch_view(row: SwitchRow) -> ManagementSwitchView {
    let (id, name, mgmt_ip, model, notes, active, sort_order, created_at, updated_at) = row;
    ManagementSwitchView {
        id,
        name,
        mgmt_ip,
        model,
        notes,
        active: active != 0,
        sort_order,
        created_at,
        updated_at,
    }
}

macro_rules! switch_select {
    () => {
        "SELECT id, name, mgmt_ip, model, notes, active, sort_order, created_at, updated_at
         FROM management_switches"
    };
}

async fn load_switch(state: &AppState, id: &str) -> ApiResult<ManagementSwitchView> {
    let row: Option<SwitchRow> = sqlx::query_as(concat!(switch_select!(), " WHERE id = ?"))
        .bind(id)
        .fetch_optional(&state.db)
        .await?;
    row.map(switch_view).ok_or(ApiError::NotFound)
}

#[utoipa::path(
    get,
    path = "/api/v1/management-switches",
    tag = "management",
    responses((status = 200, body = ManagementSwitchesResponse))
)]
pub(crate) async fn list_switches(
    State(state): State<AppState>,
    _admin: AdminUser,
) -> ApiResult<Json<ManagementSwitchesResponse>> {
    let rows: Vec<SwitchRow> =
        sqlx::query_as(concat!(switch_select!(), " ORDER BY sort_order, name"))
            .fetch_all(&state.db)
            .await?;
    Ok(Json(ManagementSwitchesResponse {
        switches: rows.into_iter().map(switch_view).collect(),
    }))
}

#[utoipa::path(
    post,
    path = "/api/v1/admin/management-switches",
    tag = "admin",
    request_body = CreateManagementSwitchRequest,
    responses((status = 201, body = ManagementSwitchView), (status = 409, body = crate::error::ErrorResponse))
)]
pub(crate) async fn create_switch(
    State(state): State<AppState>,
    admin: AdminUser,
    Json(input): Json<CreateManagementSwitchRequest>,
) -> ApiResult<(StatusCode, Json<ManagementSwitchView>)> {
    let name = require_non_empty(&input.name, "name")?;
    let id = Uuid::new_v4().to_string();
    let now = now_ts();
    let mut tx = state.db.begin_with("BEGIN IMMEDIATE").await?;
    sqlx::query(
        "INSERT INTO management_switches (id, name, mgmt_ip, model, notes, active, sort_order,
                                          created_at, updated_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)",
    )
    .bind(&id)
    .bind(&name)
    .bind(input.mgmt_ip.as_deref().unwrap_or("").trim())
    .bind(input.model.as_deref().unwrap_or("").trim())
    .bind(input.notes.as_deref().unwrap_or("").trim())
    .bind(input.active.unwrap_or(true) as i64)
    .bind(input.sort_order.unwrap_or(0))
    .bind(now)
    .bind(now)
    .execute(&mut *tx)
    .await
    .map_err(|err| ApiError::conflict_on_unique(err, "management switch name already exists"))?;

    // Optionally pre-populate front-panel ports "1".."N" (sort_order = index).
    for index in 0..input.num_ports.unwrap_or(0) {
        sqlx::query(
            "INSERT INTO management_switch_ports (id, switch_id, name, sort_order, updated_by,
                                                  created_at, updated_at)
             VALUES (?, ?, ?, ?, ?, ?, ?)",
        )
        .bind(Uuid::new_v4().to_string())
        .bind(&id)
        .bind((index + 1).to_string())
        .bind(index as i64)
        .bind(&admin.0.id)
        .bind(now)
        .bind(now)
        .execute(&mut *tx)
        .await?;
    }
    tx.commit().await?;

    Ok((StatusCode::CREATED, Json(load_switch(&state, &id).await?)))
}

#[utoipa::path(
    patch,
    path = "/api/v1/admin/management-switches/{id}",
    tag = "admin",
    params(("id" = String, Path)),
    request_body = UpdateManagementSwitchRequest,
    responses((status = 200, body = ManagementSwitchView), (status = 409, body = crate::error::ErrorResponse))
)]
pub(crate) async fn update_switch(
    State(state): State<AppState>,
    _admin: AdminUser,
    Path(id): Path<String>,
    Json(input): Json<UpdateManagementSwitchRequest>,
) -> ApiResult<Json<ManagementSwitchView>> {
    let existing = load_switch(&state, &id).await?;
    let name = match input.name {
        Some(value) => require_non_empty(&value, "name")?,
        None => existing.name,
    };
    let mgmt_ip = input
        .mgmt_ip
        .map(|v| v.trim().to_string())
        .unwrap_or(existing.mgmt_ip);
    let model = input
        .model
        .map(|v| v.trim().to_string())
        .unwrap_or(existing.model);
    let notes = input.notes.unwrap_or(existing.notes);
    let active = input.active.unwrap_or(existing.active);
    let sort_order = input.sort_order.unwrap_or(existing.sort_order);
    sqlx::query(
        "UPDATE management_switches SET name = ?, mgmt_ip = ?, model = ?, notes = ?, active = ?,
                                        sort_order = ?, updated_at = ?
         WHERE id = ?",
    )
    .bind(&name)
    .bind(mgmt_ip.trim())
    .bind(model.trim())
    .bind(notes.trim())
    .bind(active as i64)
    .bind(sort_order)
    .bind(now_ts())
    .bind(&id)
    .execute(&state.db)
    .await
    .map_err(|err| ApiError::conflict_on_unique(err, "management switch name already exists"))?;

    Ok(Json(load_switch(&state, &id).await?))
}

#[utoipa::path(
    delete,
    path = "/api/v1/admin/management-switches/{id}",
    tag = "admin",
    params(("id" = String, Path)),
    responses((status = 204, description = "Switch deleted"))
)]
pub(crate) async fn delete_switch(
    State(state): State<AppState>,
    _admin: AdminUser,
    Path(id): Path<String>,
) -> ApiResult<StatusCode> {
    let result = sqlx::query("DELETE FROM management_switches WHERE id = ?")
        .bind(&id)
        .execute(&state.db)
        .await?;
    if result.rows_affected() == 0 {
        return Err(ApiError::NotFound);
    }
    Ok(StatusCode::NO_CONTENT)
}

// ---------------------------------------------------------------------------
// Global VLAN database
// ---------------------------------------------------------------------------

#[derive(Serialize, ToSchema)]
pub struct VlanView {
    pub id: String,
    /// 802.1Q VLAN number, 1..4094.
    pub vlan_id: i64,
    pub name: String,
    pub purpose: String,
    pub created_at: i64,
    pub updated_at: i64,
}

#[derive(Serialize, ToSchema)]
pub struct VlansResponse {
    pub vlans: Vec<VlanView>,
}

#[derive(Deserialize, ToSchema)]
pub struct CreateVlanRequest {
    pub vlan_id: i64,
    pub name: Option<String>,
    pub purpose: Option<String>,
}

#[derive(Deserialize, ToSchema)]
pub struct UpdateVlanRequest {
    pub vlan_id: Option<i64>,
    pub name: Option<String>,
    pub purpose: Option<String>,
}

type VlanRow = (String, i64, String, String, i64, i64);

fn vlan_view(row: VlanRow) -> VlanView {
    let (id, vlan_id, name, purpose, created_at, updated_at) = row;
    VlanView {
        id,
        vlan_id,
        name,
        purpose,
        created_at,
        updated_at,
    }
}

async fn load_vlan(state: &AppState, id: &str) -> ApiResult<VlanView> {
    let row: Option<VlanRow> = sqlx::query_as(
        "SELECT id, vlan_id, name, purpose, created_at, updated_at FROM vlans WHERE id = ?",
    )
    .bind(id)
    .fetch_optional(&state.db)
    .await?;
    row.map(vlan_view).ok_or(ApiError::NotFound)
}

#[utoipa::path(
    get,
    path = "/api/v1/vlans",
    tag = "management",
    responses((status = 200, body = VlansResponse))
)]
pub(crate) async fn list_vlans(
    State(state): State<AppState>,
    _admin: AdminUser,
) -> ApiResult<Json<VlansResponse>> {
    let rows: Vec<VlanRow> = sqlx::query_as(
        "SELECT id, vlan_id, name, purpose, created_at, updated_at FROM vlans ORDER BY vlan_id",
    )
    .fetch_all(&state.db)
    .await?;
    Ok(Json(VlansResponse {
        vlans: rows.into_iter().map(vlan_view).collect(),
    }))
}

#[utoipa::path(
    post,
    path = "/api/v1/admin/vlans",
    tag = "admin",
    request_body = CreateVlanRequest,
    responses((status = 201, body = VlanView), (status = 409, body = crate::error::ErrorResponse))
)]
pub(crate) async fn create_vlan(
    State(state): State<AppState>,
    _admin: AdminUser,
    Json(input): Json<CreateVlanRequest>,
) -> ApiResult<(StatusCode, Json<VlanView>)> {
    validate_vlan_id(input.vlan_id)?;
    let id = Uuid::new_v4().to_string();
    let now = now_ts();
    sqlx::query(
        "INSERT INTO vlans (id, vlan_id, name, purpose, created_at, updated_at)
         VALUES (?, ?, ?, ?, ?, ?)",
    )
    .bind(&id)
    .bind(input.vlan_id)
    .bind(input.name.as_deref().unwrap_or("").trim())
    .bind(input.purpose.as_deref().unwrap_or("").trim())
    .bind(now)
    .bind(now)
    .execute(&state.db)
    .await
    .map_err(|err| ApiError::conflict_on_unique(err, "this VLAN ID already exists"))?;

    Ok((StatusCode::CREATED, Json(load_vlan(&state, &id).await?)))
}

#[utoipa::path(
    patch,
    path = "/api/v1/admin/vlans/{id}",
    tag = "admin",
    params(("id" = String, Path)),
    request_body = UpdateVlanRequest,
    responses((status = 200, body = VlanView), (status = 409, body = crate::error::ErrorResponse))
)]
pub(crate) async fn update_vlan(
    State(state): State<AppState>,
    _admin: AdminUser,
    Path(id): Path<String>,
    Json(input): Json<UpdateVlanRequest>,
) -> ApiResult<Json<VlanView>> {
    let existing = load_vlan(&state, &id).await?;
    let vlan_id = input.vlan_id.unwrap_or(existing.vlan_id);
    validate_vlan_id(vlan_id)?;
    let name = input.name.unwrap_or(existing.name);
    let purpose = input.purpose.unwrap_or(existing.purpose);
    sqlx::query("UPDATE vlans SET vlan_id = ?, name = ?, purpose = ?, updated_at = ? WHERE id = ?")
        .bind(vlan_id)
        .bind(name.trim())
        .bind(purpose.trim())
        .bind(now_ts())
        .bind(&id)
        .execute(&state.db)
        .await
        .map_err(|err| ApiError::conflict_on_unique(err, "this VLAN ID already exists"))?;

    Ok(Json(load_vlan(&state, &id).await?))
}

#[utoipa::path(
    delete,
    path = "/api/v1/admin/vlans/{id}",
    tag = "admin",
    params(("id" = String, Path)),
    responses((status = 204, description = "VLAN deleted"))
)]
pub(crate) async fn delete_vlan(
    State(state): State<AppState>,
    _admin: AdminUser,
    Path(id): Path<String>,
) -> ApiResult<StatusCode> {
    let result = sqlx::query("DELETE FROM vlans WHERE id = ?")
        .bind(&id)
        .execute(&state.db)
        .await?;
    if result.rows_affected() == 0 {
        return Err(ApiError::NotFound);
    }
    Ok(StatusCode::NO_CONTENT)
}

// ---------------------------------------------------------------------------
// Shared helpers
// ---------------------------------------------------------------------------

fn validate_vlan_id(vlan_id: i64) -> ApiResult<()> {
    if !(1..=4094).contains(&vlan_id) {
        return Err(ApiError::BadRequest(
            "vlan_id must be between 1 and 4094".into(),
        ));
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
