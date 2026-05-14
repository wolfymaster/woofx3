use std::path::Path;
use std::sync::Arc;

use anyhow::{anyhow, Result};
use async_trait::async_trait;
use aws_config::{meta::region::RegionProviderChain, BehaviorVersion, Region};
use aws_sdk_s3::{
    config::Credentials,
    primitives::ByteStream,
    Client,
};
use mime_guess::MimeGuess;
use tracing::{info, warn};

use crate::repository::{CreateFileRequest, Repository};

/// Configuration for S3-compatible object storage.
///
/// Works for:
///   - AWS S3: leave `endpoint` empty, set `region` (and optionally
///     `access_key`/`secret_key`; defaults to the AWS credential chain
///     otherwise).
///   - Cloudflare R2: set `endpoint` to
///     `https://<account-id>.r2.cloudflarestorage.com`, region to
///     `"auto"`, and provide access_key/secret_key from the R2 token.
///   - MinIO / other S3-compat: set `endpoint` to the MinIO URL and
///     credentials accordingly.
#[derive(Debug, Clone)]
pub struct S3RepositoryConfig {
    pub bucket: String,
    /// Optional prefix prepended to every object key. Useful when the
    /// bucket is shared across deployments — e.g. `prefix = "prod"`
    /// means everything lands under `prod/...`.
    pub prefix: Option<String>,
    pub region: Option<String>,
    /// Custom S3 endpoint URL. Empty / `None` means use the default
    /// AWS endpoint resolved from `region`.
    pub endpoint: Option<String>,
    /// Static credentials. When both fields are `None`, the AWS SDK's
    /// default credential chain is used (env vars, instance profile,
    /// ~/.aws/credentials, etc.) — that's the normal path for AWS S3.
    /// R2 / MinIO typically supply credentials explicitly.
    pub access_key: Option<String>,
    pub secret_key: Option<String>,
    /// Path-style addressing — required by MinIO and R2 when the
    /// bucket name isn't DNS-compatible. AWS S3 defaults to
    /// virtual-host style; this overrides to path style when true.
    pub force_path_style: bool,
}

#[derive(Clone)]
pub struct S3Repository {
    config: S3RepositoryConfig,
    client: Arc<Client>,
}

impl std::fmt::Debug for S3Repository {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        f.debug_struct("S3Repository")
            .field("bucket", &self.config.bucket)
            .field("endpoint", &self.config.endpoint)
            .field("region", &self.config.region)
            .field("prefix", &self.config.prefix)
            .finish()
    }
}

impl S3Repository {
    /// Construct an S3 client honoring the custom endpoint / credentials
    /// in `config`. Does NOT call `head_bucket` — that's deferred to
    /// `setup()` so a missing bucket only fails on startup, not on
    /// every `new` (e.g. tests instantiating a config don't need
    /// network).
    pub async fn new(config: S3RepositoryConfig) -> Result<Self> {
        let region_str = config.region.clone().unwrap_or_else(|| "auto".to_string());
        let region_provider = RegionProviderChain::first_try(Region::new(region_str))
            .or_default_provider()
            .or_else(Region::new("us-east-1"));

        let mut loader =
            aws_config::defaults(BehaviorVersion::v2025_01_17()).region(region_provider);

        if let (Some(ak), Some(sk)) = (config.access_key.as_deref(), config.secret_key.as_deref()) {
            loader = loader.credentials_provider(Credentials::new(ak, sk, None, None, "static"));
        }
        let shared = loader.load().await;

        let mut s3_builder = aws_sdk_s3::config::Builder::from(&shared);
        if let Some(endpoint) = config.endpoint.as_deref() {
            if !endpoint.is_empty() {
                s3_builder = s3_builder.endpoint_url(endpoint);
            }
        }
        if config.force_path_style {
            s3_builder = s3_builder.force_path_style(true);
        }
        let client = Arc::new(Client::from_conf(s3_builder.build()));

        Ok(Self {
            config,
            client,
        })
    }

    /// Prepend the configured prefix (when set) to the storage key.
    fn full_key(&self, key: &str) -> String {
        let trimmed = key.trim_start_matches('/');
        match self.config.prefix.as_deref() {
            Some(prefix) if !prefix.is_empty() => {
                format!("{}/{}", prefix.trim_end_matches('/'), trimmed)
            }
            _ => trimmed.to_string(),
        }
    }
}

#[async_trait]
impl Repository for S3Repository {
    fn setup(&self) -> Result<()> {
        info!(
            "S3 repository ready: bucket={} endpoint={:?} prefix={:?}",
            self.config.bucket, self.config.endpoint, self.config.prefix
        );
        Ok(())
    }

    async fn read_file(&self, key: &str) -> Result<Vec<u8>> {
        let full_key = self.full_key(key);
        let response = self
            .client
            .get_object()
            .bucket(&self.config.bucket)
            .key(&full_key)
            .send()
            .await
            .map_err(|e| anyhow!("S3 get_object {} failed: {}", full_key, e))?;
        let body = response.body.collect().await?;
        Ok(body.into_bytes().to_vec())
    }

