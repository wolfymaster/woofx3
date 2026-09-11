//! Upload-grant behavior for both storage backends.
//!
//! Presigning is pure local computation -- signing a URL never contacts
//! S3 -- so these run offline against static credentials.

use std::time::Duration;

use lib_repository::{
    FileRepository, FileRepositoryConfig, Repository, S3Repository, S3RepositoryConfig,
    UploadEndpoint, UploadRequest,
};

fn s3_config() -> S3RepositoryConfig {
    S3RepositoryConfig {
        bucket: "woofx3-test".to_string(),
        prefix: None,
        region: Some("us-east-1".to_string()),
        endpoint: None,
        access_key: Some("AKIAIOSFODNN7EXAMPLE".to_string()),
        secret_key: Some("wJalrXUtnFEMI/K7MDENG/bPxRfiCYEXAMPLEKEY".to_string()),
        force_path_style: false,
    }
}

async fn s3_repo(config: S3RepositoryConfig) -> S3Repository {
    S3Repository::new(config)
        .await
        .expect("construct S3Repository")
}

#[tokio::test]
async fn file_backend_reports_it_cannot_sign() {
    let dir = tempfile::tempdir().expect("tempdir");
    let repo = FileRepository::new(FileRepositoryConfig {
        destination: dir.path().to_path_buf(),
    });

    let grant = repo
        .presign_upload(UploadRequest {
            key: "user/app-1/res-1/photo.png",
            content_type: Some("image/png"),
            ttl: Duration::from_secs(300),
        })
        .await
        .expect("file backend must answer, not error");

    // "I cannot sign" is a normal answer, not a failure -- the caller
    // falls back to its own upload endpoint.
    assert_eq!(grant, UploadEndpoint::Unsupported);
}

#[tokio::test]
async fn s3_backend_signs_a_put_url_for_the_key() {
    let repo = s3_repo(s3_config()).await;

    let grant = repo
        .presign_upload(UploadRequest {
            key: "user/app-1/res-1/photo.png",
            content_type: Some("image/png"),
            ttl: Duration::from_secs(300),
        })
        .await
        .expect("presign");

    let UploadEndpoint::Presigned { url, headers } = grant else {
        panic!("S3 backend must presign, got {grant:?}");
    };
    assert!(url.starts_with("https://"), "presigned url was {url}");
    assert!(
        url.contains("user/app-1/res-1/photo.png"),
        "presigned url must address the requested key: {url}"
    );
    assert!(
        url.contains("X-Amz-Signature="),
        "presigned url must carry a signature: {url}"
    );
    assert!(
        url.contains("X-Amz-Expires=300"),
        "presigned url must carry the requested TTL: {url}"
    );
    // Only signature-covered headers are echoed back; sending an extra
    // header would break the signature the client is handed.
    assert_eq!(
        headers,
        vec![("Content-Type".to_string(), "image/png".to_string())]
    );
}

#[tokio::test]
async fn s3_presign_applies_the_configured_prefix() {
    let mut config = s3_config();
    config.prefix = Some("prod".to_string());
    let repo = s3_repo(config).await;

    let grant = repo
        .presign_upload(UploadRequest {
            key: "user/app-1/res-1/clip.mp4",
            content_type: Some("video/mp4"),
            ttl: Duration::from_secs(60),
        })
        .await
        .expect("presign");

    let UploadEndpoint::Presigned { url, .. } = grant else {
        panic!("expected a presigned grant");
    };
    assert!(
        url.contains("prod/user/app-1/res-1/clip.mp4"),
        "presigned key must go through full_key(): {url}"
    );
}

#[tokio::test]
async fn s3_presign_without_content_type_returns_no_headers() {
    let repo = s3_repo(s3_config()).await;

    let grant = repo
        .presign_upload(UploadRequest {
            key: "user/app-1/res-1/blob.bin",
            content_type: None,
            ttl: Duration::from_secs(60),
        })
        .await
        .expect("presign");

    let UploadEndpoint::Presigned { headers, .. } = grant else {
        panic!("expected a presigned grant");
    };
    assert!(
        headers.is_empty(),
        "no content type means no required headers"
    );
}

#[tokio::test]
async fn s3_presign_signature_is_bound_to_the_key() {
    let repo = s3_repo(s3_config()).await;

    let one = repo
        .presign_upload(UploadRequest {
            key: "user/app-1/res-1/a.png",
            content_type: Some("image/png"),
            ttl: Duration::from_secs(300),
        })
        .await
        .expect("presign a");
    let two = repo
        .presign_upload(UploadRequest {
            key: "user/app-1/res-2/b.png",
            content_type: Some("image/png"),
            ttl: Duration::from_secs(300),
        })
        .await
        .expect("presign b");

    assert_ne!(
        one, two,
        "a grant for one key must not be reusable for another"
    );
}
