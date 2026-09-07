#![allow(dead_code)]

use std::{str::FromStr, time::Duration};

use axum::{
    Router,
    body::Body,
    http::{Request, StatusCode, header},
};
use http_body_util::BodyExt;
use rsvp::{AppState, config::Config, db};
use serde_json::Value;
use sqlx::sqlite::{SqliteConnectOptions, SqlitePoolOptions};
use tower::ServiceExt;

pub fn test_config() -> Config {
    Config {
        database_url: "sqlite::memory:".into(),
        bind_addr: "127.0.0.1:0".parse().unwrap(),
        public_base_url: "http://localhost:3125".into(),
        frontend_dist: None,
        session_secret: "test-secret".into(),
        session_ttl: Duration::from_secs(3600),
        authentik_issuer_url: String::new(),
        authentik_client_id: String::new(),
        authentik_client_secret: String::new(),
        authentik_redirect_uri: String::new(),
        authentik_scopes: vec!["openid".into(), "profile".into()],
        authentik_groups_claim: "groups".into(),
        auth_allowed_groups: Vec::new(),
        auth_admin_groups: vec!["admins".into()],
        app_name: "RSVP".into(),
        app_subtitle: "Test lab".into(),
        app_tagline: "Reserve shared hardware.".into(),
        app_logo_url: None,
        app_favicon_url: "/favicon.svg".into(),
        branding_dir: None,
        topology_switch_order: Vec::new(),
        topology_uplink_labels: Vec::new(),
        topology_preferred_uplink: None,
        topology_central_node: None,
        caldav_product_id: "-//RSVP//Tests//EN".into(),
        caldav_uid_domain: "example.test".into(),
        auth_dev_mode: true,
        timezone: "UTC".into(),
    }
}

pub async fn test_state() -> AppState {
    let options = SqliteConnectOptions::from_str("sqlite::memory:")
        .unwrap()
        .foreign_keys(true);
    let pool = SqlitePoolOptions::new()
        .max_connections(1)
        .idle_timeout(None)
        .max_lifetime(None)
        .connect_with(options)
        .await
        .unwrap();
    db::MIGRATOR.run(&pool).await.unwrap();
    db::seed_defaults(&pool).await.unwrap();
    AppState::new(test_config(), pool)
}

pub async fn test_app() -> (AppState, Router) {
    let state = test_state().await;
    let app = rsvp::build_app(state.clone()).await.unwrap();
    (state, app)
}

/// Dev-login and return the session cookie ("rsvp_session=...").
pub async fn login(app: &Router, name: &str, admin: bool) -> String {
    let uri = format!(
        "/api/v1/auth/dev-login?name={name}&admin={}",
        if admin { "1" } else { "0" }
    );
    let response = app
        .clone()
        .oneshot(Request::get(&uri).body(Body::empty()).unwrap())
        .await
        .unwrap();
    assert!(
        response.status().is_redirection(),
        "dev-login should redirect, got {}",
        response.status()
    );
    let cookie = response
        .headers()
        .get(header::SET_COOKIE)
        .expect("dev-login sets a session cookie")
        .to_str()
        .unwrap();
    cookie.split(';').next().unwrap().to_string()
}

pub async fn request(
    app: &Router,
    method: &str,
    uri: &str,
    cookie: Option<&str>,
    body: Option<Value>,
) -> (StatusCode, Value) {
    let mut builder = Request::builder().method(method).uri(uri);
    if let Some(cookie) = cookie {
        builder = builder.header(header::COOKIE, cookie);
    }
    let request = match body {
        Some(body) => builder
            .header(header::CONTENT_TYPE, "application/json")
            .body(Body::from(body.to_string()))
            .unwrap(),
        None => builder.body(Body::empty()).unwrap(),
    };
    let response = app.clone().oneshot(request).await.unwrap();
    let status = response.status();
    let bytes = response.into_body().collect().await.unwrap().to_bytes();
    let value = if bytes.is_empty() {
        Value::Null
    } else {
        serde_json::from_slice(&bytes).unwrap_or(Value::Null)
    };
    (status, value)
}
