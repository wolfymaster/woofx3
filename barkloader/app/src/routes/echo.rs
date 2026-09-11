use actix_web::{Responder, get, web::ServiceConfig};

#[get("/echo")]
#[tracing::instrument(name = "GET /echo")]
async fn echo_handler() -> impl Responder {
    "Hello, Wolfy!"
}

pub fn configure(cfg: &mut ServiceConfig) {
    cfg.service(echo_handler);
}
