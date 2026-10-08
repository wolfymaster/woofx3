//! The engine's media proxy: fetches an external image, audio or video file
//! that a placement's settings name, so widget frames can load it from the
//! engine's own origin.
//!
//! Themeable widget frames run under a Content-Security-Policy that limits
//! images and media to the engine's origins (sceneManager's
//! `themeContentSecurityPolicy`). Widening that policy would let a theme
//! stylesheet's `url()` reach any host, so external media is relayed through
//! here instead. sceneManager rewrites each external media URL it hands an
//! overlay into `/assets/media/{token}` (sceneManager's `scene/media-proxy.ts`)
//! and relays those requests to this process.
//!
//! This must not become an open proxy or a way into the engine's network:
//!
//! - A token is `{base64url(url)}.{hex HMAC-SHA256}` under a key derived from
//!   the engine secret, so only URLs the engine itself chose are fetched.
//! - Upstream URLs are https only and carry no credentials.
//! - Every address a host resolves to must be public (`is_public_ip`), checked
//!   in the resolver the connection is made from, so the address vetted is
//!   the address connected to. Redirects are followed here, each hop checked
//!   like the first, at most `MAX_REDIRECTS` of them.
//! - Only `image/*`, `audio/*` and `video/*` responses are relayed, up to
//!   `MAX_MEDIA_BYTES`, under connect, response and read timeouts. Nothing of
//!   the browser's request is forwarded except `Range` and `If-Range`.

use std::collections::HashMap;
use std::net::{IpAddr, SocketAddr};
use std::sync::Arc;
use std::time::Duration;

use base64::Engine as _;
use base64::engine::general_purpose::URL_SAFE_NO_PAD;
use hmac::{Hmac, Mac};
use reqwest::header::{self, HeaderMap, HeaderValue};
use sha2::Sha256;
use url::{Host, Url};

type HmacSha256 = Hmac<Sha256>;

/// Separates media proxy signatures from every other use of the engine
/// secret. Must match `KEY_LABEL` in sceneManager/src/scene/media-proxy.ts.
const KEY_LABEL: &str = "woofx3 media proxy v1";

/// Longest upstream URL a token may carry. Must match
/// `MAX_UPSTREAM_URL_BYTES` in sceneManager/src/scene/media-proxy.ts.
pub const MAX_UPSTREAM_URL_BYTES: usize = 2048;

/// The largest file relayed, by its full size rather than one range of it.
/// The same as the largest upload the engine accepts
/// (`MAX_PROXIED_UPLOAD_BYTES`), so a file hosted elsewhere is held to the
/// limit a file in the library is.
pub const MAX_MEDIA_BYTES: u64 = 512 * 1024 * 1024;

const MAX_REDIRECTS: usize = 5;
const CONNECT_TIMEOUT: Duration = Duration::from_secs(5);
/// From sending the request to the upstream's response headers.
const RESPONSE_TIMEOUT: Duration = Duration::from_secs(15);
/// Longest wait for the next bytes of a body. Not a cap on the whole
/// transfer: a long video is streamed for as long as it keeps arriving.
const READ_TIMEOUT: Duration = Duration::from_secs(30);

/// Longest `Range` or `If-Range` value forwarded; real ones are far shorter.
const MAX_RANGE_HEADER_BYTES: usize = 256;

#[derive(Debug, PartialEq, Eq)]
pub enum TokenError {
    Malformed,
    BadSignature,
}

fn media_key(secret: &str) -> Vec<u8> {
    let mut mac =
        HmacSha256::new_from_slice(secret.as_bytes()).expect("HMAC accepts keys of any length");
    mac.update(KEY_LABEL.as_bytes());
    mac.finalize().into_bytes().to_vec()
}

fn signature(key: &[u8], payload: &str) -> String {
    let mut mac = HmacSha256::new_from_slice(key).expect("HMAC accepts keys of any length");
    mac.update(payload.as_bytes());
    mac.finalize()
        .into_bytes()
        .iter()
        .map(|b| format!("{:02x}", b))
        .collect()
}

/// The token for `url`. sceneManager mints these in production; this is the
/// same scheme, for tests and for anything in barkloader that needs one.
#[cfg_attr(not(test), allow(dead_code))]
pub fn sign(secret: &str, url: &str) -> String {
    let payload = URL_SAFE_NO_PAD.encode(url.as_bytes());
    let signature = signature(&media_key(secret), &payload);
    format!("{payload}.{signature}")
}

