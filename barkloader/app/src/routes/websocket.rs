use actix_web::{get, web::{Data, Payload, ServiceConfig, Query}, HttpRequest, HttpResponse, Error, rt};
use actix_web::http::header;
use serde::Deserialize;
use crate::types::AppContext;
use crate::websocket::WebSocketSession;
use crate::util::get_env_or_default;

#[derive(Deserialize)]
struct WsQueryParams {
    token: Option<String>,
}

fn validate_token(token: &str, expected_key: &str) -> bool {
    token == expected_key
}

fn extract_token(req: &HttpRequest, query: &WsQueryParams) -> Option<String> {
    if let Some(ref token) = query.token {
        return Some(token.clone());
    }
    if let Some(auth_header) = req.headers().get(header::AUTHORIZATION) {
        if let Ok(auth_str) = auth_header.to_str() {
            if let Some(bearer) = auth_str.strip_prefix("Bearer ") {
                return Some(bearer.to_string());
            }
        }
    }
    None
}

#[get("/ws")]
async fn websocket_handler(
    ctx: Data<AppContext>,
    req: HttpRequest,
    query: Query<WsQueryParams>,
    stream: Payload,
) -> Result<HttpResponse, Error> {
    let expected_key = get_env_or_default("WOOFX3_BARKLOADER_KEY", "");
    if expected_key.is_empty() {
        log::warn!("WOOFX3_BARKLOADER_KEY not configured - rejecting WebSocket connection");
        return Ok(HttpResponse::Unauthorized()
            .body("Server not configured with authentication key"));
    }

    let token = match extract_token(&req, &query) {
        Some(t) => t,
        None => {
            return Ok(HttpResponse::Unauthorized()
                .body("Missing authentication token. Provide ?token=xxx or Authorization: Bearer xxx"));
        }
    };

    if !validate_token(&token, &expected_key) {
        log::warn!("Invalid WebSocket authentication token");
        return Ok(HttpResponse::Unauthorized()
            .body("Invalid authentication token"));
    }

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