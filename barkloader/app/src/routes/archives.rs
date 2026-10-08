use std::io::{Cursor, Read};

use actix_web::web::{Data, Query, ServiceConfig};
use actix_web::{HttpResponse, get};
use anyhow::{Context, Result};
use lib_module::manifest_file_rank;
use lib_module::module_manifest::normalize_rel_path;
use lib_repository::Repository;
use serde::{Deserialize, Serialize};
use tracing::warn;
use zip::ZipArchive;

use crate::types::SharedRepository;

/// The most bytes one content read returns. One past the API's 1 MiB text
/// limit, so the caller can tell "exactly at the limit" from "over it"
/// without this route ever inflating a whole entry: the cap bounds what is
/// decompressed, not just what is sent, so an entry whose header lies about
/// its size cannot exhaust memory.
const MAX_ENTRY_READ_BYTES: u64 = 1024 * 1024 + 1;

/// Response header carrying the entry's size as its zip header declares it.
/// A capped read returns fewer bytes than the file holds, and a viewer still
/// wants to say how big the file is.
const ENTRY_SIZE_HEADER: &str = "X-Archive-Entry-Size";

/// Entries that archiving tools add beside the module's own files. Listing
/// them would show a streamer files they never wrote.
const JUNK_DIRECTORY: &str = "__MACOSX";
const JUNK_FILE: &str = ".DS_Store";

#[derive(Deserialize)]
struct FilesQuery {
    key: String,
}

#[derive(Deserialize)]
struct FileQuery {
    key: String,
    path: String,
}

#[derive(Debug, PartialEq, Eq, Serialize)]
struct ArchiveFileEntry {
    /// Relative to the module root: the directory holding the manifest.
    path: String,
    /// As declared in the zip header, uncompressed.
    size: u64,
}

/// Every file in an installed module's archive, relative to the module root.
/// Read-only: the archive is the zip the module was installed from, kept at
/// `archives/{module_key}.zip`, so this shows exactly what was uploaded.
#[get("/archives/files")]
#[tracing::instrument(name = "GET /archives/files", skip_all, fields(archive_key = %query.key))]
async fn list_files_handler(
    repository: Data<SharedRepository>,
    query: Query<FilesQuery>,
) -> HttpResponse {
    let key = query.into_inner().key;
    let bytes = match read_archive(&repository, &key).await {
        Ok(bytes) => bytes,
        Err(response) => return response,
    };
    match ModuleArchive::open(bytes) {
        Ok(archive) => HttpResponse::Ok().json(archive.files()),
        Err(e) => {
            warn!("archives: cannot open {}: {:#}", key, e);
            HttpResponse::InternalServerError().body(format!("archive {key} is not a readable zip"))
        }
    }
}

/// One file's bytes, capped at `MAX_ENTRY_READ_BYTES`.
#[get("/archives/file")]
#[tracing::instrument(
    name = "GET /archives/file",
    skip_all,
    fields(archive_key = %query.key, path = %query.path)
)]
async fn read_file_handler(
    repository: Data<SharedRepository>,
    query: Query<FileQuery>,
) -> HttpResponse {
    let FileQuery { key, path } = query.into_inner();
    let Ok(rel_path) = normalize_rel_path(&path) else {
        return HttpResponse::BadRequest().body("`path` must not contain `..` segments");
    };
    if rel_path.is_empty() {
        return HttpResponse::BadRequest().body("`path` is required");
    }
    let bytes = match read_archive(&repository, &key).await {
        Ok(bytes) => bytes,
        Err(response) => return response,
    };
    let mut archive = match ModuleArchive::open(bytes) {
        Ok(archive) => archive,
        Err(e) => {
            warn!("archives: cannot open {}: {:#}", key, e);
            return HttpResponse::InternalServerError()
                .body(format!("archive {key} is not a readable zip"));
        }
    };
    match archive.read(&rel_path, MAX_ENTRY_READ_BYTES) {
        Ok(Some(entry)) => HttpResponse::Ok()
            .content_type("application/octet-stream")
            .insert_header((ENTRY_SIZE_HEADER, entry.declared_size.to_string()))
            .body(entry.bytes),
        Ok(None) => HttpResponse::NotFound().body(format!("file not found in module: {rel_path}")),
        Err(e) => {
            warn!("archives: cannot read {} from {}: {:#}", rel_path, key, e);
            HttpResponse::InternalServerError()
                .body(format!("cannot read {rel_path} from archive {key}"))
        }
    }
}

