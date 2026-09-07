use std::{env, net::SocketAddr, time::Duration};

#[derive(Clone, Debug)]
pub struct Config {
    pub database_url: String,
    pub bind_addr: SocketAddr,
    pub public_base_url: String,
    pub frontend_dist: Option<String>,
    pub session_secret: String,
    pub session_ttl: Duration,
    pub authentik_issuer_url: String,
    pub authentik_client_id: String,
    pub authentik_client_secret: String,
    pub authentik_redirect_uri: String,
    pub authentik_scopes: Vec<String>,
    pub authentik_groups_claim: String,
    /// Normalized (lowercase, alphanumeric-only) group names; empty = allow
    /// any authenticated user.
    pub auth_allowed_groups: Vec<String>,
    /// Normalized group names whose members become admins.
    pub auth_admin_groups: Vec<String>,
    pub auth_dev_mode: bool,
    pub timezone: String,
    pub app_name: String,
    pub app_subtitle: String,
    pub app_tagline: String,
    pub app_logo_url: Option<String>,
    pub app_favicon_url: String,
    pub branding_dir: Option<String>,
    pub topology_switch_order: Vec<String>,
    pub topology_uplink_labels: Vec<String>,
    pub topology_preferred_uplink: Option<String>,
    pub topology_central_node: Option<String>,
    pub caldav_product_id: String,
    pub caldav_uid_domain: String,
}

impl Config {
    pub fn from_env() -> anyhow::Result<Self> {
        let database_url =
            env::var("DATABASE_URL").unwrap_or_else(|_| "sqlite://rsvp.db".to_string());
        let bind_addr = match env::var("PORT") {
            Ok(port) => format!("0.0.0.0:{}", port.trim()).parse()?,
            Err(_) => env::var("BIND_ADDR")
                .unwrap_or_else(|_| "0.0.0.0:3125".to_string())
                .parse()?,
        };
        let public_base_url = env::var("PUBLIC_BASE_URL")
            .unwrap_or_else(|_| "http://localhost:3125".into())
            .trim_end_matches('/')
            .to_string();
        let frontend_dist = optional_env("FRONTEND_DIST");
        let session_secret =
            env::var("SESSION_SECRET").unwrap_or_else(|_| "dev-session-secret-change-me".into());
        let session_ttl_hours: u64 = env::var("AUTH_SESSION_TTL_HOURS")
            .ok()
            .and_then(|value| value.trim().parse().ok())
            .unwrap_or(168);
        let authentik_issuer_url = env::var("AUTHENTIK_ISSUER_URL").unwrap_or_default();
        let authentik_client_id = env::var("AUTHENTIK_CLIENT_ID").unwrap_or_default();
        let authentik_client_secret = env::var("AUTHENTIK_CLIENT_SECRET").unwrap_or_default();
        let authentik_redirect_uri = env::var("AUTHENTIK_REDIRECT_URI")
            .ok()
            .and_then(non_empty_trimmed)
            .unwrap_or_else(|| format!("{public_base_url}/api/v1/auth/callback"));
        let authentik_scopes = parse_csv_or_space(
            &env::var("AUTHENTIK_SCOPES").unwrap_or_else(|_| "openid profile email groups".into()),
        );
        let authentik_groups_claim =
            env::var("AUTHENTIK_GROUPS_CLAIM").unwrap_or_else(|_| "groups".into());
        let auth_allowed_groups =
            normalized_groups(&env::var("AUTH_ALLOWED_GROUPS").unwrap_or_default());
        let auth_admin_groups =
            normalized_groups(&env::var("AUTH_ADMIN_GROUPS").unwrap_or_else(|_| "admins".into()));
        let auth_dev_mode = truthy(&env::var("AUTH_DEV_MODE").unwrap_or_default());
        let timezone = env::var("TIMEZONE").unwrap_or_else(|_| "UTC".into());
        let app_name = env::var("APP_NAME").unwrap_or_else(|_| "RSVP".into());
        let app_subtitle =
            env::var("APP_SUBTITLE").unwrap_or_else(|_| "Hardware reservations".into());
        let app_tagline = env::var("APP_TAGLINE").unwrap_or_else(|_| {
            "Reserve shared lab hardware and understand the testbed at a glance.".into()
        });
        let app_logo_url = optional_env("APP_LOGO_URL");
        let app_favicon_url = env::var("APP_FAVICON_URL")
            .ok()
            .and_then(non_empty_trimmed)
            .unwrap_or_else(|| "/favicon.svg".into());
        let branding_dir = optional_env("BRANDING_DIR").or_else(|| Some("data/branding".into()));
        let topology_switch_order =
            parse_csv(&env::var("TOPOLOGY_SWITCH_ORDER").unwrap_or_default());
        let topology_uplink_labels =
            parse_csv(&env::var("TOPOLOGY_UPLINK_LABELS").unwrap_or_default());
        let topology_preferred_uplink = optional_env("TOPOLOGY_PREFERRED_UPLINK");
        let topology_central_node = optional_env("TOPOLOGY_CENTRAL_NODE");
        let caldav_product_id = env::var("CALDAV_PRODUCT_ID")
            .unwrap_or_else(|_| "-//RSVP//Hardware reservations//EN".into());
        let caldav_uid_domain = env::var("CALDAV_UID_DOMAIN")
            .ok()
            .and_then(non_empty_trimmed)
            .unwrap_or_else(|| "localhost".into());

        Ok(Self {
            database_url,
            bind_addr,
            public_base_url,
            frontend_dist,
            session_secret,
            session_ttl: Duration::from_secs(session_ttl_hours * 3600),
            authentik_issuer_url,
            authentik_client_id,
            authentik_client_secret,
            authentik_redirect_uri,
            authentik_scopes,
            authentik_groups_claim,
            auth_allowed_groups,
            auth_admin_groups,
            auth_dev_mode,
            timezone,
            app_name,
            app_subtitle,
            app_tagline,
            app_logo_url,
            app_favicon_url,
            branding_dir,
            topology_switch_order,
            topology_uplink_labels,
            topology_preferred_uplink,
            topology_central_node,
            caldav_product_id,
            caldav_uid_domain,
        })
    }
}

