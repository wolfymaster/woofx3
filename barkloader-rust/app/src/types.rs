use lib_repository::{RepositoryImpl};
use lib_sandbox::SandboxFactory;

#[derive(Clone)]
pub struct AppContext {
    pub repository: RepositoryImpl,
    pub sandbox: SandboxFactory,
}
