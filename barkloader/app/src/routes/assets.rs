use actix_web::web::{Data, Path, ServiceConfig};
use actix_web::{HttpResponse, get};
use lib_repository::{Repository, RepositoryImpl};

/// Serve module files straight from the repository (file/S3 agnostic).
/// Keys mirror repository keys exactly, e.g.
/// `GET /assets/modules/{module_key}/widgets/{widget_id}/{entry}`.
///
/// Every rejection — traversal attempt, bad prefix, missing file — is a
/// uniform 404 with no detail, so callers cannot probe the key space.
#[get("/assets/{key:.*}")]
async fn assets_handler(repository: Data<RepositoryImpl>, path: Path<String>) -> HttpResponse {
    let raw = path.into_inner();
    let Some(key) = sanitize_asset_key(&raw) else {
        return not_found();
    };
    match repository.read_file(&key).await {
        Ok(bytes) => HttpResponse::Ok()
            .content_type(content_type_for_key(&key))
            .body(bytes),
        Err(_) => not_found(),
    }
}

fn not_found() -> HttpResponse {
    HttpResponse::NotFound().finish()
}

/// Traversal pipeline (design 5.2.9 — order is load-bearing):
/// percent-decode, then canonicalize path segments, then reject any
/// `.`/`..` segment or backslash, then require the `modules/` prefix.
/// Returns the canonical repository key, or `None` to reject.
fn sanitize_asset_key(raw: &str) -> Option<String> {
    let decoded = percent_decode(raw)?;
    if decoded.contains('\\') {
        return None;
    }
    // Canonicalize: drop empty segments (collapses duplicate slashes and
    // leading/trailing slashes). `..` is rejected, never resolved.
    let segments: Vec<&str> = decoded.split('/').filter(|s| !s.is_empty()).collect();
    if segments.is_empty() {
        return None;
    }
    for segment in &segments {
        if *segment == "." || *segment == ".." {
            return None;
        }
    }
    let key = segments.join("/");
    if !key.starts_with("modules/") {
        return None;
    }
    Some(key)
}

/// Strict percent-decoding: `%` must be followed by exactly two hex
/// digits and the decoded bytes must form valid UTF-8 — anything else
/// rejects the whole key. Done here regardless of what the framework
/// already decoded; double-decoding only ever makes rejection stricter.
fn percent_decode(input: &str) -> Option<String> {
    let bytes = input.as_bytes();
    let mut out: Vec<u8> = Vec::with_capacity(bytes.len());
    let mut i = 0;
    while i < bytes.len() {
        if bytes[i] == b'%' {
            let hi = hex_value(*bytes.get(i + 1)?)?;
            let lo = hex_value(*bytes.get(i + 2)?)?;
            out.push(hi * 16 + lo);
            i += 3;
        } else {
            out.push(bytes[i]);
            i += 1;
        }
    }
    String::from_utf8(out).ok()
}

fn hex_value(b: u8) -> Option<u8> {
    match b {
        b'0'..=b'9' => Some(b - b'0'),
        b'a'..=b'f' => Some(b - b'a' + 10),
        b'A'..=b'F' => Some(b - b'A' + 10),
        _ => None,
    }
}

fn content_type_for_key(key: &str) -> &'static str {
    let extension = std::path::Path::new(key)
        .extension()
        .and_then(|e| e.to_str())
        .map(|e| e.to_ascii_lowercase())
        .unwrap_or_default();
    match extension.as_str() {
        "html" => "text/html; charset=utf-8",
        "js" => "application/javascript; charset=utf-8",
        "css" => "text/css; charset=utf-8",
        "json" => "application/json",
        "png" => "image/png",
        "jpg" | "jpeg" => "image/jpeg",
        "gif" => "image/gif",
        "svg" => "image/svg+xml",
        "webp" => "image/webp",
        "mp3" => "audio/mpeg",
        "mp4" => "video/mp4",
        "woff" => "font/woff",
        "woff2" => "font/woff2",
        "wasm" => "application/wasm",
        _ => "application/octet-stream",
    }
}

