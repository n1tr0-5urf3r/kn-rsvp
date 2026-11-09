mod common;

use axum::{
    body::Body,
    http::{Request, StatusCode, header},
};
use http_body_util::BodyExt;
use tower::ServiceExt;

/// Deep links into the SPA must be served as `index.html` with 200, not 404:
/// reverse proxies, crawlers and monitoring treat a 404 as a broken page.
#[tokio::test]
async fn spa_routes_serve_index_with_ok_and_unknown_api_paths_stay_json_404() {
    let dist = std::env::temp_dir().join(format!("rsvp-spa-test-{}", std::process::id()));
    std::fs::create_dir_all(dist.join("assets")).unwrap();
    std::fs::write(
        dist.join("index.html"),
        "<!doctype html><title>rsvp</title>",
    )
    .unwrap();
    std::fs::write(dist.join("assets/app.js"), "console.log(1)").unwrap();

    let mut state = common::test_state().await;
    state.config.frontend_dist = Some(dist.to_string_lossy().into_owned());
    let app = rsvp::build_app(state).await.unwrap();

    let get = |uri: &str| {
        let app = app.clone();
        let uri = uri.to_owned();
        async move {
            let response = app
                .oneshot(Request::get(&uri).body(Body::empty()).unwrap())
                .await
                .unwrap();
            let status = response.status();
            let content_type = response
                .headers()
                .get(header::CONTENT_TYPE)
                .map(|v| v.to_str().unwrap().to_owned())
                .unwrap_or_default();
            let body = response.into_body().collect().await.unwrap().to_bytes();
            (
                status,
                content_type,
                String::from_utf8_lossy(&body).into_owned(),
            )
        }
    };

    for path in [
        "/",
        "/servers",
        "/tofinos/abc",
        "/calendar?view=month",
        "/admin/devices",
    ] {
        let (status, content_type, body) = get(path).await;
        assert_eq!(status, StatusCode::OK, "{path}");
        assert!(
            content_type.starts_with("text/html"),
            "{path}: {content_type}"
        );
        assert!(body.contains("<title>rsvp</title>"), "{path}");
    }

    let (status, _, body) = get("/assets/app.js").await;
    assert_eq!(status, StatusCode::OK);
    assert_eq!(body, "console.log(1)");

    let (status, content_type, body) = get("/api/v1/does-not-exist").await;
    assert_eq!(status, StatusCode::NOT_FOUND);
    assert!(
        content_type.starts_with("application/json"),
        "{content_type}"
    );
    assert!(body.contains("not found"), "{body}");

    let (status, _, _) = get("/api/v1/health").await;
    assert_eq!(status, StatusCode::OK);

    std::fs::remove_dir_all(&dist).ok();
}
