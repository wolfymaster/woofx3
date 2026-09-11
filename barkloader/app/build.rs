//! Packages every `modules/*/` directory into the binary.
//!
//! Bundled modules must be installable with no network and no filesystem
//! layout assumption — a release is a compiled binary started by
//! `build/orchestrator`, and a source `modules/` directory does not exist
//! there. Embedding the archives removes the directory that could be missing.
//!
//! The scan is generic: adding a bundled module is adding a directory with a
//! `manifest.json`, with no list here to keep in step with it.

use std::collections::BTreeMap;
use std::fs;
use std::io::Write;
use std::path::{Path, PathBuf};

use sha2::{Digest, Sha256};
use zip::write::SimpleFileOptions;

/// Fixed DOS timestamp (1980-01-01) stamped on every zip entry.
///
/// Archive bytes are hashed and the digest is committed, so the same sources
/// must always produce the same archive. Real mtimes would change the digest
/// on every checkout.
const FIXED_TIMESTAMP: (u16, u8, u8, u8, u8, u8) = (1980, 1, 1, 0, 0, 0);

fn main() {
    let crate_dir = PathBuf::from(std::env::var("CARGO_MANIFEST_DIR").expect("CARGO_MANIFEST_DIR"));
    let repo_root = crate_dir
        .parent()
        .and_then(Path::parent)
        .expect("barkloader/app has a grandparent")
        .to_path_buf();
    let modules_dir = repo_root.join("modules");
    let out_dir = PathBuf::from(std::env::var("OUT_DIR").expect("OUT_DIR"));
    let archive_dir = out_dir.join("bundled");
    fs::create_dir_all(&archive_dir).expect("create bundled archive dir");

    // Watch the container directory too: adding a whole new module directory
    // changes only this path's mtime, and without it a new bundled module
    // needs an unrelated edit before the build notices it.
    println!("cargo:rerun-if-changed={}", modules_dir.display());

    let mut packaged: Vec<Packaged> = Vec::new();
    for module_dir in module_dirs(&modules_dir) {
        packaged.push(package(&module_dir, &archive_dir));
    }
    packaged.sort_by(|a, b| a.id.cmp(&b.id));

    write_generated_source(&out_dir, &packaged);
    write_lockfile(&modules_dir, &packaged);
}

struct Packaged {
    id: String,
    version: String,
    sha256: String,
    len: usize,
    archive_path: PathBuf,
}

/// Every immediate subdirectory of `modules/` holding a `manifest.json`,
/// sorted so the embedded order does not depend on filesystem iteration.
fn module_dirs(modules_dir: &Path) -> Vec<PathBuf> {
    let Ok(entries) = fs::read_dir(modules_dir) else {
        // No bundled modules is a valid state; the reconciler simply has
        // nothing to install.
        println!(
            "cargo:warning=no modules/ directory at {}",
            modules_dir.display()
        );
        return Vec::new();
    };
    let mut dirs: Vec<PathBuf> = entries
        .filter_map(Result::ok)
        .map(|e| e.path())
        .filter(|p| p.is_dir() && p.join("manifest.json").is_file())
        .collect();
    dirs.sort();
    dirs
}

fn package(module_dir: &Path, archive_dir: &Path) -> Packaged {
    let (files, dirs) = collect_files(module_dir);
    assert!(
        files.contains_key(Path::new("manifest.json")),
        "{}: manifest.json is required",
        module_dir.display()
    );

    for dir in &dirs {
        println!("cargo:rerun-if-changed={}", dir.display());
    }
    for rel in files.keys() {
        println!("cargo:rerun-if-changed={}", module_dir.join(rel).display());
    }

    let (id, version) = identity(&files[Path::new("manifest.json")], module_dir);
    let bytes = zip_deterministic(&files);
    let sha256 = format!("{:x}", Sha256::digest(&bytes));

    let archive_path = archive_dir.join(format!("{id}.zip"));
    fs::write(&archive_path, &bytes).expect("write bundled archive");

    Packaged {
        id,
        version,
        sha256,
        len: bytes.len(),
        archive_path,
    }
}

