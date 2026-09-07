use std::collections::HashMap;

use axum::{
    Json, Router,
    extract::{FromRequestParts, Query, State},
    http::{StatusCode, request::Parts},
    response::Redirect,
    routing::{get, post},
};
use base64::{Engine, engine::general_purpose::URL_SAFE_NO_PAD};
use openidconnect::{
    AccessTokenHash, AuthorizationCode, ClientId, ClientSecret, CsrfToken, IssuerUrl, Nonce,
    OAuth2TokenResponse, PkceCodeChallenge, PkceCodeVerifier, RedirectUrl, Scope, TokenResponse,
    core::{CoreAuthenticationFlow, CoreClient, CoreProviderMetadata},
};
use serde::{Deserialize, Serialize};
use serde_json::Value;
use sha2::{Digest, Sha256};
use tower_cookies::{
    Cookie, Cookies,
    cookie::{SameSite, time::Duration as CookieDuration},
};
use utoipa::ToSchema;
use uuid::Uuid;

use crate::{
    AppState,
    config::truthy,
    db::now_ts,
    error::{ApiError, ApiResult},
};

pub const SESSION_COOKIE: &str = "rsvp_session";
const PENDING_OAUTH_TTL_SECONDS: i64 = 600;

pub fn router() -> Router<AppState> {
    Router::new()
        .route("/auth/login", get(login))
        .route("/auth/callback", get(callback))
        .route("/auth/logout", post(logout))
        .route("/auth/me", get(me))
        .route("/auth/dev-login", get(dev_login))
}

/// Pending OAuth state kept in memory between /auth/login and /auth/callback,
/// keyed by the CSRF state token.
#[derive(Clone)]
pub struct PendingOAuth {
    pub nonce: String,
    pub pkce_verifier: String,
    pub expires_at: i64,
}

#[derive(Debug, Clone, Serialize, ToSchema)]
pub struct CurrentUser {
    pub id: String,
    pub username: String,
    pub display_name: String,
    pub email: Option<String>,
    pub is_admin: bool,
}

/// Extractor for an authenticated user; rejects with 401 when the session is
/// missing, expired, or revoked.
impl FromRequestParts<AppState> for CurrentUser {
    type Rejection = ApiError;

    async fn from_request_parts(parts: &mut Parts, state: &AppState) -> Result<Self, ApiError> {
        let token = session_token_from_parts(parts).ok_or(ApiError::Unauthorized)?;
        load_user_from_session(state, &token).await
    }
}

/// Extractor that additionally requires `is_admin`; rejects with 403 for
/// authenticated non-admins.
pub struct AdminUser(pub CurrentUser);

impl FromRequestParts<AppState> for AdminUser {
    type Rejection = ApiError;

    async fn from_request_parts(parts: &mut Parts, state: &AppState) -> Result<Self, ApiError> {
        let user = CurrentUser::from_request_parts(parts, state).await?;
        if !user.is_admin {
            return Err(ApiError::Forbidden);
        }
        Ok(AdminUser(user))
    }
}

fn session_token_from_parts(parts: &Parts) -> Option<String> {
    let header = parts
        .headers
        .get(axum::http::header::COOKIE)
        .and_then(|value| value.to_str().ok())?;
    header
        .split(';')
        .filter_map(|part| Cookie::parse(part.trim().to_string()).ok())
        .find(|cookie| cookie.name() == SESSION_COOKIE)
        .map(|cookie| cookie.value().to_string())
}

#[derive(Serialize, ToSchema)]
pub struct MeResponse {
    pub user: Option<CurrentUser>,
}

#[derive(Deserialize)]
pub(crate) struct CallbackQuery {
    code: Option<String>,
    state: Option<String>,
    error: Option<String>,
}

#[derive(Deserialize, ToSchema)]
pub(crate) struct DevLoginQuery {
    name: Option<String>,
    admin: Option<String>,
}

