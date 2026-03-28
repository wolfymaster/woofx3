use thiserror::Error;

#[derive(Error, Debug)]
pub enum Error {
    #[error("IO error: {0}")]
    IoError(#[from] std::io::Error),

    #[error("JSON error: {0}")]
    JsonError(#[from] serde_json::Error),

    #[error("Lua error: {0}")]
    LuaError(#[from] mlua::Error),

    #[error("QuickJS error: {0}")]
    QuickJSError(String),

    #[error("Modules directory not found")]
    ModulesDirNotFound,

    #[error("Module not found: {0}")]
    ModuleNotFound(String),

    #[error("Module disabled: {0}")]
    ModuleDisabled(String),

    #[error("Function not found: {0}")]
    FunctionNotFound(String),

    #[error("Invalid module name")]
    InvalidModuleName,

    #[error("Invalid function name")]
    InvalidFunctionName,

    #[error("Invalid function path: {0}")]
    InvalidFunctionPath(String),

    #[error("Unknown function type")]
    UnknownFunctionType,

    #[error("Unsupported runtime: {0}")]
    UnsupportedRuntime(String),

    #[error("Runtime execution error: {0}")]
    RuntimeError(String),

    #[error("Execution timeout")]
    ExecutionTimeout,

    #[error("Memory limit exceeded")]
    MemoryLimitExceeded,

    #[error("Instruction limit exceeded")]
    InstructionLimitExceeded,
}