/// The upstream URL a token authorizes. The signature is checked before the
/// payload is decoded, so a forgery learns nothing about its payload.
pub fn verify(secret: &str, token: &str) -> Result<Url, TokenError> {
    if secret.is_empty() {
        return Err(TokenError::BadSignature);
    }
    let Some((payload, signature_hex)) = token.split_once('.') else {
        return Err(TokenError::Malformed);
    };
    if payload.is_empty() || signature_hex.is_empty() {
        return Err(TokenError::Malformed);
    }
    let expected = signature(&media_key(secret), payload);
    if !constant_time_eq(expected.as_bytes(), signature_hex.as_bytes()) {
        return Err(TokenError::BadSignature);
    }
    let bytes = URL_SAFE_NO_PAD
        .decode(payload)
        .map_err(|_| TokenError::Malformed)?;
    if bytes.len() > MAX_UPSTREAM_URL_BYTES {
        return Err(TokenError::Malformed);
    }
    let text = String::from_utf8(bytes).map_err(|_| TokenError::Malformed)?;
    Url::parse(&text).map_err(|_| TokenError::Malformed)
}

fn constant_time_eq(a: &[u8], b: &[u8]) -> bool {
    if a.len() != b.len() {
        return false;
    }
    let mut diff = 0u8;
    for i in 0..a.len() {
        diff |= a[i] ^ b[i];
    }
    diff == 0
}

/// Whether the proxy may connect to `ip`: a globally routable unicast
/// address. Beyond `lib_sandbox::net::is_restricted_ip` (loopback, private,
/// link-local and so cloud metadata, CGNAT, unique local), this refuses
/// multicast, reserved and documentation ranges, and IPv6 forms that carry an
/// IPv4 address (mapped, compatible, NAT64, 6to4, Teredo) unless that address
/// is public itself.
pub fn is_public_ip(ip: IpAddr) -> bool {
    if lib_sandbox::net::is_restricted_ip(ip) {
        return false;
    }
    match ip {
        IpAddr::V4(v4) => {
            let [a, b, c, _] = v4.octets();
            !(v4.is_multicast()
                || a == 0
                || a >= 240
                || (a == 192 && b == 0 && c == 0)
                || (a == 192 && b == 0 && c == 2)
                || (a == 198 && (b & 0xFE) == 18)
                || (a == 198 && b == 51 && c == 100)
                || (a == 203 && b == 0 && c == 113))
        }
        IpAddr::V6(v6) => {
            let segments = v6.segments();
            if v6.is_multicast() {
                return false;
            }
            let embedded_v4 = |high: u16, low: u16| {
                IpAddr::V4(std::net::Ipv4Addr::new(
                    (high >> 8) as u8,
                    high as u8,
                    (low >> 8) as u8,
                    low as u8,
                ))
            };
            // IPv4-compatible, ::a.b.c.d (deprecated, but still routed by some stacks).
            if segments[..6].iter().all(|s| *s == 0) {
                return is_public_ip(embedded_v4(segments[6], segments[7]));
            }
            // NAT64, 64:ff9b::/96.
            if segments[..6] == [0x64, 0xff9b, 0, 0, 0, 0] {
                return is_public_ip(embedded_v4(segments[6], segments[7]));
            }
            // 6to4, 2002::/16.
            if segments[0] == 0x2002 {
                return is_public_ip(embedded_v4(segments[1], segments[2]));
            }
            // Teredo 2001::/32, and documentation 2001:db8::/32.
            !(segments[0] == 0x2001 && (segments[1] == 0 || segments[1] == 0x0db8))
        }
    }
}

/// Why the proxy refused a destination, carried through reqwest's error
/// chain from the resolver so it can be told apart from a network failure.
#[derive(Debug)]
struct RefusedAddress(String);

impl std::fmt::Display for RefusedAddress {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        f.write_str(&self.0)
    }
}

impl std::error::Error for RefusedAddress {}

/// How host names are resolved: the system resolver, or a fixed table in
/// tests, which have no public host to reach.
#[derive(Clone)]
enum Lookup {
    System,
    #[cfg_attr(not(test), allow(dead_code))]
    Fixed(Arc<HashMap<String, Vec<IpAddr>>>),
}

/// Resolves a host and refuses it when any address it resolves to is not
/// allowed. The connection is made only to the addresses returned here, so a
/// host that answers differently a moment later (DNS rebinding) is not
/// consulted again between the check and the connect.
struct VettedResolver {
    lookup: Lookup,
    ip_allowed: fn(IpAddr) -> bool,
}

