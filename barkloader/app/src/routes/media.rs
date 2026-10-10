//! `GET /assets/media/{token}`: relays the external media file a signed token
//! names (see `services::media_proxy`). sceneManager forwards the browser's
//! requests for this path from the engine's public origin, which is the origin
//! a widget frame's Content-Security-Policy allows media from.

use std::io;
use std::time::{Duration, Instant, SystemTime, UNIX_EPOCH};

use actix_web::body::{BodyStream, SizedStream};
use actix_web::http::StatusCode;
use actix_web::http::header::{self, HeaderValue};
use actix_web::web::{Data, Path, ServiceConfig};
use actix_web::{HttpRequest, HttpResponse, get};
use futures_util::StreamExt;
use tracing::warn;

use crate::services::media_budget::{MediaBudget, RelayStream};
use crate::services::media_proxy::{
    self, MAX_MEDIA_BYTES, MediaFetcher, MediaResponse, ProxyError, RangeRequest,
};

/// A relayed file is the upstream's, not the engine's: it may change, so it
/// is cached for a while rather than as immutable.
const MEDIA_CACHE_CONTROL: &str = "public, max-age=3600";

/// Everything that is not the file itself: refusals, upstream failures, a
/// range the file does not have, and an exhausted budget. A cached one would
/// keep answering after the cause has gone.
const NO_STORE: &str = "no-store";

/// Served from the engine's origin, a relayed file must never run as a page
/// there: an SVG opened directly would otherwise run its scripts with the
/// scene pages' origin. `sandbox` gives it an opaque origin besides.
const MEDIA_CSP: &str =
    "default-src 'none'; img-src data:; media-src data:; style-src 'unsafe-inline'; sandbox";

pub struct MediaProxyService {
    secret: String,
    fetcher: MediaFetcher,
    budget: MediaBudget,
}

impl MediaProxyService {
    pub fn new(secret: String, fetcher: MediaFetcher) -> Self {
        Self::with_budget(secret, fetcher, MediaBudget::default())
    }

    pub fn with_budget(secret: String, fetcher: MediaFetcher, budget: MediaBudget) -> Self {
        assert!(
            !secret.is_empty(),
            "the media proxy secret must not be empty"
        );
        Self {
            secret,
            fetcher,
            budget,
        }
    }
}

/// A token that does not verify, or has expired, gets a bare 404, like a
/// missing asset, so the route tells a prober nothing about what it sent. A
/// file that has used its relay budget (`services::media_budget`) gets a 429
/// until its window ends, and one with too many relays running a 429 for a
/// second.
#[get("/assets/media/{token}")]
#[tracing::instrument(name = "GET /assets/media/{token}", skip_all)]
async fn media_handler(
    service: Data<MediaProxyService>,
    token: Path<String>,
    request: HttpRequest,
) -> HttpResponse {
    let Ok(url) = media_proxy::verify(&service.secret, &token, unix_now()) else {
        return HttpResponse::NotFound().finish();
    };
    let header_text =
        |name: header::HeaderName| request.headers().get(name).and_then(|v| v.to_str().ok());
    let range =
        RangeRequest::from_headers(header_text(header::RANGE), header_text(header::IF_RANGE));
    let budget_key = url.as_str();
    let mut stream = match service.budget.admit(budget_key, Instant::now()) {
        Ok(stream) => stream,
        Err(refusal) => {
            warn!(
                "media proxy: not admitting a relay from host={} refusal={:?}",
                url.host_str().unwrap_or(""),
                refusal
            );
            return too_many_requests(refusal.retry_after());
        }
    };
    match service.fetcher.fetch(url.clone(), &range).await {
        Ok(media) => {
            if media.status != StatusCode::RANGE_NOT_SATISFIABLE.as_u16()
                && !stream.reserve(media.content_length)
            {
                warn!(
                    "media proxy: relay budget used up for host={}",
                    url.host_str().unwrap_or("")
                );
                return too_many_requests(service.budget.retry_after(budget_key, Instant::now()));
            }
            relay(media, stream)
        }
        Err(error) => {
            warn!(
                "media proxy: not relaying from host={} reason={}",
                url.host_str().unwrap_or(""),
                error
            );
            let status = match error {
                ProxyError::Refused(_) => StatusCode::FORBIDDEN,
                _ => StatusCode::BAD_GATEWAY,
            };
            HttpResponse::build(status)
                .insert_header((header::CACHE_CONTROL, NO_STORE))
                .finish()
        }
    }
}

