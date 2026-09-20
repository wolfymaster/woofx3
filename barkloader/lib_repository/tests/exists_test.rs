//! `exists()` against an S3-compatible backend.
//!
//! Runs offline against a socket that answers `head_object` with a canned
//! status, because what is under test is how a response is classified, not
//! what a bucket holds. A miss must be an answer (`Ok(false)`); anything else
//! must stay an error.

use lib_repository::{Repository, S3Repository, S3RepositoryConfig};
use tokio::io::{AsyncReadExt, AsyncWriteExt};
use tokio::net::TcpListener;

/// Answer every request with `status`, mimicking a backend that reports a
/// missing key with no body and no error code -- which is what R2 does, and
/// what the SDK renders as the bare string "service error".
async fn serve(status: &'static str) -> String {
    let listener = TcpListener::bind("127.0.0.1:0").await.expect("bind");
    let addr = listener.local_addr().expect("addr");
    tokio::spawn(async move {
        loop {
            let Ok((mut socket, _)) = listener.accept().await else {
                return;
            };
            tokio::spawn(async move {
                // Read whatever the client sends; the request itself does not
                // matter, only that it is drained before the reply.
                let mut buffer = [0u8; 4096];
                let _ = socket.read(&mut buffer).await;
                let _ = socket
                    .write_all(
                        format!(
                            "HTTP/1.1 {status}\r\ncontent-length: 0\r\nconnection: close\r\n\r\n"
                        )
                        .as_bytes(),
                    )
                    .await;
                let _ = socket.shutdown().await;
            });
        }
    });
    format!("http://{addr}")
}

async fn repo_against(endpoint: String) -> S3Repository {
    S3Repository::new(S3RepositoryConfig {
        bucket: "woofx3-test".to_string(),
        prefix: None,
        region: Some("auto".to_string()),
        endpoint: Some(endpoint),
        access_key: Some("AKIAIOSFODNN7EXAMPLE".to_string()),
        secret_key: Some("wJalrXUtnFEMI/K7MDENG/bPxRfiCYEXAMPLEKEY".to_string()),
        force_path_style: true,
    })
    .await
    .expect("construct S3Repository")
}

#[tokio::test]
async fn a_missing_key_is_reported_as_absent_not_as_a_failure() {
    let repo = repo_against(serve("404 Not Found").await).await;

    let found = repo
        .exists("user/app-1/res-1/photo.png")
        .await
        .expect("a missing key must answer, not error");

    assert!(!found);
}

#[tokio::test]
async fn a_present_key_is_reported_as_present() {
    let repo = repo_against(serve("200 OK").await).await;

    assert!(
        repo.exists("user/app-1/res-1/photo.png")
            .await
            .expect("head_object succeeded")
    );
}

#[tokio::test]
async fn a_refused_request_stays_an_error() {
    let repo = repo_against(serve("403 Forbidden").await).await;

    // Bad credentials must never be mistaken for "the key is free": that would
    // let an upload overwrite an object it could not see.
    assert!(repo.exists("user/app-1/res-1/photo.png").await.is_err());
}

#[tokio::test]
async fn an_unreachable_backend_stays_an_error() {
    // Nothing is listening: a transport failure carries no status to classify.
    let repo = repo_against("http://127.0.0.1:1".to_string()).await;

    assert!(repo.exists("user/app-1/res-1/photo.png").await.is_err());
}