/// The archive's bytes, or the response to send instead: 400 for a key this
/// route will not serve, 404 when no archive is stored under it.
async fn read_archive(
    repository: &SharedRepository,
    key: &str,
) -> std::result::Result<Vec<u8>, HttpResponse> {
    if !is_archive_key(key) {
        return Err(HttpResponse::BadRequest()
            .body("`key` must be `archives/{module_key}.zip` with no `..` segments"));
    }
    let repository = repository.current();
    match repository.exists(key).await {
        Ok(true) => {}
        Ok(false) => {
            return Err(HttpResponse::NotFound().body(format!("no archive stored at {key}")));
        }
        Err(e) => {
            warn!("archives: exists check failed for {}: {}", key, e);
            return Err(HttpResponse::InternalServerError().finish());
        }
    }
    repository.read_file(key).await.map_err(|e| {
        warn!("archives: read failed for {}: {}", key, e);
        HttpResponse::InternalServerError().finish()
    })
}

/// Only module archives: every other repository key (module files, user
/// uploads) has a route of its own with its own rules.
fn is_archive_key(key: &str) -> bool {
    key.starts_with("archives/")
        && key.ends_with(".zip")
        && !key.contains('\\')
        && key
            .split('/')
            .all(|segment| segment != ".." && segment != ".")
}

struct EntryContents {
    bytes: Vec<u8>,
    declared_size: u64,
}

struct IndexedEntry {
    /// Relative to the module root.
    path: String,
    /// Position in the zip's central directory.
    index: usize,
    size: u64,
}

/// A module's install archive, addressed the way the installer addresses it:
/// paths are relative to the directory holding the manifest, so a zip that
/// wraps the module in one top-level folder lists the same paths as a flat
/// one.
struct ModuleArchive {
    zip: ZipArchive<Cursor<Vec<u8>>>,
    /// The module's files, sorted by path. Directories, symlinks, archiver
    /// junk, members outside the module root and members whose names do not
    /// normalize (a `..` segment) are left out.
    entries: Vec<IndexedEntry>,
}

impl ModuleArchive {
    fn open(bytes: Vec<u8>) -> Result<Self> {
        let mut zip = ZipArchive::new(Cursor::new(bytes)).context("open zip")?;
        let root = module_root(zip.file_names());
        let mut entries = Vec::new();
        for index in 0..zip.len() {
            // Raw access reads only the header: listing never inflates.
            let entry = zip
                .by_index_raw(index)
                .with_context(|| format!("read entry {index}"))?;
            if entry.is_dir() || entry.is_symlink() {
                continue;
            }
            let Some(path) = module_path(&root, entry.name()) else {
                continue;
            };
            entries.push(IndexedEntry {
                path,
                index,
                size: entry.size(),
            });
        }
        entries.sort_by(|a, b| a.path.cmp(&b.path));
        Ok(Self { zip, entries })
    }

    fn files(&self) -> Vec<ArchiveFileEntry> {
        self.entries
            .iter()
            .map(|entry| ArchiveFileEntry {
                path: entry.path.clone(),
                size: entry.size,
            })
            .collect()
    }

    /// The file at `rel_path` under the module root, reading at most
    /// `limit` bytes of it. `None` when the module has no such file, which
    /// includes every member `files` leaves out.
    fn read(&mut self, rel_path: &str, limit: u64) -> Result<Option<EntryContents>> {
        let Some(index) = self
            .entries
            .iter()
            .find(|entry| entry.path == rel_path)
            .map(|entry| entry.index)
        else {
            return Ok(None);
        };
        let entry = self
            .zip
            .by_index(index)
            .with_context(|| format!("open entry {rel_path}"))?;
        let declared_size = entry.size();
        let mut bytes = Vec::new();
        entry
            .take(limit)
            .read_to_end(&mut bytes)
            .with_context(|| format!("inflate entry {rel_path}"))?;
        Ok(Some(EntryContents {
            bytes,
            declared_size,
        }))
    }
}

