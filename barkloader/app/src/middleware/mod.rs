pub mod service_auth;

use actix_web::middleware::Logger;

/// The access log line: peer, method, path, status, size, seconds. The path is
/// `%U`, never the request line (`%r`) or the query (`%q`): a query can carry a
/// credential, such as a media proxy token, and the log must not keep it.
/// actix's Logger has no method placeholder, so the method is a custom one.
pub const ACCESS_LOG_FORMAT: &str = "%a \"%{METHOD}xi %U\" %s %b %T";

pub fn access_log() -> Logger {
    Logger::new(ACCESS_LOG_FORMAT).custom_request_replace("METHOD", |req| req.method().to_string())
}
