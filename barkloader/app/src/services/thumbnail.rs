//! Derived preview images for user-uploaded resources.
//!
//! Reads a stored resource out of the repository, produces a thumbnail,
//! and writes it back beside the original as
//! `user/{owner}/{resource_id}/thumbnail.{ext}`.
//!
//! Three media families, three different answers:
//!   - images: decode, downscale, re-encode as PNG in-process.
//!   - video: hand a temp file to `ffmpeg` and pull one random frame.
//!     Shelling out matches how `file_service` already handles
//!     zip/gunzip, and avoids linking a media stack into the engine.
//!   - audio: there is nothing to show. That is a *result*, not a
//!     failure -- see `ThumbnailOutcome::NotApplicable`.

use std::path::Path;
use std::process::Command;

use anyhow::{Context, Result, anyhow};
use image::ImageFormat;
use image::imageops::FilterType;
use lib_repository::{CreateFileRequest, Repository, RepositoryImpl};
use log::{info, warn};
use rand::Rng;

/// Longest edge of a generated thumbnail, in pixels. Aspect ratio is
/// always preserved, so this bounds area without cropping.
pub const THUMBNAIL_MAX_EDGE: u32 = 512;

/// Thumbnails are always PNG regardless of source format: one output
/// content type means the asset route and the UI never have to branch
/// on what the original happened to be.
const THUMBNAIL_FILE_NAME: &str = "thumbnail.png";
const THUMBNAIL_CONTENT_TYPE: &str = "image/png";

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
    let (directory, _) = source_key
        .rsplit_once('/')
        .ok_or_else(|| anyhow!("resource key {} has no directory component", source_key))?;
    if directory.is_empty() {
        return Err(anyhow!("resource key {} has an empty directory", source_key));
    }
    Ok(format!("{}/{}", directory, THUMBNAIL_FILE_NAME))
}