/// A member name as a path relative to the module root, or `None` when it is
/// not one of the module's files.
fn module_path(root: &str, name: &str) -> Option<String> {
    let normalized = normalize_rel_path(name).ok()?;
    let rel = normalized.strip_prefix(root)?;
    if rel.is_empty() || is_junk(rel) {
        return None;
    }
    Some(rel.to_string())
}

/// The directory holding the manifest the installer would have picked: the
/// best-ranked manifest name, the shallowest on a tie. Empty when the
/// manifest sits at the zip root, or when there is none to find.
fn module_root<'a>(names: impl Iterator<Item = &'a str>) -> String {
    let mut best: Option<(u8, usize, String)> = None;
    for name in names {
        let Some(rank) = manifest_file_rank(name) else {
            continue;
        };
        let Ok(normalized) = normalize_rel_path(name) else {
            continue;
        };
        if is_junk(&normalized) {
            continue;
        }
        let depth = normalized.matches('/').count();
        let better = match &best {
            None => true,
            Some((best_rank, best_depth, _)) => (rank, depth) < (*best_rank, *best_depth),
        };
        if better {
            let root = match normalized.rfind('/') {
                Some(slash) => normalized[..=slash].to_string(),
                None => String::new(),
            };
            best = Some((rank, depth, root));
        }
    }
    best.map(|(_, _, root)| root).unwrap_or_default()
}

fn is_junk(path: &str) -> bool {
    path.split('/')
        .any(|segment| segment == JUNK_DIRECTORY || segment == JUNK_FILE)
}

pub fn configure(cfg: &mut ServiceConfig) {
    cfg.service(list_files_handler).service(read_file_handler);
}

#[cfg(test)]
mod tests {
    use super::*;
    use actix_web::App;
    use actix_web::test as actix_test;
    use lib_repository::{CreateFileRequest, FileRepository, FileRepositoryConfig, RepositoryImpl};
    use std::io::Write;
    use zip::write::SimpleFileOptions;

    const KEY: &str = "archives/demo:1.0.0:abc1234.zip";

    fn build_zip(entries: &[(&str, &[u8])]) -> Vec<u8> {
        let mut writer = zip::ZipWriter::new(Cursor::new(Vec::new()));
        let options = SimpleFileOptions::default();
        for (name, contents) in entries {
            if name.ends_with('/') {
                writer.add_directory(*name, options).expect("add dir");
            } else {
                writer.start_file(*name, options).expect("start file");
                writer.write_all(contents).expect("write file");
            }
        }
        writer.finish().expect("finish zip").into_inner()
    }

    fn file_paths(archive: &ModuleArchive) -> Vec<String> {
        archive.files().into_iter().map(|f| f.path).collect()
    }

    #[test]
    fn lists_a_flat_archive_sorted_without_directories() {
        let zip = build_zip(&[
            ("manifest.json", b"{}"),
            ("functions/", b""),
            ("functions/hello.js", b"export default 1;"),
            ("README.md", b"# hi"),
        ]);
        let archive = ModuleArchive::open(zip).expect("open");
        assert_eq!(
            archive.files(),
            vec![
                ArchiveFileEntry {
                    path: "README.md".into(),
                    size: 4
                },
                ArchiveFileEntry {
                    path: "functions/hello.js".into(),
                    size: 17
                },
                ArchiveFileEntry {
                    path: "manifest.json".into(),
                    size: 2
                },
            ]
        );
    }

    #[test]
    fn paths_are_relative_to_a_top_level_folder_holding_the_manifest() {
        let zip = build_zip(&[
            ("demo/", b""),
            ("demo/manifest.json", b"{}"),
            ("demo/widgets/w/index.html", b"<p>"),
            ("demo/widgets/w/manifest.json", b"{\"nested\":true}"),
            ("stray.txt", b"outside the module"),
        ]);
        let mut archive = ModuleArchive::open(zip).expect("open");
        assert_eq!(
            file_paths(&archive),
            vec![
                "manifest.json",
                "widgets/w/index.html",
                "widgets/w/manifest.json"
            ]
        );
        let entry = archive
            .read("widgets/w/index.html", MAX_ENTRY_READ_BYTES)
            .expect("read")
            .expect("present");
        assert_eq!(entry.bytes, b"<p>");
        assert!(archive.read("stray.txt", 64).expect("read").is_none());
    }