impl reqwest::dns::Resolve for VettedResolver {
    fn resolve(&self, name: reqwest::dns::Name) -> reqwest::dns::Resolving {
        let lookup = self.lookup.clone();
        let ip_allowed = self.ip_allowed;
        Box::pin(async move {
            let host = name.as_str().to_string();
            let addrs: Vec<SocketAddr> = match lookup {
                Lookup::System => tokio::net::lookup_host((host.as_str(), 0)).await?.collect(),
                Lookup::Fixed(table) => table
                    .get(&host)
                    .map(|ips| ips.iter().map(|ip| SocketAddr::new(*ip, 0)).collect())
                    .unwrap_or_default(),
            };
            if addrs.is_empty() {
                return Err(Box::new(RefusedAddress(format!("{host} does not resolve")))
                    as Box<dyn std::error::Error + Send + Sync>);
            }
            if let Some(addr) = addrs.iter().find(|addr| !ip_allowed(addr.ip())) {
                return Err(Box::new(RefusedAddress(format!(
                    "{host} resolves to a non-public address {}",
                    addr.ip()
                )))
                    as Box<dyn std::error::Error + Send + Sync>);
            }
            let addrs: reqwest::dns::Addrs = Box::new(addrs.into_iter());
            Ok(addrs)
        })
    }
}

#[derive(Debug, PartialEq, Eq)]
pub enum ProxyError {
    /// The URL, or an address or redirect on the way, is not one the proxy
    /// may reach.
    Refused(String),
    /// The upstream could not be reached or did not answer in time.
    Unreachable(String),
    /// The upstream answered with a status the proxy does not relay.
    Status(u16),
    /// The upstream's response is not an image, audio or video file.
    NotMedia(String),
    /// The file is larger than `MAX_MEDIA_BYTES`.
    TooLarge,
}

impl std::fmt::Display for ProxyError {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        match self {
            ProxyError::Refused(reason) => write!(f, "refused: {reason}"),
            ProxyError::Unreachable(reason) => write!(f, "unreachable: {reason}"),
            ProxyError::Status(status) => write!(f, "upstream answered {status}"),
            ProxyError::NotMedia(reason) => write!(f, "not media: {reason}"),
            ProxyError::TooLarge => write!(f, "larger than {MAX_MEDIA_BYTES} bytes"),
        }
    }
}

/// What the browser asked for, of the file: the only request headers relayed.
#[derive(Debug, Default, Clone)]
pub struct RangeRequest {
    pub range: Option<String>,
    pub if_range: Option<String>,
}

impl RangeRequest {
    /// The forwardable range headers of a request. A value that is not a
    /// plain byte range is dropped, which asks the upstream for the whole
    /// file, as a browser would get from a server without range support.
    pub fn from_headers(range: Option<&str>, if_range: Option<&str>) -> Self {
        let plain = |v: &str| {
            v.len() <= MAX_RANGE_HEADER_BYTES && v.bytes().all(|b| (0x20..0x7f).contains(&b))
        };
        Self {
            range: range
                .filter(|v| plain(v) && v.starts_with("bytes="))
                .map(str::to_string),
            if_range: if_range.filter(|v| plain(v)).map(str::to_string),
        }
    }
}

/// An upstream response the proxy will relay: a 200 or 206 media file, or a
/// 416 for a range the file does not have.
pub struct MediaResponse {
    pub status: u16,
    /// Response headers to relay as they came, already checked.
    pub headers: Vec<(header::HeaderName, String)>,
    /// The body's length when the upstream declared it.
    pub content_length: Option<u64>,
    pub response: reqwest::Response,
}

/// The headers relayed from a media response, when present.
const RELAYED_HEADERS: [header::HeaderName; 5] = [
    header::CONTENT_TYPE,
    header::CONTENT_RANGE,
    header::ACCEPT_RANGES,
    header::ETAG,
    header::LAST_MODIFIED,
];

pub struct MediaFetcher {
    client: reqwest::Client,
    schemes: &'static [&'static str],
    ip_allowed: fn(IpAddr) -> bool,
}

impl MediaFetcher {
    /// The production fetcher: https only, public addresses only, the system
    /// resolver.
    pub fn new() -> Self {
        Self::with(Lookup::System, &["https"], is_public_ip)
    }

