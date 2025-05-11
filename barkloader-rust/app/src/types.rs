use lib_repository::{RepositoryConfig, RepositoryType};
use lib_sandbox::SandboxFactory;

#[derive(Clone)]
pub struct AppContext {
    pub repository: RepositoryContext,
    pub sandbox: SandboxFactory,
}

#[derive(Clone)]
pub struct RepositoryContext {
    pub config: RepositoryConfig,
    pub kind: RepositoryType,
}