//! Derived preview images for user-uploaded resources.
//!
//! Reads a stored resource out of the repository, produces a thumbnail,
//! and writes it back beside the original as
//! `user/{owner}/{resource_id}/thumbnail.{ext}`.
//!
//! Three media families, three different answers:
//!   - images: decode, downscale, re-encode as PNG in-process.
//!   - video: the engine carries no video decoder. The uploading client,
//!     which can already play the clip, captures one frame and uploads it
//!     as the resource's poster (see `poster_key_for`). That poster goes
//!     through the image path, so client bytes are never stored as the
//!     thumbnail unprocessed. A video with no poster has no thumbnail.
//!   - audio: there is nothing to show. That is a *result*, not a
//!     failure -- see `ThumbnailOutcome::NotApplicable`.

use std::path::Path;

use anyhow::{Context, Result, anyhow};
use image::ImageFormat;
use image::imageops::FilterType;
use lib_repository::{CreateFileRequest, Repository, RepositoryImpl};
use tracing::{info, warn};

/// Longest edge of a generated thumbnail, in pixels. Aspect ratio is
/// always preserved, so this bounds area without cropping.
pub const THUMBNAIL_MAX_EDGE: u32 = 512;

/// Thumbnails are always PNG regardless of source format: one output
/// content type means the asset route and the UI never have to branch
/// on what the original happened to be.
const THUMBNAIL_FILE_NAME: &str = "thumbnail.png";
const THUMBNAIL_CONTENT_TYPE: &str = "image/png";

/// The leading dot keeps a poster from ever sharing a key with an upload:
/// `routes::resources::user_resource_key` strips leading dots from upload
/// file names.
const POSTER_FILE_NAME: &str = ".poster";

/// What generating a thumbnail produced.
///
/// `NotApplicable` is deliberately a success. Audio has no visual
/// frame; reporting that as an error would make every caller treat a
/// perfectly healthy upload as broken, and would put a retry loop
/// behind something that can never succeed.
#[derive(Debug, Clone, PartialEq, Eq)]
pub enum ThumbnailOutcome {
    Generated {
        repository_key: String,
        content_type: String,
        width: u32,
        height: u32,
    },
    NotApplicable {
        reason: String,
    },
}

/// Media family a resource belongs to, as far as thumbnailing cares.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum MediaKind {
    Image,
    Video,
    Audio,
    Other,
}

/// Classify by declared content type first, falling back to the key's
/// extension. The content type comes from the uploading client and is
/// therefore a hint, not a guarantee -- but a wrong hint only ever
/// costs a failed decode, never a wrong write, because the output key
/// is derived from the input key rather than from the classification.
pub fn classify(content_type: Option<&str>, key: &str) -> MediaKind {
    if let Some(content_type) = content_type {
        let lowered = content_type.to_ascii_lowercase();
        if lowered.starts_with("image/") {
            return MediaKind::Image;
        }
        if lowered.starts_with("video/") {
            return MediaKind::Video;
        }
        if lowered.starts_with("audio/") {
            return MediaKind::Audio;
        }
    }
    let extension = Path::new(key)
        .extension()
        .and_then(|e| e.to_str())
        .map(|e| e.to_ascii_lowercase())
        .unwrap_or_default();
    match extension.as_str() {
        "png" | "jpg" | "jpeg" | "gif" | "webp" | "bmp" => MediaKind::Image,
        "mp4" | "mov" | "webm" | "mkv" | "avi" => MediaKind::Video,
        "mp3" | "wav" | "ogg" | "flac" | "m4a" | "aac" => MediaKind::Audio,
        _ => MediaKind::Other,
    }
}

/// The key a resource's thumbnail lives at: the source key's directory
/// plus a fixed file name. Derived rather than passed in, so a caller
/// cannot aim a thumbnail write at some unrelated part of the store.
pub fn thumbnail_key_for(source_key: &str) -> Result<String> {
    sibling_key(source_key, THUMBNAIL_FILE_NAME)
}

/// The key a client uploads a video's captured frame to. Derived from the
/// source key for the same reason as `thumbnail_key_for`.
pub fn poster_key_for(source_key: &str) -> Result<String> {
    sibling_key(source_key, POSTER_FILE_NAME)
}

fn sibling_key(source_key: &str, file_name: &str) -> Result<String> {
    let (directory, _) = source_key
        .rsplit_once('/')
        .ok_or_else(|| anyhow!("resource key {} has no directory component", source_key))?;
    if directory.is_empty() {
        return Err(anyhow!(
            "resource key {} has an empty directory",
            source_key
        ));
    }
    Ok(format!("{}/{}", directory, file_name))
}

