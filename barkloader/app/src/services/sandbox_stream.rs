//! Production `StreamClient` for sandbox runtimes. Blocks on the current Tokio
//! runtime handle, as `HttpResourceClient` does and for the same reason.

use lib_module::db_proxy;
use lib_sandbox::host::StreamClient;
use tokio::runtime::Handle;

pub struct HttpStreamClient {
    db_proxy_url: String,
}

impl HttpStreamClient {
    pub fn new(db_proxy_url: String) -> Self {
        Self { db_proxy_url }
    }
}

impl StreamClient for HttpStreamClient {
    fn is_live(&self) -> Result<bool, String> {
        Handle::current()
            .block_on(db_proxy::is_stream_live(&self.db_proxy_url))
            .map_err(|e| e.to_string())
    }
}
