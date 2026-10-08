//! `GET /assets/media/{token}`: relays the external media file a signed token
//! names (see `services::media_proxy`). sceneManager forwards the browser's
//! requests for this path from the engine's public origin, which is the origin
//! a widget frame's Content-Security-Policy allows media from.

use std::io;

use actix_web::body::{BodyStream, SizedStream};
use actix_web::http::StatusCode;
use actix_web::http::header::{self, HeaderValue};
use actix_web::web::{Data, Path, ServiceConfig};
use actix_web::{HttpRequest, HttpResponse, get};
use futures_util::StreamExt;
use tracing::warn;

use crate::services::media_proxy::{
    self, MAX_MEDIA_BYTES, MediaFetcher, MediaResponse, ProxyError, RangeRequest,
};

/// A relayed file is the upstream's, not the engine's: it may change, so it
/// is cached for a while rather than as immutable.
const MEDIA_CACHE_CONTROL: &str = "public, max-age=3600";

/// Served from the engine's origin, a relayed file must never run as a page
/// there: an SVG opened directly would otherwise run its scripts with the
/// scene pages' origin. `sandbox` gives it an opaque origin besides.
const MEDIA_CSP: &str =
    "default-src 'none'; img-src data:; media-src data:; style-src 'unsafe-inline'; sandbox";

pub struct MediaProxyService {
    secret: String,
    fetcher: MediaFetcher,
}

impl MediaProxyService {
    pub fn new(secret: String, fetcher: MediaFetcher) -> Self {
        assert!(
            !secret.is_empty(),
            "the media proxy secret must not be empty"
        );
        Self { secret, fetcher }
    }
}

/// A token that does not verify gets a bare 404, like a missing asset, so the
/// route tells a prober nothing about what it sent.
#[get("/assets/media/{token}")]
#[tracing::instrument(name = "GET /assets/media/{token}", skip_all)]
async fn media_handler(
    service: Data<MediaProxyService>,
    token: Path<String>,
    request: HttpRequest,
) -> HttpResponse {
    let Ok(url) = media_proxy::verify(&service.secret, &token) else {
        return HttpResponse::NotFound().finish();
    };
    let header_text =
        |name: header::HeaderName| request.headers().get(name).and_then(|v| v.to_str().ok());
    let range =
        RangeRequest::from_headers(header_text(header::RANGE), header_text(header::IF_RANGE));
    match service.fetcher.fetch(url.clone(), &range).await {
        Ok(media) => relay(media),
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
                .insert_header((header::CACHE_CONTROL, "no-store"))
                .finish()
        }
    }
}

fn relay(media: MediaResponse) -> HttpResponse {
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
        .insert_header((header::REFERRER_POLICY, "no-referrer"))
        .insert_header((header::CACHE_CONTROL, MEDIA_CACHE_CONTROL));
    if status == StatusCode::RANGE_NOT_SATISFIABLE {
        return response.finish();
    }
    // Counted as it streams too: a declared length was checked already, but
    // an upstream that declared none, or declared too little, is cut off here.
    let mut relayed: u64 = 0;
    let body = media.response.bytes_stream().map(move |chunk| {
        let chunk = chunk.map_err(io::Error::other)?;
        relayed += chunk.len() as u64;
        if relayed > MAX_MEDIA_BYTES {
            return Err(io::Error::other("media larger than the proxy relays"));
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
    use crate::services::media_proxy::sign;
    use crate::services::media_proxy::testing::{local_fetcher, raw, upstream};
    use actix_web::{App, test as actix_test};
    use std::net::{IpAddr, Ipv4Addr};

    const SECRET: &str = "test-barkloader-key";

    async fn call(token: &str, range: Option<&str>) -> actix_web::dev::ServiceResponse {
        let service = MediaProxyService::new(
            SECRET.to_string(),
            local_fetcher(&[("media.test", IpAddr::V4(Ipv4Addr::LOCALHOST))]),
        );
        let app = actix_test::init_service(
            App::new()
                .app_data(Data::new(service))
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
        let token = sign(SECRET, &format!("http://media.test:{}/v.mp4", server.port));
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
    async fn refuses_an_unsigned_or_tampered_token() {
        let token = sign("another-secret", "http://media.test/a.png");
        assert_eq!(call(&token, None).await.status(), StatusCode::NOT_FOUND);
        assert_eq!(call("garbage", None).await.status(), StatusCode::NOT_FOUND);
    }

    #[actix_web::test]
    async fn refuses_a_private_destination_and_non_media() {
        let token = sign(SECRET, "http://10.0.0.1/a.png");
        assert_eq!(call(&token, None).await.status(), StatusCode::FORBIDDEN);
        let server = upstream(vec![(
            "/page",
            raw(
                "200 OK",
                &[("Content-Type", "text/html"), ("Content-Length", "2")],
                b"hi",
            ),
        )]);
        let token = sign(SECRET, &format!("http://media.test:{}/page", server.port));
        assert_eq!(call(&token, None).await.status(), StatusCode::BAD_GATEWAY);
    }
}
