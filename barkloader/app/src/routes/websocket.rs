use crate::types::AppContext;
use crate::websocket::WebSocketSession;
use actix_web::{
    Error, HttpRequest, HttpResponse, get, rt,
    web::{Data, Payload, ServiceConfig},
};

/// Authenticated by `middleware::service_auth`, like every management route:
/// the key travels only in the `Authorization` header, never in the URL,
/// where access logs and proxies would keep it.
#[get("/ws")]
#[tracing::instrument(name = "GET /ws", skip_all)]
async fn websocket_handler(
    ctx: Data<AppContext>,
    req: HttpRequest,
    stream: Payload,
) -> Result<HttpResponse, Error> {
    let (res, session, stream) = actix_ws::handle(&req, stream)?;
    let stream = stream
        .aggregate_continuations()
        .max_continuation_size(2_usize.pow(20));
    rt::spawn(async move {
        let socket = WebSocketSession::new(ctx.sandbox.clone());
        socket.handle_message(session, stream).await;
    });
    Ok(res)
}

pub fn configure(cfg: &mut ServiceConfig) {
    cfg.service(websocket_handler);
}