/// Every file under the module directory, keyed by its path relative to that
/// directory — the same shape an uploaded module archive has, so both go
/// through one parser. Also returns every directory walked, so the build can
/// watch them for added files.
fn collect_files(module_dir: &Path) -> (BTreeMap<PathBuf, Vec<u8>>, Vec<PathBuf>) {
    let mut files = BTreeMap::new();
    let mut dirs = vec![module_dir.to_path_buf()];
    let mut stack = vec![module_dir.to_path_buf()];
    while let Some(dir) = stack.pop() {
        let entries = fs::read_dir(&dir).unwrap_or_else(|e| panic!("read {}: {e}", dir.display()));
        for entry in entries.filter_map(Result::ok) {
            let path = entry.path();
            let name = entry.file_name();
            let name = name.to_string_lossy();
            if name.starts_with('.') {
                continue;
            }
            if path.is_dir() {
                dirs.push(path.clone());
                stack.push(path);
            } else {
                let rel = path
                    .strip_prefix(module_dir)
                    .expect("path is under module_dir")
                    .to_path_buf();
                let bytes =
                    fs::read(&path).unwrap_or_else(|e| panic!("read {}: {e}", path.display()));
                files.insert(rel, bytes);
            }
        }
    }
    (files, dirs)
}

fn identity(manifest_bytes: &[u8], module_dir: &Path) -> (String, String) {
    let manifest: serde_json::Value = serde_json::from_slice(manifest_bytes).unwrap_or_else(|e| {
        panic!(
            "{}: manifest.json is not valid JSON: {e}",
            module_dir.display()
        )
    });
    let field = |key: &str| -> String {
        manifest
            .get(key)
            .and_then(|v| v.as_str())
            .filter(|s| !s.is_empty())
            .unwrap_or_else(|| panic!("{}: manifest.json is missing {key:?}", module_dir.display()))
            .to_string()
    };
    (field("id"), field("version"))
}

/// BTreeMap iteration gives sorted entry order; combined with the fixed
/// timestamp, identical sources produce byte-identical archives.
fn zip_deterministic(files: &BTreeMap<PathBuf, Vec<u8>>) -> Vec<u8> {
    let mut writer = zip::ZipWriter::new(std::io::Cursor::new(Vec::new()));
    let options = SimpleFileOptions::default()
        .compression_method(zip::CompressionMethod::Deflated)
        .last_modified_time(
            zip::DateTime::from_date_and_time(
                FIXED_TIMESTAMP.0,
                FIXED_TIMESTAMP.1,
                FIXED_TIMESTAMP.2,
                FIXED_TIMESTAMP.3,
                FIXED_TIMESTAMP.4,
                FIXED_TIMESTAMP.5,
            )
            .expect("fixed timestamp is a valid DOS date"),
        )
        .unix_permissions(0o644);

    for (rel, bytes) in files {
        // Zip entries are '/'-separated regardless of host platform.
        let name = rel
            .components()
            .map(|c| c.as_os_str().to_string_lossy())
            .collect::<Vec<_>>()
            .join("/");
        writer.start_file(name, options).expect("start zip entry");
        writer.write_all(bytes).expect("write zip entry");
    }
    writer.finish().expect("finish zip").into_inner()
}

fn write_generated_source(out_dir: &Path, packaged: &[Packaged]) {
    let mut src = String::from(
        "// @generated by build.rs from modules/*/ - do not edit.\n\
         pub static BUNDLED_MODULES: &[BundledModule] = &[\n",
    );
    for p in packaged {
        src.push_str(&format!(
            "    BundledModule {{ id: {:?}, version: {:?}, sha256: {:?}, archive: include_bytes!({:?}) }},\n",
            p.id,
            p.version,
            p.sha256,
            p.archive_path.to_string_lossy(),
        ));
    }
    src.push_str("];\n");
    fs::write(out_dir.join("bundled_modules_generated.rs"), src).expect("write generated source");
}

/// Committed alongside the sources so a change to bundled content shows up in
/// review as a digest change. Best-effort: a read-only source tree is a valid
/// way to build, and failing the build over a bookkeeping file would be worse
/// than a stale one.
fn write_lockfile(modules_dir: &Path, packaged: &[Packaged]) {
    let entries: Vec<serde_json::Value> = packaged
        .iter()
        .map(|p| {
            serde_json::json!({ "id": p.id, "version": p.version, "sha256": p.sha256, "len": p.len })
        })
        .collect();
    let body = serde_json::to_string_pretty(&serde_json::json!({ "modules": entries }))
        .expect("serialize lockfile")
        + "\n";

    let path = modules_dir.join("bundled.lock.json");
    if fs::read_to_string(&path).is_ok_and(|existing| existing == body) {
        return;
    }
    if let Err(e) = fs::write(&path, &body) {
        println!("cargo:warning=could not update {}: {e}", path.display());
    }
}