/// Generate the thumbnail for `source_key` and write it back: from the
/// resource itself for an image, from its uploaded poster for a video.
/// Audio, and a video with no poster, return `NotApplicable` without
/// writing anything.
pub async fn generate(
    repository: &RepositoryImpl,
    source_key: &str,
    content_type: Option<&str>,
) -> Result<ThumbnailOutcome> {
    let kind = classify(content_type, source_key);
    if kind == MediaKind::Audio {
        return Ok(ThumbnailOutcome::NotApplicable {
            reason: "audio resources have no visual frame to thumbnail".to_string(),
        });
    }
    if kind == MediaKind::Other {
        return Ok(ThumbnailOutcome::NotApplicable {
            reason: format!(
                "no thumbnailer for content type {}",
                content_type.unwrap_or("(unknown)")
            ),
        });
    }

    let image_key = match kind {
        MediaKind::Image => source_key.to_string(),
        MediaKind::Video => {
            let poster_key = poster_key_for(source_key)?;
            let has_poster = repository
                .exists(&poster_key)
                .await
                .with_context(|| format!("checking for poster {}", poster_key))?;
            if !has_poster {
                return Ok(ThumbnailOutcome::NotApplicable {
                    reason: "no poster frame was uploaded for this video".to_string(),
                });
            }
            poster_key
        }
        // Both handled above; kept explicit rather than a catch-all so
        // adding a MediaKind forces a decision here.
        MediaKind::Audio | MediaKind::Other => unreachable!("audio and other returned early"),
    };

    let bytes = repository
        .read_file(&image_key)
        .await
        .with_context(|| format!("reading {} for thumbnailing", image_key))?;
    let encoded = encode_image_thumbnail(&bytes);

    // A poster is consumed whether or not it decoded: an upload grant is
    // refused while its key holds an object, so a poster left in place
    // would block the client from sending a replacement.
    if kind == MediaKind::Video
        && let Err(err) = repository.delete_prefix(&image_key).await
    {
        warn!("Failed to remove consumed poster {}: {}", image_key, err);
    }
    let (png, width, height) = encoded?;

    let key = thumbnail_key_for(source_key)?;
    let mut failed = Vec::new();
    repository
        .create(
            [CreateFileRequest {
                content: Some(png),
                extension: Some("png".to_string()),
                file_name: key.clone(),
            }],
            &mut failed,
        )
        .await
        .with_context(|| format!("writing thumbnail {}", key))?;
    if !failed.is_empty() {
        return Err(anyhow!("repository rejected thumbnail write for {}", key));
    }

    info!("Generated {}x{} thumbnail at {}", width, height, key);
    Ok(ThumbnailOutcome::Generated {
        repository_key: key,
        content_type: THUMBNAIL_CONTENT_TYPE.to_string(),
        width,
        height,
    })
}

/// Downscale to fit inside a THUMBNAIL_MAX_EDGE box, preserving aspect
/// ratio. Images already smaller than the box are re-encoded rather
/// than upscaled -- a blown-up thumbnail is worse than a small one, and
/// re-encoding still normalizes the output format.
pub fn encode_image_thumbnail(bytes: &[u8]) -> Result<(Vec<u8>, u32, u32)> {
    let decoded = image::load_from_memory(bytes).context("decoding source image")?;
    // `resize` scales to fit the box in both directions, which enlarges a
    // source smaller than the box. Only downscale; a source already inside
    // the box is re-encoded at its original size.
    let thumbnail =
        if decoded.width() <= THUMBNAIL_MAX_EDGE && decoded.height() <= THUMBNAIL_MAX_EDGE {
            decoded
        } else {
            decoded.resize(THUMBNAIL_MAX_EDGE, THUMBNAIL_MAX_EDGE, FilterType::Lanczos3)
        };
    let width = thumbnail.width();
    let height = thumbnail.height();

    let mut out = std::io::Cursor::new(Vec::new());
    thumbnail
        .write_to(&mut out, ImageFormat::Png)
        .context("encoding thumbnail as PNG")?;
    Ok((out.into_inner(), width, height))
}

#[cfg(test)]
mod tests {
    use super::*;
    use image::{ImageBuffer, Rgba};
    use lib_repository::{FileRepository, FileRepositoryConfig};

    const VIDEO_KEY: &str = "user/res-1/clip.mp4";
    const POSTER_KEY: &str = "user/res-1/.poster";

    fn file_repo(root: &Path) -> RepositoryImpl {
        let repo = FileRepository::new(FileRepositoryConfig {
            destination: root.to_path_buf(),
        });
        repo.setup().expect("repo setup");
        RepositoryImpl::File(repo)
    }

    async fn store(repository: &RepositoryImpl, key: &str, content: Vec<u8>) {
        let mut failed = Vec::new();
        repository
            .create(
                [CreateFileRequest {
                    content: Some(content),
                    extension: None,
                    file_name: key.to_string(),
                }],
                &mut failed,
            )
            .await
            .expect("store fixture");
        assert!(failed.is_empty());
    }

    fn png_bytes(width: u32, height: u32) -> Vec<u8> {
        let buffer: ImageBuffer<Rgba<u8>, Vec<u8>> = ImageBuffer::from_fn(width, height, |x, y| {
            Rgba([(x % 256) as u8, (y % 256) as u8, 128, 255])
        });
        let mut out = std::io::Cursor::new(Vec::new());
        image::DynamicImage::ImageRgba8(buffer)
            .write_to(&mut out, ImageFormat::Png)
            .expect("encode fixture png");
        out.into_inner()
    }

