use actix_web::web::{Data, Json, Path, ServiceConfig};
use actix_web::{Error, HttpResponse, post};
use serde::Deserialize;
use serde_json::json;
use tracing::warn;

use crate::services::oauth::Authorization;
use crate::types::AppContext;

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct CompleteBody {
    code: String,
    code_verifier: String,
    redirect_uri: String,
    #[serde(default)]
    client_id: Option<String>,
    #[serde(default)]
    token_url: Option<String>,
}

/// Finish connecting a module's OAuth integration: exchange the code the
/// dashboard collected and keep the tokens (`services::oauth`). The api
/// service calls this for the dashboard (`completeModuleOAuth`). The answer
/// carries the granted scopes, never a token.
#[post("/modules/{module_id}/oauth/{integration}/complete")]
#[tracing::instrument(
    name = "POST /modules/{module_id}/oauth/{integration}/complete",
    skip_all
)]
async fn complete_handler(
    ctx: Data<AppContext>,
    path: Path<(String, String)>,
    body: Json<CompleteBody>,
) -> Result<HttpResponse, Error> {
    let Some(oauth) = ctx.oauth.clone() else {
        return Ok(HttpResponse::ServiceUnavailable()
            .json(json!({ "error": "ctx.oauth is not available on this engine" })));
    };
    let (module_id, integration) = path.into_inner();
    let body = body.into_inner();
    let authorization = Authorization {
        code: body.code,
        code_verifier: body.code_verifier,
        redirect_uri: body.redirect_uri,
        client_id: body.client_id,
        token_url: body.token_url,
    };
    // The exchange blocks on HTTP and db-proxy calls, like a sandbox call.
    let outcome = tokio::task::spawn_blocking(move || {
        oauth.complete(&module_id, &integration, authorization)
    })
    .await
    .map_err(actix_web::error::ErrorInternalServerError)?;
    match outcome {
        Ok(scope) => Ok(HttpResponse::Ok().json(json!({ "connected": true, "scope": scope }))),
        Err(reason) => {
            warn!("OAuth connect failed: {reason}");
            Ok(HttpResponse::BadRequest().json(json!({ "error": reason })))
        }
    }
}

pub fn configure(cfg: &mut ServiceConfig) {
    cfg.service(complete_handler);
}
