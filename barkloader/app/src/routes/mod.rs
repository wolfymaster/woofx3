pub mod archives;
pub mod assets;
pub mod echo;
pub mod functions;
pub mod media;
pub mod oauth;
pub mod resources;
pub mod storage;
pub mod websocket;
pub mod widgets;

use std::sync::Arc;

use actix_web::middleware::from_fn;
use actix_web::web::{self, ServiceConfig};

use crate::middleware::service_auth::{ServiceAuth, service_auth};

/// Registers every route in one of two scopes.
///
/// Public routes are the ones a browser reaches, through the scene manager's
/// relays, each guarded by its own token or public by design: asset reads,
/// signed media proxy URLs and grant-guarded uploads. Every other route needs
/// the service key (see `middleware::service_auth`).
///
/// Order matters. The public routes are registered first and match on method
/// as well as path, so a request they do not take falls through to the
/// authenticated scope. That scope has an empty prefix and takes everything
/// left, so an unknown path is refused rather than answered 404 to a caller
/// without the key. Within the public routes, `/assets/media/{token}` must
/// come before the catch-all `/assets/{key}`.
pub fn configure(cfg: &mut ServiceConfig, auth: Arc<ServiceAuth>) {
    cfg.configure(media::configure)
        .configure(resources::configure_public)
        .configure(assets::configure)
        .service(
            web::scope("")
                .wrap(from_fn(move |req, next| {
                    service_auth(auth.clone(), req, next)
                }))
                .configure(archives::configure)
                .configure(resources::configure)
                .configure(storage::configure)
                .configure(echo::configure)
                .configure(websocket::configure)
                .configure(functions::configure)
                .configure(oauth::configure)
                .configure(widgets::configure),
        );
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::middleware::access_log;
    use actix_web::http::{Method, StatusCode};
    use actix_web::{App, test as actix_test};
    use std::sync::Mutex;

    const KEY: &str = "0123456789abcdef0123456789abcdef";
    const HOST: &str = "127.0.0.1:9653";

    /// A label, the request's headers and the status every route answers.
    type RouteCase = (&'static str, Vec<(&'static str, String)>, StatusCode);

    /// Every authenticated route, one request each. Handlers never run for a
    /// refused request, so no application data is registered.
    const AUTHENTICATED: &[(Method, &str)] = &[
        (Method::POST, "/functions"),
        (Method::GET, "/functions"),
        (Method::GET, "/functions/demo"),
        (Method::GET, "/functions/demo/versions"),
        (Method::DELETE, "/functions/demo"),
        (Method::POST, "/functions/demo/register"),
        (Method::PATCH, "/functions/demo/state"),
        (Method::PATCH, "/functions/reload"),
        (Method::POST, "/functions/demo/rollback"),
        (Method::POST, "/storage/reload"),
        (Method::POST, "/assets/upload-url"),
        (Method::POST, "/assets/poster-upload-url"),
        (Method::POST, "/assets/process"),
        (Method::DELETE, "/assets/resource"),
        (Method::POST, "/modules/demo/oauth/spotify/complete"),
        (Method::GET, "/archives/files"),
        (Method::GET, "/archives/file"),
        (Method::GET, "/widgets/demo/clock/frame"),
        (Method::GET, "/themes"),
        (Method::GET, "/echo"),
        (Method::GET, "/ws"),
        (Method::GET, "/no-such-route"),
    ];

    /// What a browser reaches through the scene manager's relays.
    const PUBLIC: &[(Method, &str)] = &[
        (Method::GET, "/assets/modules/demo/icon.png"),
        (Method::GET, "/assets/media/some-token"),
        (Method::PUT, "/assets/upload/some-grant"),
    ];

    fn auth() -> Arc<ServiceAuth> {
        Arc::new(ServiceAuth::new(KEY, 9653, "").unwrap())
    }

    async fn status_of(method: &Method, path: &str, headers: &[(&str, String)]) -> StatusCode {
        let app =
            actix_test::init_service(App::new().configure(|cfg| configure(cfg, auth()))).await;
        let mut request = actix_test::TestRequest::default()
            .method(method.clone())
            .uri(path);
        for (name, value) in headers {
            request = request.insert_header((*name, value.as_str()));
        }
        actix_test::call_service(&app, request.to_request())
            .await
            .status()
    }

    fn bearer(key: &str) -> (&'static str, String) {
        ("authorization", format!("Bearer {key}"))
    }

    fn host(value: &str) -> (&'static str, String) {
        ("host", value.to_string())
    }

    fn is_refused(status: StatusCode) -> bool {
        status == StatusCode::UNAUTHORIZED || status == StatusCode::FORBIDDEN
    }

    #[actix_web::test]
    async fn test_configure_refuses_authenticated_routes_table() {
        let wrong = "ffffffffffffffffffffffffffffffff";
        let cases: Vec<RouteCase> = vec![
            ("no header", vec![host(HOST)], StatusCode::UNAUTHORIZED),
            (
                "wrong key",
                vec![host(HOST), bearer(wrong)],
                StatusCode::UNAUTHORIZED,
            ),
            (
                "cross-origin page",
                vec![
                    host(HOST),
                    bearer(KEY),
                    ("origin", "https://evil.example".to_string()),
                ],
                StatusCode::FORBIDDEN,
            ),
            (
                "rebound host",
                vec![host("evil.example"), bearer(KEY)],
                StatusCode::FORBIDDEN,
            ),
        ];
        for (method, path) in AUTHENTICATED {
            for (label, headers, expected) in &cases {
                assert_eq!(
                    status_of(method, path, headers).await,
                    *expected,
                    "{method} {path}: {label}"
                );
            }
        }
    }

    #[actix_web::test]
    async fn test_configure_passes_the_correct_key() {
        for (method, path) in AUTHENTICATED {
            let status = status_of(method, path, &[host(HOST), bearer(KEY)]).await;
            assert!(!is_refused(status), "{method} {path}: {status}");
        }
    }

    #[actix_web::test]
    async fn test_configure_public_routes_need_no_key() {
        for (method, path) in PUBLIC {
            let status = status_of(method, path, &[]).await;
            assert!(!is_refused(status), "{method} {path}: {status}");
        }
    }

    #[actix_web::test]
    async fn test_configure_refuses_a_query_string_ws_token() {
        let path = format!("/ws?token={KEY}");
        assert_eq!(
            status_of(&Method::GET, &path, &[host(HOST)]).await,
            StatusCode::UNAUTHORIZED
        );
    }

    /// Collects the access log's lines. `log` takes one logger per process,
    /// and only the access log test installs it.
    struct AccessLogCapture(Mutex<Vec<String>>);

    impl log::Log for AccessLogCapture {
        fn enabled(&self, metadata: &log::Metadata) -> bool {
            metadata.target() == "actix_web::middleware::logger"
        }

        fn log(&self, record: &log::Record) {
            if self.enabled(record.metadata()) {
                self.0.lock().unwrap().push(record.args().to_string());
            }
        }

        fn flush(&self) {}
    }

    static ACCESS_LOG: AccessLogCapture = AccessLogCapture(Mutex::new(Vec::new()));

    #[actix_web::test]
    async fn test_access_log_never_records_the_query_string() {
        log::set_logger(&ACCESS_LOG).expect("only this test installs a logger");
        log::set_max_level(log::LevelFilter::Info);
        let app = actix_test::init_service(
            App::new()
                .wrap(access_log())
                .configure(|cfg| configure(cfg, auth())),
        )
        .await;
        for path in [
            format!("/ws?token={KEY}"),
            "/assets/media/logged-token?sig=query-secret".to_string(),
        ] {
            let request = actix_test::TestRequest::get()
                .uri(&path)
                .insert_header(("host", HOST))
                .to_request();
            actix_test::call_and_read_body(&app, request).await;
        }

        let lines = ACCESS_LOG.0.lock().unwrap().clone();
        let ws_line = lines.iter().find(|line| line.contains("\"GET /ws\""));
        let media_line = lines
            .iter()
            .find(|line| line.contains("\"GET /assets/media/logged-token\""));
        assert!(ws_line.is_some(), "{lines:?}");
        assert!(media_line.is_some(), "{lines:?}");
        for line in &lines {
            assert!(!line.contains(KEY), "{line}");
            assert!(!line.contains("query-secret"), "{line}");
            assert!(!line.contains('?'), "{line}");
        }
    }
}