pub fn truthy(value: &str) -> bool {
    matches!(
        value.trim().to_ascii_lowercase().as_str(),
        "1" | "true" | "yes" | "on"
    )
}

fn optional_env(name: &str) -> Option<String> {
    env::var(name).ok().and_then(non_empty_trimmed)
}

fn non_empty_trimmed(value: String) -> Option<String> {
    let value = value.trim().to_string();
    (!value.is_empty()).then_some(value)
}

fn parse_csv_or_space(value: &str) -> Vec<String> {
    value
        .split([',', ' '])
        .map(str::trim)
        .filter(|value| !value.is_empty())
        .map(ToOwned::to_owned)
        .collect()
}

fn parse_csv(value: &str) -> Vec<String> {
    value
        .split(',')
        .map(str::trim)
        .filter(|value| !value.is_empty())
        .map(ToOwned::to_owned)
        .collect()
}

fn normalized_groups(value: &str) -> Vec<String> {
    value
        .split(',')
        .map(crate::auth::normalize_group_name)
        .filter(|value| !value.is_empty())
        .collect()
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn truthy_accepts_common_forms() {
        assert!(truthy("1"));
        assert!(truthy("true"));
        assert!(truthy(" YES "));
        assert!(!truthy("0"));
        assert!(!truthy(""));
        assert!(!truthy("false"));
    }

    #[test]
    fn groups_are_normalized_from_csv() {
        assert_eq!(
            normalized_groups("KN Staff, admin,,kn-hiwi "),
            vec!["knstaff", "admin", "knhiwi"]
        );
        assert!(normalized_groups("").is_empty());
    }

    #[test]
    fn scopes_split_on_commas_and_spaces() {
        assert_eq!(
            parse_csv_or_space("openid profile,email  groups"),
            vec!["openid", "profile", "email", "groups"]
        );
    }
}