#[utoipa::path(
    get,
    path = "/api/v1/auth/login",
    tag = "auth",
    responses((status = 307, description = "Redirects to the Authentik authorization endpoint"))
)]
pub(crate) async fn login(State(state): State<AppState>) -> ApiResult<Redirect> {
    if state.config.authentik_issuer_url.is_empty() || state.config.authentik_client_id.is_empty() {
        return Err(ApiError::BadRequest(
            "AUTHENTIK_ISSUER_URL and AUTHENTIK_CLIENT_ID must be configured".into(),
        ));
    }

    let client = oidc_client(&state).await?;
    let state_token = random_token();
    let csrf_token = state_token.clone();
    let (pkce_challenge, pkce_verifier) = PkceCodeChallenge::new_random_sha256();

    let mut request = client
        .authorize_url(
            CoreAuthenticationFlow::AuthorizationCode,
            move || CsrfToken::new(csrf_token),
            Nonce::new_random,
        )
        .set_pkce_challenge(pkce_challenge);
    for scope in &state.config.authentik_scopes {
        if scope != "openid" {
            request = request.add_scope(Scope::new(scope.clone()));
        }
    }
    let (authorize_url, _, nonce) = request.url();

    let now = now_ts();
    {
        let mut pending = state
            .pending_oauth
            .lock()
            .map_err(|_| ApiError::Other(anyhow::anyhow!("pending OAuth lock poisoned")))?;
        pending.retain(|_, value| value.expires_at > now);
        pending.insert(
            state_token,
            PendingOAuth {
                nonce: nonce.secret().to_string(),
                pkce_verifier: pkce_verifier.secret().to_string(),
                expires_at: now + PENDING_OAUTH_TTL_SECONDS,
            },
        );
    }

    Ok(Redirect::temporary(authorize_url.as_str()))
}

#[utoipa::path(
    get,
    path = "/api/v1/auth/callback",
    tag = "auth",
    params(
        ("code" = Option<String>, Query, description = "Authorization code"),
        ("state" = Option<String>, Query, description = "CSRF state token")
    ),
    responses((status = 307, description = "Creates a session and redirects to / or /login?error=forbidden"))
)]
pub(crate) async fn callback(
    State(state): State<AppState>,
    cookies: Cookies,
    Query(query): Query<CallbackQuery>,
) -> ApiResult<Redirect> {
    if query.error.is_some() {
        return Ok(Redirect::temporary("/login?error=forbidden"));
    }
    let state_token = query
        .state
        .ok_or_else(|| ApiError::BadRequest("missing OAuth state".into()))?;
    let pending = {
        let mut pending = state
            .pending_oauth
            .lock()
            .map_err(|_| ApiError::Other(anyhow::anyhow!("pending OAuth lock poisoned")))?;
        pending.remove(&state_token)
    };
    let Some(pending) = pending.filter(|value| value.expires_at > now_ts()) else {
        return Ok(Redirect::temporary("/login?error=expired"));
    };
    let code = query
        .code
        .ok_or_else(|| ApiError::BadRequest("missing authorization code".into()))?;

    let client = oidc_client(&state).await?;
    let http = oidc_http_client()?;
    let token_response = client
        .exchange_code(AuthorizationCode::new(code))
        .map_err(|err| {
            tracing::warn!(?err, "Authentik token endpoint unavailable");
            ApiError::Upstream
        })?
        .set_pkce_verifier(PkceCodeVerifier::new(pending.pkce_verifier))
        .request_async(&http)
        .await
        .map_err(|err| {
            tracing::warn!(?err, "Authentik code exchange failed");
            ApiError::Upstream
        })?;

    let id_token = token_response.id_token().ok_or_else(|| {
        tracing::warn!("Authentik did not return an ID token");
        ApiError::Upstream
    })?;
    let id_token_verifier = client.id_token_verifier();
    let claims = id_token
        .claims(&id_token_verifier, &Nonce::new(pending.nonce))
        .map_err(|err| {
            tracing::warn!(?err, "ID token verification failed");
            ApiError::Forbidden
        })?;

    if let Some(expected_hash) = claims.access_token_hash() {
        let actual_hash = AccessTokenHash::from_token(
            token_response.access_token(),
            id_token.signing_alg().map_err(|err| {
                tracing::warn!(?err, "failed to inspect ID token signing alg");
                ApiError::Upstream
            })?,
            id_token.signing_key(&id_token_verifier).map_err(|err| {
                tracing::warn!(?err, "failed to inspect ID token signing key");
                ApiError::Upstream
            })?,
        )
        .map_err(|err| {
            tracing::warn!(?err, "failed to compute access token hash");
            ApiError::Upstream
        })?;
        if actual_hash != *expected_hash {
            return Err(ApiError::Forbidden);
        }
    }

    let raw_claims = decode_jwt_claims(&id_token.to_string())?;
    let groups = claim_group_values(&raw_claims, &state.config.authentik_groups_claim);
    if !state.config.auth_allowed_groups.is_empty()
        && !has_any_normalized_group(&groups, &state.config.auth_allowed_groups)
    {
        return Ok(Redirect::temporary("/login?error=forbidden"));
    }
    let is_admin = has_any_normalized_group(&groups, &state.config.auth_admin_groups);

    let sub = claims.subject().as_str().to_string();
    let email = claims
        .email()
        .map(|email| email.as_str().to_string())
        .or_else(|| {
            raw_claims
                .get("email")
                .and_then(Value::as_str)
                .map(ToOwned::to_owned)
        });
    let username = raw_claims
        .get("preferred_username")
        .and_then(Value::as_str)
        .map(str::trim)
        .filter(|value| !value.is_empty())
        .map(ToOwned::to_owned)
        .or_else(|| {
            email
                .as_deref()
                .map(|email| email.split('@').next().unwrap_or(email).to_string())
        })
        .unwrap_or_else(|| sub.clone());
    let display_name = raw_claims
        .get("name")
        .and_then(Value::as_str)
        .map(str::trim)
        .filter(|value| !value.is_empty())
        .map(ToOwned::to_owned)
        .unwrap_or_else(|| username.clone());

    let user_id = upsert_user(
        &state,
        &UpsertUser {
            oidc_sub: &sub,
            username: &username,
            display_name: &display_name,
            email: email.as_deref(),
            is_admin,
            groups: &groups,
        },
    )
    .await?;
    issue_session(&state, &cookies, &user_id).await?;
    Ok(Redirect::temporary("/"))
}