fn too_many_requests(retry_after: Duration) -> HttpResponse {
    HttpResponse::TooManyRequests()
        .insert_header((header::CACHE_CONTROL, NO_STORE))
        .insert_header((
            header::RETRY_AFTER,
            retry_after.as_secs().max(1).to_string(),
        ))
        .finish()
}

fn unix_now() -> i64 {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map(|elapsed| elapsed.as_secs() as i64)
        .unwrap_or(0)
}

/// The upstream's response, its body counted against the relay budget through
/// `stream` as it streams. The relay counts as running until the body is
/// dropped, finished or not.
fn relay(media: MediaResponse, mut stream: RelayStream) -> HttpResponse {
    let status =
        StatusCode::from_u16(media.status).expect("the fetcher relays only 200, 206 and 416");
    let mut response = HttpResponse::build(status);
    for (name, value) in &media.headers {
        if let Ok(value) = HeaderValue::from_str(value) {
            response.insert_header((name.as_str(), value));
        }
    }
    response
        .insert_header((header::X_CONTENT_TYPE_OPTIONS, "nosniff"))
        .insert_header((header::CONTENT_SECURITY_POLICY, MEDIA_CSP))
        .insert_header((header::REFERRER_POLICY, "no-referrer"));
    if status == StatusCode::RANGE_NOT_SATISFIABLE {
        return response
            .insert_header((header::CACHE_CONTROL, NO_STORE))
            .finish();
    }
    response.insert_header((header::CACHE_CONTROL, MEDIA_CACHE_CONTROL));
    // Counted as it streams too: a declared length was checked already, but
    // an upstream that declared none, or declared too little, is cut off here,
    // as is one that runs the URL's budget out past what it reserved.
    let mut relayed: u64 = 0;
    let body = media.response.bytes_stream().map(move |chunk| {
        let chunk = chunk.map_err(io::Error::other)?;
        relayed += chunk.len() as u64;
        if relayed > MAX_MEDIA_BYTES {
            return Err(io::Error::other("media larger than the proxy relays"));
        }
        if !stream.relayed(chunk.len() as u64) {
            return Err(io::Error::other("the relay budget ran out mid-stream"));
        }
        Ok::<_, io::Error>(chunk)
    });
    match media.content_length {
        Some(length) => response.body(SizedStream::new(length, body)),
        None => response.body(BodyStream::new(body)),
    }
}