    #[test]
    fn skips_archiver_junk() {
        let zip = build_zip(&[
            ("manifest.json", b"{}"),
            (".DS_Store", b"\0\0"),
            ("assets/.DS_Store", b"\0\0"),
            ("__MACOSX/._manifest.json", b"\0"),
            ("__MACOSX/assets/._a.png", b"\0"),
        ]);
        let mut archive = ModuleArchive::open(zip).expect("open");
        assert_eq!(file_paths(&archive), vec!["manifest.json"]);
        assert!(archive.read(".DS_Store", 64).expect("read").is_none());
    }

    #[test]
    fn prefers_manifest_json_over_legacy_names() {
        let zip = build_zip(&[
            ("module.json", b"{}"),
            ("pkg/manifest.json", b"{}"),
            ("pkg/main.js", b""),
        ]);
        let archive = ModuleArchive::open(zip).expect("open");
        assert_eq!(file_paths(&archive), vec!["main.js", "manifest.json"]);
    }

    #[test]
    fn read_caps_the_bytes_inflated_and_reports_the_declared_size() {
        let big = vec![b'a'; 4096];
        let zip = build_zip(&[("manifest.json", b"{}"), ("big.txt", &big)]);
        let mut archive = ModuleArchive::open(zip).expect("open");
        let entry = archive
            .read("big.txt", 100)
            .expect("read")
            .expect("present");
        assert_eq!(entry.bytes.len(), 100);
        assert_eq!(entry.declared_size, 4096);
    }

    #[test]
    fn read_of_a_missing_entry_or_a_directory_is_none() {
        let zip = build_zip(&[("manifest.json", b"{}"), ("functions/", b"")]);
        let mut archive = ModuleArchive::open(zip).expect("open");
        assert!(archive.read("nope.js", 64).expect("read").is_none());
        assert!(archive.read("functions", 64).expect("read").is_none());
        assert!(archive.read("functions/", 64).expect("read").is_none());
    }

    #[test]
    fn module_root_is_the_shallowest_best_ranked_manifest_directory() {
        let root = |names: &[&str]| module_root(names.iter().copied());
        assert_eq!(root(&["manifest.json", "a/manifest.json"]), "");
        assert_eq!(
            root(&["demo/a/manifest.json", "demo/manifest.json"]),
            "demo/"
        );
        assert_eq!(root(&["module.json", "pkg/manifest.json"]), "pkg/");
        assert_eq!(
            root(&["__MACOSX/manifest.json", "demo/manifest.json"]),
            "demo/"
        );
        assert_eq!(root(&["functions/a.js"]), "");
    }

    #[test]
    fn archive_keys_are_confined_to_archives() {
        assert!(is_archive_key(KEY));
        assert!(!is_archive_key("archives/../modules/x.zip"));
        assert!(!is_archive_key("archives/./x.zip"));
        assert!(!is_archive_key("archives\\x.zip"));
        assert!(!is_archive_key("modules/demo/x.zip"));
        assert!(!is_archive_key("archives/demo.txt"));
        assert!(!is_archive_key(""));
    }

    async fn repository_with_archive(
        dir: &std::path::Path,
        archive: Option<Vec<u8>>,
    ) -> SharedRepository {
        let repo = FileRepository::new(FileRepositoryConfig {
            destination: dir.to_path_buf(),
        });
        repo.setup().expect("repo setup");
        let repo = RepositoryImpl::File(repo);
        if let Some(bytes) = archive {
            let mut failed = Vec::new();
            repo.create(
                [CreateFileRequest {
                    content: Some(bytes),
                    extension: Some("zip".to_string()),
                    file_name: KEY.to_string(),
                }],
                &mut failed,
            )
            .await
            .expect("seed archive");
            assert!(failed.is_empty());
        }
        SharedRepository::new(repo)
    }

