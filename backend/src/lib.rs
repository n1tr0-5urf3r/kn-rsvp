pub mod auth;
pub mod bookings;
pub mod caldav;
pub mod config;
pub mod db;
pub mod devices;
pub mod error;
pub mod management;
pub mod openapi;
pub mod ports;
pub mod settings;

use std::{
    path::PathBuf,
    sync::{Arc, Mutex, atomic::AtomicI64},
};

use axum::{
    Json, Router,
    extract::State,
    http::{HeaderName, HeaderValue, Method, header},
    routing::get,
};
use serde::Serialize;
use sqlx::SqlitePool;
use tokio::sync::Notify;
use tower_cookies::CookieManagerLayer;
use tower_http::{
    cors::CorsLayer,
    services::{ServeDir, ServeFile},
    trace::TraceLayer,
};
use utoipa::ToSchema;

use crate::config::Config;

#[derive(Clone)]
pub struct AppState {
    pub config: Config,
    pub db: SqlitePool,
    pub http: reqwest::Client,
    pub caldav_notify: Arc<Notify>,
    pub caldav_last_run: Arc<AtomicI64>,
    pub pending_oauth: Arc<Mutex<auth::PendingOAuthMap>>,
}

impl AppState {
    pub fn new(config: Config, db: SqlitePool) -> Self {
        Self {
            config,
            db,
            http: reqwest::Client::new(),
            caldav_notify: Arc::new(Notify::new()),
            caldav_last_run: Arc::new(AtomicI64::new(0)),
            pending_oauth: Arc::new(Mutex::new(auth::PendingOAuthMap::new())),
        }
    }
}

#[derive(Serialize, ToSchema)]
pub struct HealthResponse {
    pub status: String,
    pub version: String,
}

#[utoipa::path(
    get,
    path = "/api/v1/health",
    tag = "misc",
    responses((status = 200, body = HealthResponse))
)]
pub(crate) async fn health() -> Json<HealthResponse> {
    Json(HealthResponse {
        status: "ok".into(),
        version: env!("CARGO_PKG_VERSION").into(),
    })
}

#[derive(Serialize, ToSchema)]
pub struct PublicConfigResponse {
    pub app_name: String,
    pub app_subtitle: String,
    pub app_tagline: String,
    pub logo_url: Option<String>,
    pub favicon_url: String,
    pub repository_url: String,
    pub topology_switch_order: Vec<String>,
    pub topology_uplink_labels: Vec<String>,
    pub topology_preferred_uplink: Option<String>,
    pub topology_central_node: Option<String>,
}

#[utoipa::path(
    get,
    path = "/api/v1/config",
    tag = "misc",
    responses((status = 200, body = PublicConfigResponse))
)]
pub(crate) async fn public_config(State(state): State<AppState>) -> Json<PublicConfigResponse> {
    Json(PublicConfigResponse {
        app_name: state.config.app_name.clone(),
        app_subtitle: state.config.app_subtitle.clone(),
        app_tagline: state.config.app_tagline.clone(),
        logo_url: state.config.app_logo_url.clone(),
        favicon_url: state.config.app_favicon_url.clone(),
        repository_url: "https://github.com/n1tr0-5urf3r/kn-rsvp".into(),
        topology_switch_order: state.config.topology_switch_order.clone(),
        topology_uplink_labels: state.config.topology_uplink_labels.clone(),
        topology_preferred_uplink: state.config.topology_preferred_uplink.clone(),
        topology_central_node: state.config.topology_central_node.clone(),
    })
}

pub async fn build_app(state: AppState) -> anyhow::Result<Router> {
    db::seed_defaults(&state.db).await?;

    let mut cors_origins = vec![HeaderValue::from_static("http://localhost:5173")];
    if let Ok(origin) = HeaderValue::from_str(&state.config.public_base_url) {
        cors_origins.push(origin);
    }

    let api = Router::new()
        .route("/health", get(health))
        .route("/config", get(public_config))
        .merge(auth::router())
        .merge(devices::router())
        .merge(ports::router())
        .merge(management::router())
        .merge(bookings::router())
        .merge(settings::router())
        .merge(caldav::router());

    let mut app = Router::new()
        .nest("/api/v1", api)
        .merge(openapi::router())
        .layer(CookieManagerLayer::new())
        .layer(
            CorsLayer::new()
                .allow_origin(cors_origins)
                .allow_methods([
                    Method::GET,
                    Method::POST,
                    Method::PUT,
                    Method::PATCH,
                    Method::DELETE,
                    Method::OPTIONS,
                ])
                .allow_headers([
                    header::CONTENT_TYPE,
                    header::ACCEPT,
                    header::AUTHORIZATION,
                    HeaderName::from_static("x-requested-with"),
                ])
                .allow_credentials(true),
        )
        .layer(TraceLayer::new_for_http())
        .with_state(state.clone());

    if let Some(frontend_dist) = &state.config.frontend_dist {
        let dist = PathBuf::from(frontend_dist);
        if dist.exists() {
            let index = dist.join("index.html");
            app =
                app.fallback_service(ServeDir::new(&dist).not_found_service(ServeFile::new(index)));
        } else {
            tracing::warn!(
                "FRONTEND_DIST '{}' does not exist; serving API only",
                dist.display()
            );
        }
    }

    if let Some(branding_dir) = &state.config.branding_dir {
        let branding = PathBuf::from(branding_dir);
        if branding.exists() {
            app = app.nest_service("/branding", ServeDir::new(branding));
        } else {
            tracing::warn!(
                "BRANDING_DIR '{}' does not exist; custom branding assets are unavailable",
                branding.display()
            );
        }
    }

    Ok(app)
}