/// Read `source_key` from the repository, generate a thumbnail, and
/// write it back. Audio returns `NotApplicable` without touching the
/// store.
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

    let bytes = repository
        .read_file(source_key)
        .await
        .with_context(|| format!("reading resource {} for thumbnailing", source_key))?;

    let (png, width, height) = match kind {
        MediaKind::Image => encode_image_thumbnail(&bytes)?,
        MediaKind::Video => encode_video_thumbnail(&bytes, source_key)?,
        // Both handled above; kept explicit rather than a catch-all so
        // adding a MediaKind forces a decision here.
        MediaKind::Audio | MediaKind::Other => unreachable!("audio and other returned early"),
    };

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
    let thumbnail = if decoded.width() <= THUMBNAIL_MAX_EDGE && decoded.height() <= THUMBNAIL_MAX_EDGE {
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

/// Extract one frame from a video and encode it as a PNG thumbnail.
///
/// The frame is picked at random rather than taken from the start:
/// the first frames of a clip are very often black, a fade-in, or a
/// title card, all of which make useless previews.
fn encode_video_thumbnail(bytes: &[u8], source_key: &str) -> Result<(Vec<u8>, u32, u32)> {
    let extension = Path::new(source_key)
        .extension()
        .and_then(|e| e.to_str())
        .unwrap_or("mp4");

    let workspace = tempfile::tempdir().context("creating video thumbnail workspace")?;
    let input_path = workspace.path().join(format!("source.{}", extension));
    let frame_path = workspace.path().join("frame.png");
    std::fs::write(&input_path, bytes).context("staging video for ffmpeg")?;

    let duration = probe_duration_seconds(&input_path);
    let seek_seconds = random_seek_offset(duration);

    // -ss before -i seeks by keyframe, which is both fast and safe on a
    // file we do not control the encoding of.
    let output = Command::new("ffmpeg")
        .args([
            "-nostdin",
            "-loglevel",
            "error",
            "-ss",
            &format!("{:.3}", seek_seconds),
            "-i",
        ])
        .arg(&input_path)
        .args(["-frames:v", "1", "-vsync", "0", "-y"])
        .arg(&frame_path)
        .output()
        .context("running ffmpeg; is it installed and on PATH?")?;

    if !output.status.success() {
        return Err(anyhow!(
            "ffmpeg failed to extract a frame from {}: {}",
            source_key,
            String::from_utf8_lossy(&output.stderr).trim()
        ));
    }

    let frame = std::fs::read(&frame_path).context("reading extracted video frame")?;
    if frame.is_empty() {
        return Err(anyhow!("ffmpeg produced an empty frame for {}", source_key));
    }
    // Reuse the image path so a video thumbnail and an image thumbnail
    // are bounded and encoded identically.
    encode_image_thumbnail(&frame)
}

/// Duration in seconds via `ffprobe`. Returns `None` when ffprobe is
/// absent or the container carries no duration -- the caller then seeks
/// to the start rather than failing, since a thumbnail from frame zero
/// still beats no thumbnail.
fn probe_duration_seconds(path: &Path) -> Option<f64> {
    let output = Command::new("ffprobe")
        .args([
            "-v",
            "error",
            "-show_entries",
            "format=duration",
            "-of",
            "default=noprint_wrappers=1:nokey=1",
        ])
        .arg(path)
        .output()
        .ok()?;
    if !output.status.success() {
        warn!("ffprobe could not read a duration from {}", path.display());
        return None;
    }
    let text = String::from_utf8_lossy(&output.stdout);
    let parsed = text.trim().parse::<f64>().ok()?;
    if parsed.is_finite() && parsed > 0.0 {
        Some(parsed)
    } else {
        None
    }
}

/// Pick a seek point inside the clip.
///
/// Bounded to the middle 80% so the choice never lands on the leading
/// or trailing frames, which are the ones most likely to be blank. An
/// unknown duration seeks to 0: the only safe offset for a clip whose
/// length we could not determine.
fn random_seek_offset(duration: Option<f64>) -> f64 {
    let Some(duration) = duration else {
        return 0.0;
    };
    let lower = duration * 0.1;
    let upper = duration * 0.9;
    if upper <= lower {
        return 0.0;
    }
    rand::thread_rng().gen_range(lower..upper)
}

#[cfg(test)]
mod tests {
    use super::*;
    use image::{ImageBuffer, Rgba};

    fn png_bytes(width: u32, height: u32) -> Vec<u8> {
        let buffer: ImageBuffer<Rgba<u8>, Vec<u8>> =
            ImageBuffer::from_fn(width, height, |x, y| {
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
        assert_eq!(classify(Some("image/png"), "user/a/b/x.bin"), MediaKind::Image);
        assert_eq!(classify(Some("video/mp4"), "user/a/b/x.bin"), MediaKind::Video);
        assert_eq!(classify(Some("audio/mpeg"), "user/a/b/x.bin"), MediaKind::Audio);
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
            thumbnail_key_for("user/app-1/res-1/photo.png").unwrap(),
            "user/app-1/res-1/thumbnail.png"
        );
        assert_eq!(
            thumbnail_key_for("user/app-1/res-1/clip.mp4").unwrap(),
            "user/app-1/res-1/thumbnail.png"
        );
        // A key with no directory has nowhere to put a sibling.
        assert!(thumbnail_key_for("photo.png").is_err());
    }

    #[test]
    fn image_thumbnail_fits_inside_the_bounding_box_and_keeps_aspect() {
        let source = png_bytes(1600, 800);
        let (png, width, height) = encode_image_thumbnail(&source).expect("thumbnail");

        assert_eq!(width, THUMBNAIL_MAX_EDGE);
        assert_eq!(height, THUMBNAIL_MAX_EDGE / 2, "aspect ratio must be preserved");
        assert!(png.starts_with(&[0x89, b'P', b'N', b'G']), "output must be PNG");
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

    #[test]
    fn seek_offset_stays_inside_the_middle_of_the_clip() {
        for _ in 0..64 {
            let offset = random_seek_offset(Some(100.0));
            assert!(
                (10.0..90.0).contains(&offset),
                "offset {offset} escaped the middle 80%"
            );
        }
        // Unknown or degenerate durations seek to the start.
        assert_eq!(random_seek_offset(None), 0.0);
        assert_eq!(random_seek_offset(Some(0.0)), 0.0);
    }
}