#[utoipa::path(
    get,
    path = "/api/v1/auth/dev-login",
    tag = "auth",
    params(
        ("name" = Option<String>, Query, description = "Dev user name (default: dev)"),
        ("admin" = Option<String>, Query, description = "Truthy value grants admin")
    ),
    responses(
        (status = 307, description = "Creates a dev session and redirects to /"),
        (status = 404, description = "Dev mode is disabled")
    )
)]
pub(crate) async fn dev_login(
    State(state): State<AppState>,
    cookies: Cookies,
    Query(query): Query<DevLoginQuery>,
) -> ApiResult<Redirect> {
    if !state.config.auth_dev_mode {
        return Err(ApiError::NotFound);
    }
    let name = query
        .name
        .as_deref()
        .map(str::trim)
        .filter(|value| !value.is_empty())
        .unwrap_or("dev")
        .to_string();
    let is_admin = query.admin.as_deref().map(truthy).unwrap_or(false);
    let sub = format!("dev:{name}");
    let email = format!("{name}@dev.local");

    let user_id = upsert_user(
        &state,
        &UpsertUser {
            oidc_sub: &sub,
            username: &name,
            display_name: &name,
            email: Some(&email),
            is_admin,
            groups: &["dev".to_string()],
        },
    )
    .await?;
    issue_session(&state, &cookies, &user_id).await?;
    Ok(Redirect::temporary("/"))
}

#[utoipa::path(
    post,
    path = "/api/v1/auth/logout",
    tag = "auth",
    responses((status = 204, description = "Session terminated"))
)]
pub(crate) async fn logout(
    State(state): State<AppState>,
    cookies: Cookies,
) -> ApiResult<StatusCode> {
    if let Some(cookie) = cookies.get(SESSION_COOKIE) {
        let hash = hash_session(&state.config.session_secret, cookie.value());
        sqlx::query("UPDATE sessions SET revoked_at = ? WHERE id_hash = ?")
            .bind(now_ts())
            .bind(hash)
            .execute(&state.db)
            .await?;
    }
    cookies.remove(cookie(SESSION_COOKIE, String::new(), 0, false));
    Ok(StatusCode::NO_CONTENT)
}

#[utoipa::path(
    get,
    path = "/api/v1/auth/me",
    tag = "auth",
    responses((status = 200, body = MeResponse))
)]
pub(crate) async fn me(State(state): State<AppState>, parts: Parts) -> ApiResult<Json<MeResponse>> {
    let user = match session_token_from_parts(&parts) {
        Some(token) => load_user_from_session(&state, &token).await.ok(),
        None => None,
    };
    Ok(Json(MeResponse { user }))
}

struct UpsertUser<'a> {
    oidc_sub: &'a str,
    username: &'a str,
    display_name: &'a str,
    email: Option<&'a str>,
    is_admin: bool,
    groups: &'a [String],
}