pub fn configure(cfg: &mut ServiceConfig) {
    cfg.service(assets_handler);
}

#[cfg(test)]
mod tests {
    use super::*;
    // Aliased so `#[test]` keeps resolving to the built-in attribute
    // for the sync tests below.
    use actix_web::App;
    use actix_web::test as actix_test;
    use lib_repository::{CreateFileRequest, FileRepository, FileRepositoryConfig};

    #[test]
    fn sanitize_rejects_traversal_and_bad_prefixes() {
        // Plain traversal and current-dir segments.
        assert_eq!(sanitize_asset_key("modules/../etc/passwd"), None);
        assert_eq!(sanitize_asset_key("modules/./x.js"), None);
        assert_eq!(sanitize_asset_key("../modules/x.js"), None);
        // Encoded traversal: %2e%2e, %2e%2e%2f, and backslash %5c forms.
        assert_eq!(sanitize_asset_key("modules/%2e%2e/secret"), None);
        assert_eq!(sanitize_asset_key("%2e%2e%2fmodules/x.js"), None);
        assert_eq!(sanitize_asset_key("modules/..%5cx.js"), None);
        assert_eq!(sanitize_asset_key("modules\\x.js"), None);
        // Double-encoded sequences decode exactly one level here; the
        // result is a literal (nonexistent) filename, never a traversal
        // segment — `..` can only emerge from a single decode, which is
        // rejected above.
        assert_eq!(
            sanitize_asset_key("modules/%252e%252e/x").as_deref(),
            Some("modules/%2e%2e/x")
        );
        // Malformed percent sequences reject outright.
        assert_eq!(sanitize_asset_key("modules/%zz/x"), None);
        assert_eq!(sanitize_asset_key("modules/x%2"), None);
        // Prefix enforcement: only modules/ keys are servable.
        assert_eq!(sanitize_asset_key("archives/m.zip"), None);
        assert_eq!(sanitize_asset_key("modules"), None);
        assert_eq!(sanitize_asset_key(""), None);
    }

    #[test]
    fn sanitize_canonicalizes_valid_keys() {
        assert_eq!(
            sanitize_asset_key("modules/m1/widgets/w1/index.html").as_deref(),
            Some("modules/m1/widgets/w1/index.html")
        );
        // Duplicate and leading slashes collapse to the canonical key.
        assert_eq!(
            sanitize_asset_key("/modules//m1//app.js").as_deref(),
            Some("modules/m1/app.js")
        );
        // Percent-encoded benign characters decode normally.
        assert_eq!(
            sanitize_asset_key("modules/m1/my%20file.png").as_deref(),
            Some("modules/m1/my file.png")
        );
    }

    #[test]
    fn content_type_covers_known_extensions() {
        let cases = [
            ("a.html", "text/html; charset=utf-8"),
            ("a.js", "application/javascript; charset=utf-8"),
            ("a.css", "text/css; charset=utf-8"),
            ("a.json", "application/json"),
            ("a.png", "image/png"),
            ("a.jpg", "image/jpeg"),
            ("a.JPEG", "image/jpeg"),
            ("a.gif", "image/gif"),
            ("a.svg", "image/svg+xml"),
            ("a.webp", "image/webp"),
            ("a.mp3", "audio/mpeg"),
            ("a.mp4", "video/mp4"),
            ("a.woff", "font/woff"),
            ("a.woff2", "font/woff2"),
            ("a.wasm", "application/wasm"),
            ("a.bin", "application/octet-stream"),
            ("noext", "application/octet-stream"),
        ];
        for (name, expected) in cases {
            assert_eq!(content_type_for_key(name), expected, "extension of {name}");
        }
    }

    async fn file_backed_repo(dir: &std::path::Path) -> RepositoryImpl {
        let repo = FileRepository::new(FileRepositoryConfig {
            destination: dir.to_path_buf(),
        });
        repo.setup().expect("repo setup");
        RepositoryImpl::File(repo)
    }