    #[test]
    fn classify_prefers_content_type_then_extension() {
        assert_eq!(
            classify(Some("image/png"), "user/a/b/x.bin"),
            MediaKind::Image
        );
        assert_eq!(
            classify(Some("video/mp4"), "user/a/b/x.bin"),
            MediaKind::Video
        );
        assert_eq!(
            classify(Some("audio/mpeg"), "user/a/b/x.bin"),
            MediaKind::Audio
        );
        // No content type: fall back to the extension.
        assert_eq!(classify(None, "user/a/b/x.PNG"), MediaKind::Image);
        assert_eq!(classify(None, "user/a/b/x.mov"), MediaKind::Video);
        assert_eq!(classify(None, "user/a/b/x.flac"), MediaKind::Audio);
        assert_eq!(classify(None, "user/a/b/x.pdf"), MediaKind::Other);
        assert_eq!(classify(None, "user/a/b/noext"), MediaKind::Other);
    }

    #[test]
    fn thumbnail_key_sits_beside_the_source() {
        assert_eq!(
            thumbnail_key_for("user/res-1/photo.png").unwrap(),
            "user/res-1/thumbnail.png"
        );
        assert_eq!(
            thumbnail_key_for("user/res-1/clip.mp4").unwrap(),
            "user/res-1/thumbnail.png"
        );
        // A key with no directory has nowhere to put a sibling.
        assert!(thumbnail_key_for("photo.png").is_err());
    }

    #[test]
    fn poster_key_sits_beside_the_source() {
        assert_eq!(poster_key_for(VIDEO_KEY).unwrap(), POSTER_KEY);
        assert!(poster_key_for("clip.mp4").is_err());
    }

    #[tokio::test]
    async fn video_thumbnail_is_made_from_the_poster_which_is_then_consumed() {
        let root = tempfile::tempdir().expect("tempdir");
        let repository = file_repo(root.path());
        store(
            &repository,
            VIDEO_KEY,
            b"not decoded by the engine".to_vec(),
        )
        .await;
        store(&repository, POSTER_KEY, png_bytes(1600, 800)).await;

        let outcome = generate(&repository, VIDEO_KEY, Some("video/mp4"))
            .await
            .expect("generate");

        assert_eq!(
            outcome,
            ThumbnailOutcome::Generated {
                repository_key: "user/res-1/thumbnail.png".to_string(),
                content_type: "image/png".to_string(),
                width: THUMBNAIL_MAX_EDGE,
                height: THUMBNAIL_MAX_EDGE / 2,
            }
        );
        assert!(root.path().join("user/res-1/thumbnail.png").exists());
        assert!(!root.path().join(POSTER_KEY).exists());
        assert!(root.path().join(VIDEO_KEY).exists());
    }

    #[tokio::test]
    async fn video_without_a_poster_is_not_applicable() {
        let root = tempfile::tempdir().expect("tempdir");
        let repository = file_repo(root.path());
        store(
            &repository,
            VIDEO_KEY,
            b"not decoded by the engine".to_vec(),
        )
        .await;

        let outcome = generate(&repository, VIDEO_KEY, Some("video/mp4"))
            .await
            .expect("generate");

        assert!(matches!(outcome, ThumbnailOutcome::NotApplicable { .. }));
        assert!(!root.path().join("user/res-1/thumbnail.png").exists());
    }

    #[tokio::test]
    async fn undecodable_poster_fails_and_is_removed_so_it_can_be_replaced() {
        let root = tempfile::tempdir().expect("tempdir");
        let repository = file_repo(root.path());
        store(&repository, POSTER_KEY, b"this is not an image".to_vec()).await;

        let outcome = generate(&repository, VIDEO_KEY, Some("video/mp4")).await;

        assert!(outcome.is_err());
        assert!(!root.path().join(POSTER_KEY).exists());
        assert!(!root.path().join("user/res-1/thumbnail.png").exists());
    }

    #[test]
    fn image_thumbnail_fits_inside_the_bounding_box_and_keeps_aspect() {
        let source = png_bytes(1600, 800);
        let (png, width, height) = encode_image_thumbnail(&source).expect("thumbnail");

        assert_eq!(width, THUMBNAIL_MAX_EDGE);
        assert_eq!(
            height,
            THUMBNAIL_MAX_EDGE / 2,
            "aspect ratio must be preserved"
        );
        assert!(
            png.starts_with(&[0x89, b'P', b'N', b'G']),
            "output must be PNG"
        );
    }

    #[test]
    fn small_images_are_re_encoded_but_never_upscaled() {
        let source = png_bytes(64, 32);
        let (_, width, height) = encode_image_thumbnail(&source).expect("thumbnail");
        assert_eq!((width, height), (64, 32));
    }

    #[test]
    fn undecodable_bytes_fail_rather_than_producing_a_blank_thumbnail() {
        assert!(encode_image_thumbnail(b"this is not an image").is_err());
    }
}