async fn upsert_user(state: &AppState, user: &UpsertUser<'_>) -> ApiResult<String> {
    let now = now_ts();
    let groups_json = serde_json::to_string(user.groups).unwrap_or_else(|_| "[]".into());
    sqlx::query(
        "INSERT INTO users
         (id, oidc_sub, username, display_name, email, is_admin, groups_json,
          created_at, updated_at, last_login_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
         ON CONFLICT(oidc_sub) DO UPDATE SET
             username = excluded.username,
             display_name = excluded.display_name,
             email = excluded.email,
             is_admin = excluded.is_admin,
             groups_json = excluded.groups_json,
             updated_at = excluded.updated_at,
             last_login_at = excluded.last_login_at",
    )
    .bind(Uuid::new_v4().to_string())
    .bind(user.oidc_sub)
    .bind(user.username)
    .bind(user.display_name)
    .bind(user.email)
    .bind(user.is_admin as i64)
    .bind(&groups_json)
    .bind(now)
    .bind(now)
    .bind(now)
    .execute(&state.db)
    .await?;

    let (id,): (String,) = sqlx::query_as("SELECT id FROM users WHERE oidc_sub = ?")
        .bind(user.oidc_sub)
        .fetch_one(&state.db)
        .await?;
    Ok(id)
}

async fn issue_session(state: &AppState, cookies: &Cookies, user_id: &str) -> ApiResult<()> {
    let token = create_session(state, user_id).await?;
    cookies.add(cookie(
        SESSION_COOKIE,
        token,
        state.config.session_ttl.as_secs() as i64,
        secure_cookies(state),
    ));
    Ok(())
}

async fn create_session(state: &AppState, user_id: &str) -> ApiResult<String> {
    let token = random_token();
    let now = now_ts();
    let id_hash = hash_session(&state.config.session_secret, &token);
    sqlx::query(
        "INSERT INTO sessions (id_hash, user_id, expires_at, revoked_at, created_at)
         VALUES (?, ?, ?, NULL, ?)",
    )
    .bind(id_hash)
    .bind(user_id)
    .bind(now + state.config.session_ttl.as_secs() as i64)
    .bind(now)
    .execute(&state.db)
    .await?;
    Ok(token)
}

async fn load_user_from_session(state: &AppState, token: &str) -> ApiResult<CurrentUser> {
    let hash = hash_session(&state.config.session_secret, token);
    let row: Option<(String, String, String, Option<String>, i64)> = sqlx::query_as(
        "SELECT u.id, u.username, u.display_name, u.email, u.is_admin
         FROM sessions s
         JOIN users u ON u.id = s.user_id
         WHERE s.id_hash = ? AND s.revoked_at IS NULL AND s.expires_at > ?",
    )
    .bind(hash)
    .bind(now_ts())
    .fetch_optional(&state.db)
    .await?;
    let (id, username, display_name, email, is_admin) = row.ok_or(ApiError::Unauthorized)?;
    Ok(CurrentUser {
        id,
        username,
        display_name,
        email,
        is_admin: is_admin != 0,
    })
}

async fn oidc_client(
    state: &AppState,
) -> ApiResult<
    CoreClient<
        openidconnect::EndpointSet,
        openidconnect::EndpointNotSet,
        openidconnect::EndpointNotSet,
        openidconnect::EndpointNotSet,
        openidconnect::EndpointMaybeSet,
        openidconnect::EndpointMaybeSet,
    >,
> {
    let http = oidc_http_client()?;
    let issuer = IssuerUrl::new(state.config.authentik_issuer_url.clone())
        .map_err(|err| ApiError::BadRequest(format!("invalid AUTHENTIK_ISSUER_URL: {err}")))?;
    let provider_metadata = CoreProviderMetadata::discover_async(issuer, &http)
        .await
        .map_err(|err| {
            tracing::warn!(?err, "OIDC discovery failed");
            ApiError::Upstream
        })?;
    let client = CoreClient::from_provider_metadata(
        provider_metadata,
        ClientId::new(state.config.authentik_client_id.clone()),
        Some(ClientSecret::new(
            state.config.authentik_client_secret.clone(),
        )),
    )
    .set_redirect_uri(
        RedirectUrl::new(state.config.authentik_redirect_uri.clone())
            .map_err(|err| ApiError::BadRequest(format!("invalid redirect URI: {err}")))?,
    );
    Ok(client)
}

fn oidc_http_client() -> ApiResult<openidconnect::reqwest::Client> {
    openidconnect::reqwest::ClientBuilder::new()
        .redirect(openidconnect::reqwest::redirect::Policy::none())
        .build()
        .map_err(|err| ApiError::Other(anyhow::anyhow!("failed to build OIDC HTTP client: {err}")))
}

fn decode_jwt_claims(token: &str) -> ApiResult<Value> {
    let payload = token
        .split('.')
        .nth(1)
        .ok_or_else(|| ApiError::Other(anyhow::anyhow!("ID token is not a valid JWT")))?;
    let bytes = URL_SAFE_NO_PAD
        .decode(payload)
        .map_err(|err| ApiError::Other(anyhow::anyhow!("failed to decode ID token: {err}")))?;
    serde_json::from_slice(&bytes)
        .map_err(|err| ApiError::Other(anyhow::anyhow!("failed to parse ID token claims: {err}")))
}

/// Extract group names from a claim that may be a JSON array of strings or a
/// single string.
fn claim_group_values(claims: &Value, groups_claim: &str) -> Vec<String> {
    match claims.get(groups_claim) {
        Some(Value::Array(values)) => values
            .iter()
            .filter_map(|value| value.as_str().map(ToOwned::to_owned))
            .collect(),
        Some(Value::String(value)) => vec![value.clone()],
        _ => Vec::new(),
    }
}

/// `expected` must already be normalized; `groups` are normalized on the fly.
fn has_any_normalized_group(groups: &[String], expected: &[String]) -> bool {
    groups
        .iter()
        .map(|group| normalize_group_name(group))
        .any(|group| expected.contains(&group))
}

pub fn normalize_group_name(value: &str) -> String {
    value
        .chars()
        .filter(|value| value.is_ascii_alphanumeric())
        .flat_map(char::to_lowercase)
        .collect()
}

fn secure_cookies(state: &AppState) -> bool {
    state.config.public_base_url.starts_with("https://")
}

fn cookie(
    name: &'static str,
    value: String,
    max_age_seconds: i64,
    secure: bool,
) -> Cookie<'static> {
    Cookie::build((name, value))
        .path("/")
        .http_only(true)
        .secure(secure)
        .same_site(SameSite::Lax)
        .max_age(CookieDuration::seconds(max_age_seconds))
        .build()
}