    fn with(
        lookup: Lookup,
        schemes: &'static [&'static str],
        ip_allowed: fn(IpAddr) -> bool,
    ) -> Self {
        let client = reqwest::Client::builder()
            // Followed in `fetch`, so each hop is checked like the first.
            .redirect(reqwest::redirect::Policy::none())
            .dns_resolver(Arc::new(VettedResolver { lookup, ip_allowed }))
            .connect_timeout(CONNECT_TIMEOUT)
            .read_timeout(READ_TIMEOUT)
            // A proxy configured in the environment would connect on the
            // proxy's behalf, to addresses this resolver never vetted.
            .no_proxy()
            .build()
            .expect("reqwest client with a custom resolver always builds");
        Self {
            client,
            schemes,
            ip_allowed,
        }
    }

    /// Why the proxy may not fetch `url` itself, before anything is resolved:
    /// its scheme, credentials in it, or a literal address that is not public.
    /// A host name is vetted when it resolves (`VettedResolver`).
    fn refusal(&self, url: &Url) -> Option<String> {
        if !self.schemes.contains(&url.scheme()) {
            return Some(format!("scheme {} is not allowed", url.scheme()));
        }
        if !url.username().is_empty() || url.password().is_some() {
            return Some("URLs with credentials are not fetched".to_string());
        }
        match url.host() {
            None => Some("no host".to_string()),
            Some(Host::Ipv4(ip)) if !(self.ip_allowed)(IpAddr::V4(ip)) => {
                Some(format!("{ip} is not a public address"))
            }
            Some(Host::Ipv6(ip)) if !(self.ip_allowed)(IpAddr::V6(ip)) => {
                Some(format!("{ip} is not a public address"))
            }
            Some(_) => None,
        }
    }

    /// Fetch `url` for relaying, following redirects and checking everything
    /// the module docs list before any of the body is read.
    pub async fn fetch(&self, url: Url, range: &RangeRequest) -> Result<MediaResponse, ProxyError> {
        let response = self.follow(url, range).await?;
        let status = response.status().as_u16();
        if status == 416 {
            let headers = relayed_headers(response.headers(), &[header::CONTENT_RANGE]);
            return Ok(MediaResponse {
                status,
                headers,
                content_length: Some(0),
                response,
            });
        }
        if status != 200 && status != 206 {
            return Err(ProxyError::Status(status));
        }
        check_media(response.headers(), status)?;
        Ok(MediaResponse {
            status,
            headers: relayed_headers(response.headers(), &RELAYED_HEADERS),
            content_length: response.content_length(),
            response,
        })
    }

    async fn follow(
        &self,
        mut url: Url,
        range: &RangeRequest,
    ) -> Result<reqwest::Response, ProxyError> {
        for _ in 0..=MAX_REDIRECTS {
            if let Some(reason) = self.refusal(&url) {
                return Err(ProxyError::Refused(reason));
            }
            let mut request = self
                .client
                .get(url.clone())
                .header(header::USER_AGENT, "woofx3-media-proxy")
                .header(header::ACCEPT, "image/*, audio/*, video/*");
            if let Some(value) = &range.range {
                request = request.header(header::RANGE, value);
            }
            if let Some(value) = &range.if_range {
                request = request.header(header::IF_RANGE, value);
            }
            let response = match tokio::time::timeout(RESPONSE_TIMEOUT, request.send()).await {
                Err(_) => return Err(ProxyError::Unreachable("no response in time".to_string())),
                Ok(Err(e)) => return Err(classify(&e)),
                Ok(Ok(response)) => response,
            };
            if !response.status().is_redirection() {
                return Ok(response);
            }
            let location = response
                .headers()
                .get(header::LOCATION)
                .and_then(|value| value.to_str().ok())
                .ok_or(ProxyError::Status(response.status().as_u16()))?;
            url = url.join(location).map_err(|_| {
                ProxyError::Refused(format!("redirect to an invalid location {location:?}"))
            })?;
        }
        Err(ProxyError::Refused(format!(
            "more than {MAX_REDIRECTS} redirects"
        )))
    }
}

