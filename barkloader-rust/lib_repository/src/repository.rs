use anyhow::Result;
use std::path::{Path, PathBuf};
use async_trait::async_trait;
use enum_dispatch::enum_dispatch;
use crate::repositories::file::{FileRepository, FileRepositoryConfig};
use crate::repositories::s3::{S3Repository, S3RepositoryConfig};

#[derive(Debug, Clone)]
pub enum RepositoryConfig {
    File(FileRepositoryConfig),
    S3(S3RepositoryConfig),
}

#[derive(Debug, Clone)]
// pub enum CreateFileRequest {
//     File {
//         content: Option<Vec<u8>>,
//         file_name: String,
//         extension: Option<String>,
//     },
//     Directory {
//         directory_path: PathBuf,
//     },
// }

pub struct CreateFileRequest {
    content: Option<Vec<u8>>,
    file_name: String,
    extension: Option<String>,
}

struct Module {
    module_name: String,
    function_name: String,
    function_entrypoint: String,
    
}

pub struct Idk {
    module: Module,
}

#[async_trait]
#[enum_dispatch(RepositoryImpl)]
pub trait Repository {
    fn setup(&self) -> Result<()>;
    async fn list<P: AsRef<Path> + Send>(&self, path: P) -> Result<()>;
    async fn create<I: IntoIterator<Item = CreateFileRequest> + Send>(&self, req: I) -> Result<()>;
}

#[enum_dispatch]
#[derive(Clone)]
pub enum RepositoryImpl {
    File(FileRepository),
    S3(S3Repository),
}

pub struct RepositoryFactory {}
impl RepositoryFactory {
    pub async fn new(config: &RepositoryConfig) -> RepositoryImpl {
        match config {
            RepositoryConfig::File(file_config) => RepositoryImpl::File(FileRepository::new(FileRepositoryConfig {
                destination: file_config.destination.clone(),
            })),
            RepositoryConfig::S3(s3_config) => RepositoryImpl::S3(S3Repository::new(S3RepositoryConfig {}).await),
        }
    }
}