fn random_token() -> String {
    let mut bytes = [0_u8; 32];
    rand::fill(&mut bytes);
    URL_SAFE_NO_PAD.encode(bytes)
}

fn hash_session(secret: &str, token: &str) -> String {
    let mut hasher = Sha256::new();
    hasher.update(secret.as_bytes());
    hasher.update(b":");
    hasher.update(token.as_bytes());
    URL_SAFE_NO_PAD.encode(hasher.finalize())
}

/// Kept in `AppState`; convenience alias.
pub type PendingOAuthMap = HashMap<String, PendingOAuth>;

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::json;

    #[test]
    fn normalize_group_name_strips_non_alphanumerics_and_lowercases() {
        assert_eq!(normalize_group_name("KN Staff"), "knstaff");
        assert_eq!(normalize_group_name("kn-staff"), "knstaff");
        assert_eq!(normalize_group_name("knstaff"), "knstaff");
        assert_eq!(normalize_group_name("Ädmin!"), "dmin");
        assert_eq!(normalize_group_name(""), "");
    }

    #[test]
    fn claim_group_values_handles_array_and_string() {
        let claims = json!({"groups": ["kn-staff", "other"]});
        assert_eq!(
            claim_group_values(&claims, "groups"),
            vec!["kn-staff", "other"]
        );
        let claims = json!({"groups": "kn-staff"});
        assert_eq!(claim_group_values(&claims, "groups"), vec!["kn-staff"]);
        let claims = json!({"groups": 42});
        assert!(claim_group_values(&claims, "groups").is_empty());
        let claims = json!({});
        assert!(claim_group_values(&claims, "groups").is_empty());
    }

    #[test]
    fn group_matching_uses_normalized_names() {
        let groups = vec!["KN Staff".to_string(), "students".to_string()];
        assert!(has_any_normalized_group(&groups, &["knstaff".to_string()]));
        assert!(!has_any_normalized_group(&groups, &["admin".to_string()]));
    }
}