/// Registered ahead of `routes::assets`, whose `/assets/{key:.*}` would
/// otherwise take this path and answer 404.
pub fn configure(cfg: &mut ServiceConfig) {
    cfg.service(media_handler);
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::services::media_budget::BudgetLimits;
    use crate::services::media_proxy::sign;
    use crate::services::media_proxy::testing::{local_fetcher, raw, upstream};
    use actix_web::{App, test as actix_test};
    use std::net::{IpAddr, Ipv4Addr};

    const SECRET: &str = "test-barkloader-key";

    fn valid_token(url: &str) -> String {
        sign(SECRET, url, unix_now() + 3600)
    }

    fn service_with(budget: MediaBudget) -> Data<MediaProxyService> {
        Data::new(MediaProxyService::with_budget(
            SECRET.to_string(),
            local_fetcher(&[("media.test", IpAddr::V4(Ipv4Addr::LOCALHOST))]),
            budget,
        ))
    }

    async fn call_with(
        service: Data<MediaProxyService>,
        token: &str,
        range: Option<&str>,
    ) -> actix_web::dev::ServiceResponse {
        let app = actix_test::init_service(
            App::new()
                .app_data(service)
                .configure(configure)
                .configure(crate::routes::assets::configure),
        )
        .await;
        let mut request = actix_test::TestRequest::get().uri(&format!("/assets/media/{token}"));
        if let Some(range) = range {
            request = request.insert_header((header::RANGE, range));
        }
        actix_test::call_service(&app, request.to_request()).await
    }

    async fn call(token: &str, range: Option<&str>) -> actix_web::dev::ServiceResponse {
        call_with(service_with(MediaBudget::default()), token, range).await
    }

    #[actix_web::test]
    async fn relays_a_range_with_safe_headers() {
        let server = upstream(vec![(
            "/v.mp4",
            raw(
                "206 Partial Content",
                &[
                    ("Content-Type", "video/mp4"),
                    ("Content-Range", "bytes 2-5/10"),
                    ("Content-Length", "4"),
                    ("Accept-Ranges", "bytes"),
                    ("Set-Cookie", "tracking=1"),
                    ("Access-Control-Allow-Origin", "https://evil.example"),
                ],
                b"2345",
            ),
        )]);
        let token = valid_token(&format!("http://media.test:{}/v.mp4", server.port));
        let response = call(&token, Some("bytes=2-5")).await;
        assert_eq!(response.status(), StatusCode::PARTIAL_CONTENT);
        let headers = response.headers().clone();
        assert_eq!(headers.get(header::CONTENT_RANGE).unwrap(), "bytes 2-5/10");
        assert_eq!(headers.get(header::CONTENT_TYPE).unwrap(), "video/mp4");
        assert_eq!(
            headers.get(header::X_CONTENT_TYPE_OPTIONS).unwrap(),
            "nosniff"
        );
        assert_eq!(
            headers.get(header::CONTENT_SECURITY_POLICY).unwrap(),
            MEDIA_CSP
        );
        assert_eq!(
            headers.get(header::CACHE_CONTROL).unwrap(),
            MEDIA_CACHE_CONTROL
        );
        assert!(headers.get(header::SET_COOKIE).is_none());
        assert!(headers.get(header::ACCESS_CONTROL_ALLOW_ORIGIN).is_none());
        assert_eq!(actix_test::read_body(response).await.as_ref(), b"2345");
    }

    #[actix_web::test]
    async fn refuses_an_unsigned_tampered_or_expired_token() {
        let token = sign(
            "another-secret",
            "http://media.test/a.png",
            unix_now() + 3600,
        );
        assert_eq!(call(&token, None).await.status(), StatusCode::NOT_FOUND);
        let expired = sign(SECRET, "http://media.test/a.png", unix_now() - 1);
        assert_eq!(call(&expired, None).await.status(), StatusCode::NOT_FOUND);
        assert_eq!(call("garbage", None).await.status(), StatusCode::NOT_FOUND);
    }

    #[actix_web::test]
    async fn refuses_a_private_destination_and_non_media() {
        let token = valid_token("http://10.0.0.1/a.png");
        assert_eq!(call(&token, None).await.status(), StatusCode::FORBIDDEN);
        let server = upstream(vec![(
            "/page",
            raw(
                "200 OK",
                &[("Content-Type", "text/html"), ("Content-Length", "2")],
                b"hi",
            ),
        )]);
        let token = valid_token(&format!("http://media.test:{}/page", server.port));
        assert_eq!(call(&token, None).await.status(), StatusCode::BAD_GATEWAY);
    }

    #[actix_web::test]
    async fn a_range_the_file_does_not_have_is_not_cached() {
        let server = upstream(vec![(
            "/v.mp4",
            raw(
                "416 Range Not Satisfiable",
                &[("Content-Range", "bytes */10"), ("Content-Length", "0")],
                b"",
            ),
        )]);
        let token = valid_token(&format!("http://media.test:{}/v.mp4", server.port));
        let response = call(&token, Some("bytes=20-30")).await;
        assert_eq!(response.status(), StatusCode::RANGE_NOT_SATISFIABLE);
        assert_eq!(
            response.headers().get(header::CACHE_CONTROL).unwrap(),
            "no-store"
        );
        assert_eq!(
            response.headers().get(header::CONTENT_RANGE).unwrap(),
            "bytes */10"
        );
    }

    #[actix_web::test]
    async fn a_failure_is_not_cached() {
        let token = valid_token("http://10.0.0.1/a.png");
        let response = call(&token, None).await;
        assert_eq!(response.status(), StatusCode::FORBIDDEN);
        assert_eq!(
            response.headers().get(header::CACHE_CONTROL).unwrap(),
            "no-store"
        );
    }

    #[actix_web::test]
    async fn a_file_past_its_relay_budget_gets_429_until_the_window_ends() {
        let body = vec![b'x'; 1024 * 1024];
        let server = upstream(vec![(
            "/big.mp4",
            raw(
                "200 OK",
                &[("Content-Type", "video/mp4"), ("Content-Length", "1048576")],
                &body,
            ),
        )]);
        let token = valid_token(&format!("http://media.test:{}/big.mp4", server.port));
        // Room for one relay of the file, and not a second.
        let service = service_with(MediaBudget::new(BudgetLimits {
            window: Duration::from_secs(600),
            bytes_per_window: 1024 * 1024,
            ..BudgetLimits::default()
        }));
        let first = call_with(service.clone(), &token, None).await;
        assert_eq!(first.status(), StatusCode::OK);
        assert_eq!(actix_test::read_body(first).await.len(), 1024 * 1024);
        let second = call_with(service.clone(), &token, None).await;
        assert_eq!(second.status(), StatusCode::TOO_MANY_REQUESTS);
        assert_eq!(
            second.headers().get(header::CACHE_CONTROL).unwrap(),
            "no-store"
        );
        let retry_after: u64 = second
            .headers()
            .get(header::RETRY_AFTER)
            .unwrap()
            .to_str()
            .unwrap()
            .parse()
            .unwrap();
        assert!((1..=600).contains(&retry_after));
        assert_eq!(server.requests.lock().unwrap().len(), 1);
    }

    #[actix_web::test]
    async fn refuses_a_relay_past_the_ones_running_for_the_url_without_fetching() {
        let server = upstream(vec![(
            "/v.mp4",
            raw(
                "200 OK",
                &[("Content-Type", "video/mp4"), ("Content-Length", "2")],
                b"ok",
            ),
        )]);
        let url = format!("http://media.test:{}/v.mp4", server.port);
        let service = service_with(MediaBudget::new(BudgetLimits {
            max_streams_per_url: 1,
            ..BudgetLimits::default()
        }));
        let running = service.budget.admit(&url, Instant::now()).unwrap();
        let refused = call_with(service.clone(), &valid_token(&url), None).await;
        assert_eq!(refused.status(), StatusCode::TOO_MANY_REQUESTS);
        assert_eq!(refused.headers().get(header::RETRY_AFTER).unwrap(), "1");
        assert!(server.requests.lock().unwrap().is_empty());
        drop(running);
        let admitted = call_with(service.clone(), &valid_token(&url), None).await;
        assert_eq!(admitted.status(), StatusCode::OK);
        assert_eq!(actix_test::read_body(admitted).await.as_ref(), b"ok");
        assert_eq!(service.budget.active_streams(), 0);
    }

    #[actix_web::test]
    async fn ends_a_relay_of_undeclared_length_once_the_budget_runs_out() {
        let body = vec![b'x'; 4 * 1024 * 1024];
        let server = upstream(vec![(
            "/live.webm",
            raw("200 OK", &[("Content-Type", "video/webm")], &body),
        )]);
        let url = format!("http://media.test:{}/live.webm", server.port);
        let service = service_with(MediaBudget::new(BudgetLimits {
            bytes_per_window: 1024 * 1024,
            unknown_length_reservation: 64 * 1024,
            ..BudgetLimits::default()
        }));
        let response = call_with(service.clone(), &valid_token(&url), None).await;
        assert_eq!(response.status(), StatusCode::OK);
        let read = actix_test::try_read_body(response).await;
        assert!(read.is_err() || read.unwrap().len() < body.len());
        assert_eq!(service.budget.active_streams(), 0);
    }
}