/// A refusal from the resolver, when that is why the request failed.
fn classify(error: &reqwest::Error) -> ProxyError {
    let mut source: Option<&(dyn std::error::Error + 'static)> = Some(error);
    while let Some(current) = source {
        if let Some(refused) = current.downcast_ref::<RefusedAddress>() {
            return ProxyError::Refused(refused.0.clone());
        }
        source = current.source();
    }
    ProxyError::Unreachable(error.to_string())
}

fn relayed_headers(
    headers: &HeaderMap,
    names: &[header::HeaderName],
) -> Vec<(header::HeaderName, String)> {
    names
        .iter()
        .filter_map(|name| {
            headers
                .get(name)
                .and_then(|value| value.to_str().ok())
                .map(|value| (name.clone(), value.to_string()))
        })
        .collect()
}

/// The media kind of a `Content-Type`, when it is one the proxy relays.
pub fn media_content_type(value: &HeaderValue) -> Option<String> {
    let essence = value
        .to_str()
        .ok()?
        .split(';')
        .next()?
        .trim()
        .to_ascii_lowercase();
    let (kind, subtype) = essence.split_once('/')?;
    let token = |s: &str| {
        !s.is_empty()
            && s.bytes()
                .all(|b| b.is_ascii_alphanumeric() || b"!#$&-^_.+".contains(&b))
    };
    (matches!(kind, "image" | "audio" | "video") && token(subtype)).then_some(essence)
}

/// The full size of the file a response is (part of), when it says.
fn full_size(headers: &HeaderMap, status: u16) -> Option<u64> {
    if status == 206 {
        let range = headers.get(header::CONTENT_RANGE)?.to_str().ok()?;
        return range.rsplit_once('/')?.1.trim().parse().ok();
    }
    headers
        .get(header::CONTENT_LENGTH)?
        .to_str()
        .ok()?
        .trim()
        .parse()
        .ok()
}

fn check_media(headers: &HeaderMap, status: u16) -> Result<(), ProxyError> {
    let content_type = headers
        .get(header::CONTENT_TYPE)
        .ok_or_else(|| ProxyError::NotMedia("no Content-Type".to_string()))?;
    if media_content_type(content_type).is_none() {
        return Err(ProxyError::NotMedia(format!(
            "Content-Type {:?}",
            content_type.to_str().unwrap_or("")
        )));
    }
    // The body is relayed byte for byte, without the upstream's encoding
    // header, so an encoded body would arrive as garbage.
    if let Some(encoding) = headers.get(header::CONTENT_ENCODING)
        && !encoding.as_bytes().eq_ignore_ascii_case(b"identity")
    {
        return Err(ProxyError::NotMedia("encoded body".to_string()));
    }
    if full_size(headers, status).is_some_and(|size| size > MAX_MEDIA_BYTES) {
        return Err(ProxyError::TooLarge);
    }
    Ok(())
}

#[cfg(test)]
pub(crate) mod testing {
    use super::*;
    use std::io::{BufRead, BufReader, Write};
    use std::net::{Ipv4Addr, TcpListener};
    use std::sync::Mutex;

    /// A fetcher for tests against a local server: plain http allowed, and
    /// 127.0.0.1 treated as the one public address, so everything else
    /// (other loopback addresses, private ranges) is still refused.
    pub fn local_fetcher(hosts: &[(&str, IpAddr)]) -> MediaFetcher {
        let mut table: HashMap<String, Vec<IpAddr>> = HashMap::new();
        for (host, ip) in hosts {
            table.entry(host.to_string()).or_default().push(*ip);
        }
        MediaFetcher::with(Lookup::Fixed(Arc::new(table)), &["http", "https"], |ip| {
            ip == IpAddr::V4(Ipv4Addr::LOCALHOST)
        })
    }

    /// A canned upstream: each request's path picks a raw response, and the
    /// request lines are kept for assertions.
    pub(crate) struct Upstream {
        pub port: u16,
        pub requests: Arc<Mutex<Vec<String>>>,
    }

    pub(crate) fn upstream(routes: Vec<(&'static str, Vec<u8>)>) -> Upstream {
        let listener = TcpListener::bind("127.0.0.1:0").unwrap();
        let port = listener.local_addr().unwrap().port();
        let requests = Arc::new(Mutex::new(Vec::new()));
        let seen = requests.clone();
        let routes: HashMap<&'static str, Vec<u8>> = routes.into_iter().collect();
        std::thread::spawn(move || {
            for stream in listener.incoming() {
                let Ok(mut stream) = stream else {
                    continue;
                };
                let mut reader = BufReader::new(stream.try_clone().unwrap());
                let mut head = String::new();
                loop {
                    let mut line = String::new();
                    if reader.read_line(&mut line).unwrap_or(0) == 0 || line == "\r\n" {
                        break;
                    }
                    head.push_str(&line);
                }
                let path = head.split_whitespace().nth(1).unwrap_or("").to_string();
                seen.lock().unwrap().push(head);
                let response = routes.get(path.as_str()).cloned().unwrap_or_else(|| {
                    b"HTTP/1.1 404 Not Found\r\nContent-Length: 0\r\nConnection: close\r\n\r\n"
                        .to_vec()
                });
                let _ = stream.write_all(&response);
            }
        });
        Upstream { port, requests }
    }

    pub(crate) fn raw(status: &str, headers: &[(&str, &str)], body: &[u8]) -> Vec<u8> {
        let mut out = format!("HTTP/1.1 {status}\r\nConnection: close\r\n");
        for (name, value) in headers {
            out.push_str(&format!("{name}: {value}\r\n"));
        }
        out.push_str("\r\n");
        let mut bytes = out.into_bytes();
        bytes.extend_from_slice(body);
        bytes
    }
}

#[cfg(test)]
mod tests {
    use super::testing::{local_fetcher, raw, upstream};
    use super::*;
    use std::net::{Ipv4Addr, Ipv6Addr};

    const SECRET: &str = "test-barkloader-key";
    const EXTERNAL: &str = "https://media.example.com/clips/a.png";
    /// Also asserted by sceneManager's media-proxy tests, so the two agree.
    const EXTERNAL_TOKEN: &str = "aHR0cHM6Ly9tZWRpYS5leGFtcGxlLmNvbS9jbGlwcy9hLnBuZw.b8c7827a7687f452745b50c64e12054167aa6a4a06c7925cd16c1db79b0ca33c";

    #[test]
    fn signs_the_same_token_as_scene_manager() {
        assert_eq!(sign(SECRET, EXTERNAL), EXTERNAL_TOKEN);
        assert_eq!(verify(SECRET, EXTERNAL_TOKEN).unwrap().as_str(), EXTERNAL);
    }

    #[test]
    fn refuses_unsigned_and_tampered_tokens() {
        assert_eq!(
            verify("another-secret", EXTERNAL_TOKEN),
            Err(TokenError::BadSignature)
        );
        let (_, signature) = EXTERNAL_TOKEN.split_once('.').unwrap();
        let forged = format!(
            "{}.{signature}",
            URL_SAFE_NO_PAD.encode("https://169.254.169.254/latest/meta-data")
        );
        assert_eq!(verify(SECRET, &forged), Err(TokenError::BadSignature));
        let mut flipped = EXTERNAL_TOKEN.to_string();
        flipped.pop();
        flipped.push('0');
        assert_eq!(verify(SECRET, &flipped), Err(TokenError::BadSignature));
        assert_eq!(verify(SECRET, "no-dot"), Err(TokenError::Malformed));
        assert_eq!(verify(SECRET, ".sig"), Err(TokenError::Malformed));
        assert_eq!(verify(SECRET, "payload."), Err(TokenError::Malformed));
        assert_eq!(
            verify("", &sign("", EXTERNAL)),
            Err(TokenError::BadSignature)
        );
    }

    #[test]
    fn refuses_an_overlong_signed_url() {
        let long = format!(
            "https://media.example.com/{}",
            "a".repeat(MAX_UPSTREAM_URL_BYTES)
        );
        assert_eq!(
            verify(SECRET, &sign(SECRET, &long)),
            Err(TokenError::Malformed)
        );
    }

    #[test]
    fn only_public_addresses_are_allowed() {
        let refused: [IpAddr; 22] = [
            Ipv4Addr::new(127, 0, 0, 1).into(),
            Ipv4Addr::new(10, 1, 2, 3).into(),
            Ipv4Addr::new(172, 16, 0, 1).into(),
            Ipv4Addr::new(192, 168, 1, 1).into(),
            Ipv4Addr::new(169, 254, 169, 254).into(),
            Ipv4Addr::new(100, 100, 100, 200).into(),
            Ipv4Addr::new(0, 0, 0, 0).into(),
            Ipv4Addr::new(0, 1, 2, 3).into(),
            Ipv4Addr::new(224, 0, 0, 1).into(),
            Ipv4Addr::new(240, 0, 0, 1).into(),
            Ipv4Addr::new(255, 255, 255, 255).into(),
            Ipv4Addr::new(192, 0, 0, 170).into(),
            Ipv4Addr::new(198, 18, 0, 1).into(),
            Ipv6Addr::LOCALHOST.into(),
            "fd00:ec2::254".parse::<Ipv6Addr>().unwrap().into(),
            "fe80::1".parse::<Ipv6Addr>().unwrap().into(),
            "ff02::1".parse::<Ipv6Addr>().unwrap().into(),
            "::ffff:10.0.0.1".parse::<Ipv6Addr>().unwrap().into(),
            "::10.0.0.1".parse::<Ipv6Addr>().unwrap().into(),
            "64:ff9b::a9fe:a9fe".parse::<Ipv6Addr>().unwrap().into(),
            "2002:7f00:1::".parse::<Ipv6Addr>().unwrap().into(),
            "2001::1".parse::<Ipv6Addr>().unwrap().into(),
        ];
        for ip in refused {
            assert!(!is_public_ip(ip), "{ip} must be refused");
        }
        let allowed: [IpAddr; 4] = [
            Ipv4Addr::new(93, 184, 216, 34).into(),
            Ipv4Addr::new(1, 1, 1, 1).into(),
            "2606:4700:4700::1111".parse::<Ipv6Addr>().unwrap().into(),
            "2002:5db8:d822::".parse::<Ipv6Addr>().unwrap().into(),
        ];
        for ip in allowed {
            assert!(is_public_ip(ip), "{ip} must be allowed");
        }
    }

    #[test]
    fn plain_range_headers_are_forwarded_and_others_dropped() {
        let ok = RangeRequest::from_headers(Some("bytes=0-99"), Some("\"etag\""));
        assert_eq!(ok.range.as_deref(), Some("bytes=0-99"));
        assert_eq!(ok.if_range.as_deref(), Some("\"etag\""));
        let odd = RangeRequest::from_headers(Some("items=0-1"), Some("a\nb"));
        assert!(odd.range.is_none() && odd.if_range.is_none());
    }

    #[test]
    fn media_content_types_only() {
        let kind = |v: &str| media_content_type(&HeaderValue::from_str(v).unwrap());
        assert_eq!(kind("image/png").as_deref(), Some("image/png"));
        assert_eq!(kind("Audio/MPEG; charset=x").as_deref(), Some("audio/mpeg"));
        assert_eq!(kind("video/mp4").as_deref(), Some("video/mp4"));
        assert_eq!(kind("text/html"), None);
        assert_eq!(kind("application/octet-stream"), None);
        assert_eq!(kind("image/"), None);
        assert_eq!(kind("image"), None);
    }

    #[tokio::test]
    async fn the_production_fetcher_refuses_before_connecting() {
        let fetcher = MediaFetcher::new();
        let none = RangeRequest::default();
        let refused =
            |r: Result<MediaResponse, ProxyError>| matches!(r, Err(ProxyError::Refused(_)));
        assert!(refused(
            fetcher
                .fetch(Url::parse("http://example.com/a.png").unwrap(), &none)
                .await
        ));
        assert!(refused(
            fetcher
                .fetch(Url::parse("https://127.0.0.1/a.png").unwrap(), &none)
                .await
        ));
        assert!(refused(
            fetcher
                .fetch(Url::parse("https://[::1]/a.png").unwrap(), &none)
                .await
        ));
        assert!(refused(
            fetcher
                .fetch(Url::parse("https://169.254.169.254/").unwrap(), &none)
                .await
        ));
        assert!(refused(
            fetcher
                .fetch(Url::parse("https://0x7f.1/a.png").unwrap(), &none)
                .await
        ));
        assert!(refused(
            fetcher
                .fetch(Url::parse("https://u:p@example.com/a.png").unwrap(), &none)
                .await
        ));
        assert!(refused(
            fetcher
                .fetch(Url::parse("https://localhost/a.png").unwrap(), &none)
                .await
        ));
    }

    fn at(port: u16, host: &str, path: &str) -> Url {
        Url::parse(&format!("http://{host}:{port}{path}")).unwrap()
    }

    const LOCAL: IpAddr = IpAddr::V4(Ipv4Addr::LOCALHOST);
    const PRIVATE: IpAddr = IpAddr::V4(Ipv4Addr::new(10, 0, 0, 1));

    #[tokio::test]
    async fn relays_a_media_file() {
        let server = upstream(vec![(
            "/a.png",
            raw(
                "200 OK",
                &[
                    ("Content-Type", "image/png"),
                    ("Content-Length", "4"),
                    ("Set-Cookie", "a=b"),
                ],
                b"\x89PNG",
            ),
        )]);
        let fetcher = local_fetcher(&[("media.test", LOCAL)]);
        let media = fetcher
            .fetch(
                at(server.port, "media.test", "/a.png"),
                &RangeRequest::default(),
            )
            .await
            .unwrap();
        assert_eq!(media.status, 200);
        assert_eq!(media.content_length, Some(4));
        assert!(
            media
                .headers
                .iter()
                .all(|(name, _)| name != header::SET_COOKIE)
        );
        assert_eq!(media.response.bytes().await.unwrap().as_ref(), b"\x89PNG");
        let request = server.requests.lock().unwrap()[0].to_ascii_lowercase();
        assert!(!request.contains("cookie") && !request.contains("authorization"));
    }

    #[tokio::test]
    async fn forwards_a_range_and_relays_the_partial_response() {
        let server = upstream(vec![(
            "/v.mp4",
            raw(
                "206 Partial Content",
                &[
                    ("Content-Type", "video/mp4"),
                    ("Content-Range", "bytes 10-13/100"),
                    ("Content-Length", "4"),
                    ("Accept-Ranges", "bytes"),
                ],
                b"abcd",
            ),
        )]);
        let fetcher = local_fetcher(&[("media.test", LOCAL)]);
        let range = RangeRequest::from_headers(Some("bytes=10-13"), None);
        let media = fetcher
            .fetch(at(server.port, "media.test", "/v.mp4"), &range)
            .await
            .unwrap();
        assert_eq!(media.status, 206);
        assert!(
            media
                .headers
                .contains(&(header::CONTENT_RANGE, "bytes 10-13/100".to_string()))
        );
        assert!(
            server.requests.lock().unwrap()[0]
                .to_ascii_lowercase()
                .contains("range: bytes=10-13")
        );
    }

    #[tokio::test]
    async fn refuses_what_is_not_media_or_is_too_large() {
        let too_large = (MAX_MEDIA_BYTES + 1).to_string();
        let too_large_range = format!("bytes 0-0/{}", MAX_MEDIA_BYTES + 1);
        let server = upstream(vec![
            (
                "/page",
                raw(
                    "200 OK",
                    &[("Content-Type", "text/html"), ("Content-Length", "0")],
                    b"",
                ),
            ),
            ("/untyped", raw("200 OK", &[("Content-Length", "0")], b"")),
            (
                "/big",
                raw(
                    "200 OK",
                    &[
                        ("Content-Type", "video/mp4"),
                        ("Content-Length", too_large.as_str()),
                    ],
                    b"",
                ),
            ),
            (
                "/big-range",
                raw(
                    "206 Partial Content",
                    &[
                        ("Content-Type", "video/mp4"),
                        ("Content-Range", too_large_range.as_str()),
                        ("Content-Length", "1"),
                    ],
                    b"a",
                ),
            ),
            (
                "/missing",
                raw("404 Not Found", &[("Content-Length", "0")], b""),
            ),
        ]);
        let fetcher = local_fetcher(&[("media.test", LOCAL)]);
        let none = RangeRequest::default();
        let get = |path: &'static str| fetcher.fetch(at(server.port, "media.test", path), &none);
        assert!(matches!(get("/page").await, Err(ProxyError::NotMedia(_))));
        assert!(matches!(
            get("/untyped").await,
            Err(ProxyError::NotMedia(_))
        ));
        assert!(matches!(get("/big").await, Err(ProxyError::TooLarge)));
        assert!(matches!(get("/big-range").await, Err(ProxyError::TooLarge)));
        assert!(matches!(
            get("/missing").await,
            Err(ProxyError::Status(404))
        ));
    }

    #[tokio::test]
    async fn refuses_a_host_that_resolves_to_a_private_address() {
        let fetcher = local_fetcher(&[
            ("private.test", PRIVATE),
            ("mixed.test", LOCAL),
            ("mixed.test", PRIVATE),
        ]);
        let none = RangeRequest::default();
        for host in ["private.test", "mixed.test", "unknown.test"] {
            let result = fetcher.fetch(at(80, host, "/a.png"), &none).await;
            assert!(matches!(result, Err(ProxyError::Refused(_))), "{host}");
        }
    }

    #[tokio::test]
    async fn checks_every_redirect_hop() {
        let server = upstream(vec![
            (
                "/to-private-name",
                raw(
                    "302 Found",
                    &[
                        ("Location", "http://private.test/a.png"),
                        ("Content-Length", "0"),
                    ],
                    b"",
                ),
            ),
            (
                "/to-private-ip",
                raw(
                    "302 Found",
                    &[
                        ("Location", "http://10.0.0.1/a.png"),
                        ("Content-Length", "0"),
                    ],
                    b"",
                ),
            ),
            (
                "/to-loopback",
                raw(
                    "301 Moved",
                    &[
                        ("Location", "http://127.0.0.2/a.png"),
                        ("Content-Length", "0"),
                    ],
                    b"",
                ),
            ),
            (
                "/to-file",
                raw(
                    "302 Found",
                    &[("Location", "file:///etc/passwd"), ("Content-Length", "0")],
                    b"",
                ),
            ),
            (
                "/loop",
                raw(
                    "302 Found",
                    &[("Location", "/loop"), ("Content-Length", "0")],
                    b"",
                ),
            ),
            (
                "/hop",
                raw(
                    "302 Found",
                    &[("Location", "/a.png"), ("Content-Length", "0")],
                    b"",
                ),
            ),
            (
                "/a.png",
                raw(
                    "200 OK",
                    &[("Content-Type", "image/png"), ("Content-Length", "1")],
                    b"x",
                ),
            ),
        ]);
        let fetcher = local_fetcher(&[("media.test", LOCAL), ("private.test", PRIVATE)]);
        let none = RangeRequest::default();
        for path in [
            "/to-private-name",
            "/to-private-ip",
            "/to-loopback",
            "/to-file",
            "/loop",
        ] {
            let result = fetcher
                .fetch(at(server.port, "media.test", path), &none)
                .await;
            assert!(matches!(result, Err(ProxyError::Refused(_))), "{path}");
        }
        let media = fetcher
            .fetch(at(server.port, "media.test", "/hop"), &none)
            .await
            .unwrap();
        assert_eq!(media.status, 200);
    }
}
