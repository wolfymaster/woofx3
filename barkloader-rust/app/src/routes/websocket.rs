use actix_web::{get, web::{Data, Payload, ServiceConfig}, HttpRequest, HttpResponse, Error, rt};
use crate::types::AppContext;
use crate::websocket::WebSocketSession;

#[get("/ws")]
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
        let sandbox = ctx.sandbox.create().expect("Failed to create sandbox");
        let socket = WebSocketSession::new(sandbox);
        socket.handle_message(session, stream).await;
    });
    Ok(res)
}

pub fn configure(cfg: &mut ServiceConfig) {
    cfg.service(websocket_handler);
}