    async fn seed(repo: &RepositoryImpl, key: &str, contents: &[u8]) {
        let ext = std::path::Path::new(key)
            .extension()
            .and_then(|e| e.to_str())
            .unwrap_or("bin")
            .to_string();
        let mut failed = Vec::new();
        repo.create(
            [CreateFileRequest {
                content: Some(contents.to_vec()),
                extension: Some(ext),
                file_name: key.to_string(),
            }],
            &mut failed,
        )
        .await
        .expect("seed file");
        assert!(failed.is_empty(), "seed write failed for {key}");
    }

    #[actix_web::test]
    async fn get_round_trips_file_from_repository() {
        let dir = tempfile::tempdir().expect("tempdir");
        let repo = file_backed_repo(dir.path()).await;
        seed(&repo, "modules/m1/widgets/w1/index.html", b"<!doctype html>").await;

        let app = actix_test::init_service(
            App::new().app_data(Data::new(repo)).configure(configure),
        )
        .await;

        let req = actix_test::TestRequest::get()
            .uri("/assets/modules/m1/widgets/w1/index.html")
            .to_request();
        let resp = actix_test::call_service(&app, req).await;
        assert_eq!(resp.status(), 200);
        assert_eq!(
            resp.headers().get("content-type").unwrap(),
            "text/html; charset=utf-8"
        );
        let body = actix_test::read_body(resp).await;
        assert_eq!(&body[..], b"<!doctype html>");
    }

    #[actix_web::test]
    async fn get_returns_404_uniformly() {
        let dir = tempfile::tempdir().expect("tempdir");
        let repo = file_backed_repo(dir.path()).await;
        seed(&repo, "modules/m1/secret.js", b"let x = 1;").await;
        // A file outside modules/ exists in the store but must never be
        // reachable through this route.
        seed(&repo, "archives/m1.zip", b"zipbytes").await;

        let app = actix_test::init_service(
            App::new().app_data(Data::new(repo)).configure(configure),
        )
        .await;

        let cases = [
            // Encoded traversal attempts.
            "/assets/modules/%2e%2e/secret.js",
            "/assets/%2e%2e%2fmodules/secret.js",
            "/assets/modules/..%5csecret.js",
            "/assets/modules/%2e%2e%2f%2e%2e%2fetc/passwd",
            // Prefix enforcement: non-modules/ keys 404 even when present.
            "/assets/archives/m1.zip",
            // Plain miss.
            "/assets/modules/m1/nope.js",
        ];
        for uri in cases {
            let req = actix_test::TestRequest::get().uri(uri).to_request();
            let resp = actix_test::call_service(&app, req).await;
            assert_eq!(resp.status(), 404, "expected uniform 404 for {uri}");
            let body = actix_test::read_body(resp).await;
            assert!(body.is_empty(), "404 body must not leak detail for {uri}");
        }
    }

    #[actix_web::test]
    async fn get_maps_content_type_by_extension() {
        let dir = tempfile::tempdir().expect("tempdir");
        let repo = file_backed_repo(dir.path()).await;
        seed(&repo, "modules/m1/style.css", b"body{}").await;
        seed(&repo, "modules/m1/blob.dat", b"\x00\x01").await;

        let app = actix_test::init_service(
            App::new().app_data(Data::new(repo)).configure(configure),
        )
        .await;

        let req = actix_test::TestRequest::get()
            .uri("/assets/modules/m1/style.css")
            .to_request();
        let resp = actix_test::call_service(&app, req).await;
        assert_eq!(resp.status(), 200);
        assert_eq!(
            resp.headers().get("content-type").unwrap(),
            "text/css; charset=utf-8"
        );

        let req = actix_test::TestRequest::get()
            .uri("/assets/modules/m1/blob.dat")
            .to_request();
        let resp = actix_test::call_service(&app, req).await;
        assert_eq!(resp.status(), 200);
        assert_eq!(
            resp.headers().get("content-type").unwrap(),
            "application/octet-stream"
        );
    }
}