    macro_rules! app_with_archive {
        ($dir:expr, $archive:expr) => {
            actix_test::init_service(
                App::new()
                    .app_data(Data::new(repository_with_archive($dir, $archive).await))
                    .configure(configure),
            )
            .await
        };
    }

    fn uri(path: &str, query: &[(&str, &str)]) -> String {
        let encoded: Vec<String> = query
            .iter()
            .map(|(k, v)| {
                format!(
                    "{k}={}",
                    url::form_urlencoded::byte_serialize(v.as_bytes()).collect::<String>()
                )
            })
            .collect();
        format!("{path}?{}", encoded.join("&"))
    }

    #[actix_web::test]
    async fn http_lists_and_reads_files() {
        let dir = tempfile::tempdir().expect("tempdir");
        let zip = build_zip(&[
            ("demo/manifest.json", b"{\"id\":\"demo\"}"),
            ("demo/functions/hello.js", b"export default 1;"),
        ]);
        let app = app_with_archive!(dir.path(), Some(zip));

        let req = actix_test::TestRequest::get()
            .uri(&uri("/archives/files", &[("key", KEY)]))
            .to_request();
        let body: serde_json::Value = actix_test::call_and_read_body_json(&app, req).await;
        assert_eq!(
            body,
            serde_json::json!([
                { "path": "functions/hello.js", "size": 17 },
                { "path": "manifest.json", "size": 13 },
            ])
        );

        let req = actix_test::TestRequest::get()
            .uri(&uri(
                "/archives/file",
                &[("key", KEY), ("path", "functions/hello.js")],
            ))
            .to_request();
        let resp = actix_test::call_service(&app, req).await;
        assert_eq!(resp.status(), 200);
        assert_eq!(resp.headers().get(ENTRY_SIZE_HEADER).unwrap(), "17");
        let body = actix_test::read_body(resp).await;
        assert_eq!(&body[..], b"export default 1;");
    }

    #[actix_web::test]
    async fn http_missing_entry_is_404() {
        let dir = tempfile::tempdir().expect("tempdir");
        let zip = build_zip(&[("manifest.json", b"{}")]);
        let app = app_with_archive!(dir.path(), Some(zip));
        let req = actix_test::TestRequest::get()
            .uri(&uri("/archives/file", &[("key", KEY), ("path", "nope.js")]))
            .to_request();
        let resp = actix_test::call_service(&app, req).await;
        assert_eq!(resp.status(), 404);
    }

    #[actix_web::test]
    async fn http_missing_archive_is_404() {
        let dir = tempfile::tempdir().expect("tempdir");
        let app = app_with_archive!(dir.path(), None);
        for req in [
            actix_test::TestRequest::get().uri(&uri("/archives/files", &[("key", KEY)])),
            actix_test::TestRequest::get().uri(&uri(
                "/archives/file",
                &[("key", KEY), ("path", "manifest.json")],
            )),
        ] {
            let resp = actix_test::call_service(&app, req.to_request()).await;
            assert_eq!(resp.status(), 404);
        }
    }

    #[actix_web::test]
    async fn http_rejects_bad_keys_and_traversing_paths() {
        let dir = tempfile::tempdir().expect("tempdir");
        let zip = build_zip(&[("manifest.json", b"{}")]);
        let app = app_with_archive!(dir.path(), Some(zip));
        let cases = [
            uri("/archives/files", &[("key", "modules/demo/manifest.json")]),
            uri("/archives/files", &[("key", "archives/../secrets.zip")]),
            uri("/archives/file", &[("key", "user/r/x.zip"), ("path", "a")]),
            uri(
                "/archives/file",
                &[("key", KEY), ("path", "../manifest.json")],
            ),
            uri("/archives/file", &[("key", KEY), ("path", "")]),
        ];
        for case in cases {
            let req = actix_test::TestRequest::get().uri(&case).to_request();
            let resp = actix_test::call_service(&app, req).await;
            assert_eq!(resp.status(), 400, "expected 400 for {case}");
        }
    }
}