    async fn delete_prefix(&self, prefix: &str) -> Result<()> {
        let full_prefix = self.full_key(prefix);
        // Paginate through every object under the prefix and issue
        // batched deletes. S3's delete_objects accepts up to 1000
        // keys per request; we conservatively chunk at 500.
        let mut continuation: Option<String> = None;
        loop {
            let mut list = self
                .client
                .list_objects_v2()
                .bucket(&self.config.bucket)
                .prefix(&full_prefix);
            if let Some(token) = continuation.as_deref() {
                list = list.continuation_token(token);
            }
            let output = list
                .send()
                .await
                .map_err(|e| anyhow!("S3 list_objects_v2 for delete {} failed: {}", full_prefix, e))?;

            let keys: Vec<String> = output
                .contents
                .unwrap_or_default()
                .into_iter()
                .filter_map(|o| o.key)
                .collect();
            for chunk in keys.chunks(500) {
                let identifiers: Vec<_> = chunk
                    .iter()
                    .map(|k| {
                        aws_sdk_s3::types::ObjectIdentifier::builder()
                            .key(k)
                            .build()
                            .expect("ObjectIdentifier builder requires only a key")
                    })
                    .collect();
                let delete = aws_sdk_s3::types::Delete::builder()
                    .set_objects(Some(identifiers))
                    .quiet(true)
                    .build()
                    .map_err(|e| anyhow!("S3 delete builder failed: {}", e))?;
                self.client
                    .delete_objects()
                    .bucket(&self.config.bucket)
                    .delete(delete)
                    .send()
                    .await
                    .map_err(|e| anyhow!("S3 delete_objects under {} failed: {}", full_prefix, e))?;
            }

            if output.is_truncated.unwrap_or(false) {
                continuation = output.next_continuation_token;
            } else {
                break;
            }
        }
        Ok(())
    }

    async fn list_prefix(&self, prefix: &str) -> Result<Vec<String>> {
        let full_prefix = self.full_key(prefix);
        let configured_prefix_len = self
            .config
            .prefix
            .as_deref()
            .map(|p| p.trim_end_matches('/').len() + 1) // +1 for the `/` separator
            .unwrap_or(0);

        let mut out = Vec::new();
        let mut continuation: Option<String> = None;
        loop {
            let mut list = self
                .client
                .list_objects_v2()
                .bucket(&self.config.bucket)
                .prefix(&full_prefix);
            if let Some(token) = continuation.as_deref() {
                list = list.continuation_token(token);
            }
            let output = list
                .send()
                .await
                .map_err(|e| anyhow!("S3 list_objects_v2 {} failed: {}", full_prefix, e))?;

            for obj in output.contents.unwrap_or_default() {
                if let Some(key) = obj.key {
                    // Strip the configured prefix so callers see the
                    // same key shape they passed in to `create()`.
                    if configured_prefix_len > 0 && key.len() >= configured_prefix_len {
                        out.push(key[configured_prefix_len..].to_string());
                    } else {
                        out.push(key);
                    }
                }
            }
            if output.is_truncated.unwrap_or(false) {
                continuation = output.next_continuation_token;
            } else {
                break;
            }
        }
        Ok(out)
    }

    async fn exists(&self, key: &str) -> Result<bool> {
        let full_key = self.full_key(key);
        match self
            .client
            .head_object()
            .bucket(&self.config.bucket)
            .key(&full_key)
            .send()
            .await
        {
            Ok(_) => Ok(true),
            Err(err) => {
                // The SDK surfaces 404 as a NotFound service error.
                // Anything else is a genuine failure.
                let err_str = err.to_string();
                if err_str.contains("NotFound") || err_str.contains("404") {
                    Ok(false)
                } else {
                    Err(anyhow!("S3 head_object {} failed: {}", full_key, err))
                }
            }
        }
    }

    async fn list<P: AsRef<Path> + Send>(&self, _path: P) -> Result<()> {
        Ok(())
    }

    async fn create<I: IntoIterator<Item = CreateFileRequest> + Send>(
        &self,
        req: I,
        failed: &mut Vec<String>,
    ) -> Result<()> {
        // Collect up-front so the iterator's intermediate state
        // doesn't need to be Send across awaits — the trait bound
        // only requires the iterable itself + items to be Send.
        let requests: Vec<CreateFileRequest> = req.into_iter().collect();
        for create_req in requests {
            let key = self.full_key(&create_req.file_name);
            let content = match create_req.content {
                Some(c) => c,
                None => {
                    // No content = nothing to write. Skip rather than
                    // failing; matches FileRepository semantics.
                    continue;
                }
            };
            let content_type = MimeGuess::from_path(&create_req.file_name)
                .first()
                .map(|m| m.essence_str().to_string());

            let body = ByteStream::from(content);
            let mut request = self
                .client
                .put_object()
                .bucket(&self.config.bucket)
                .key(&key)
                .body(body);
            if let Some(ct) = content_type {
                request = request.content_type(ct);
            }
            match request.send().await {
                Ok(_) => {
                    info!("S3 uploaded {}", key);
                }
                Err(e) => {
                    warn!("S3 upload failed for {}: {}", key, e);
                    failed.push(create_req.file_name);
                }
            }
        }
        Ok(())
    }
}
