use crate::util::{
    get_env_or_default, get_env_or_default_with_key, get_woofx3_json_value,
    validate_required_config, validate_required_woofx3_json_keys,
};
use actix_web::{App, HttpServer, middleware::Logger, web::Data};
use anyhow::Result;
use lib_repository::{Repository, RepositoryFactory, RepositoryImpl};
use lib_sandbox::extensions::{
    ChatExtension, PlatformAlertsExtension, PlatformChatExtension, TwitchExtension,
};
use lib_sandbox::host::noop::{noop_host_context, NoopChatSender};
use lib_sandbox::host::{ChatSender, ExtensionRegistry};
use crate::services::env_reader::OsEnvReader;
use crate::services::http_client::ReqwestHttpClient;
use crate::services::http_storage_client::HttpStorageClient;
use lib_module::db_proxy::RequestContext as DbRequestContext;
use crate::services::sandbox_resources::HttpResourceClient;
use lib_sandbox::{ModuleRegistry, SandboxFactory};
use tracing::{info, warn};
use std::sync::Arc;
use types::{AppContext, SharedRepository};

mod bundled_modules;
mod callback;
mod errors;
mod routes;
mod services;
mod types;
mod util;
mod websocket;
const DEFAULT_MODULE_DIR: &str = "modules";
const SERVICE_NAME: &str = "barkloader";

async fn setup() -> Result<AppContext> {
    let registry = Arc::new(ModuleRegistry::new());

    // Capture the raw async_nats::Client alongside the host context so we can
    // subscribe to NATS subjects directly (not just publish via NatsPublisher).
    let mut nats_raw_client: Option<async_nats::Client> = None;

    let host_ctx = {
        let mut ctx = noop_host_context();

        let mut chat_sender: Arc<dyn ChatSender> = Arc::new(NoopChatSender);

        let messagebus_url = get_env_or_default_with_key("MESSAGEBUS_URL", Some("messagebusUrl"), "");
        if !messagebus_url.is_empty() {
            match crate::services::nats::NatsService::connect(&messagebus_url).await {
                Ok(nats) => {
                    info!("Connected to messagebus at {}", messagebus_url);
                    nats_raw_client = Some(nats.raw_client().clone());
                    chat_sender = Arc::new(crate::services::chat::BusChatSender::new(
                        nats.clone(),
                        "twitch",
                    ));
                    ctx.nats = nats;
                }
                Err(e) => {
                    warn!("Failed to connect to messagebus: {}; falling back to noop publisher", e);
                }
            }
        } else {
            info!("messagebusUrl not set; using noop NATS publisher and noop chat sender");
        }

        // Platform integrations (twitch / streamlabs / platform.chat / chat)
        // are bound through the extension registry. Each extension owns its
        // own Arc<dyn …> of the relevant transport, so the runtime adapters
        // stay agnostic to which platforms exist.
        ctx.extensions = Arc::new(
            ExtensionRegistry::new()
                .with(Arc::new(TwitchExtension::new(ctx.nats.clone())))
                .with(Arc::new(PlatformAlertsExtension::new(ctx.nats.clone())))
                .with(Arc::new(PlatformChatExtension::new(ctx.nats.clone())))
                .with(Arc::new(ChatExtension::new(chat_sender))),
        );

        // Resource-instance lifecycle (`ctx.resources.*`) and module storage
        // (`ctx.storage.*`) — both backed by db-proxy via Twirp. Bound with
        // the engine's own applicationId: today one barkloader process
        // serves exactly one application, so a single startup-time value
        // (rather than a per-invocation one) correctly scopes both.
        let resource_proxy_url = get_woofx3_json_value("databaseProxyUrl", "");
        let application_id = get_woofx3_json_value("applicationId", "");
        if application_id.is_empty() {
            warn!("applicationId not set in .woofx3.json; ctx.resources/ctx.storage calls will be unscoped");
        }
        if !resource_proxy_url.is_empty() {
            info!(
                "Wiring HttpResourceClient/HttpStorageClient against db-proxy {}",
                resource_proxy_url
            );
            ctx.resources = Arc::new(
                HttpResourceClient::new(resource_proxy_url.clone()).with_request_context(DbRequestContext {
                    client_id: String::new(),
                    application_id: application_id.clone(),
                    module_key: String::new(),
                }),
            );
            ctx.settings = Arc::new(
                crate::services::module_settings_client::HttpSettingsClient::new(resource_proxy_url.clone())
            );
            ctx.storage = Arc::new(HttpStorageClient::new(resource_proxy_url, application_id));
        } else {
            info!("databaseProxyUrl not set in .woofx3.json; using noop resource, settings, and storage clients");
        }

        ctx.env = Arc::new(OsEnvReader);
        ctx.http = Arc::new(ReqwestHttpClient::new());

        ctx
    };

    let sandbox = SandboxFactory::new(registry.clone(), host_ctx);

    let scheduler = Arc::new(services::background_scheduler::BackgroundTaskScheduler::new(
        sandbox.clone(),
    ));

    // db-proxy is required: sandbox registry metadata comes from module_functions
    // rows, and the storage provider is resolved from the engine's settings table.
    // Establish the connection before reading either -- everything below this point
    // treats db-proxy as available, the same contract the Go and TypeScript runtimes
    // give their applications by gating init behind the registered `db` service.
    let db_proxy_url = get_woofx3_json_value("databaseProxyUrl", "");
    if db_proxy_url.is_empty() {
        anyhow::bail!("databaseProxyUrl in .woofx3.json is required for barkloader");
    }
    crate::services::storage_settings::wait_for_db_proxy(&db_proxy_url).await;

    let repository_config = crate::services::storage_settings::resolve_repository_config(
        Some(db_proxy_url.as_str()),
        DEFAULT_MODULE_DIR,
    )
    .await?;

    let repository = RepositoryFactory::new(&repository_config).await?;
    repository.setup()?;
    // Wrapped so `routes::storage` can swap the backend when an operator
    // edits storage settings in the UI. Boot resolves the first value; it
    // is not necessarily the last.
    let repository = SharedRepository::new(repository);

    let default_public_url = get_woofx3_json_value("barkloaderUrl", "");
    let public_url_resolver = Arc::new(services::public_url::PublicUrlResolver::new(
        Some(db_proxy_url.clone()),
        default_public_url,
    ));

    // Bundled modules must be installed before the registry is built from
    // installed modules, and before any service resolves a system canonical
    // id. A bundled module that will not install is fatal: the engine's core
    // actions and triggers come from it, and starting anyway is what produces
    // the silent, hard-to-diagnose failures this replaces.
    match services::bundled_reconciler::reconcile(&db_proxy_url, &*repository.current()).await {
        Ok(outcomes) => {
            for (id, outcome) in outcomes {
                match outcome {
                    services::bundled_reconciler::Outcome::UpToDate => {
                        tracing::debug!(module_id = %id, "bundled module already current");
                    }
                    services::bundled_reconciler::Outcome::Installed { version } => {
                        tracing::info!(module_id = %id, version = %version, "bundled module installed");
                    }
                }
            }
        }
        Err(e) => {
            tracing::error!("bundled module reconciliation failed: {e:#}");
            return Err(e);
        }
    }

    boot_modules(&registry, &repository.current(), &db_proxy_url, &scheduler).await?;

    // Spawn the generic field-options NATS responder when NATS is available.
    if let Some(raw_client) = nats_raw_client {
        tokio::spawn(services::field_options::run_field_options_responder(
            raw_client,
            sandbox.clone(),
        ));
    }

    let ctx = AppContext {
        repository,
        sandbox,
        registry,
        db_proxy_url: Some(db_proxy_url),
        scheduler,
        public_url_resolver,
    };

    Ok(ctx)
}

async fn boot_modules(
    registry: &Arc<ModuleRegistry>,
    repository: &RepositoryImpl,
    db_proxy_url: &str,
    scheduler: &Arc<services::background_scheduler::BackgroundTaskScheduler>,
) -> Result<()> {
    lib_module::registry_loader::hydrate_registry_from_db(
        registry,
        db_proxy_url,
        repository,
        scheduler,
    )
    .await
    .map_err(|e| anyhow::anyhow!("sandbox registry hydrate: {}", e))
}

#[actix_web::main]
async fn main() -> std::io::Result<()> {
    // Console + file logging always; OpenTelemetry export only when configured.
    // The guard flushes the file writer and the OTel providers when main returns.
    let logging = match woofx3_logging::init(SERVICE_NAME) {
        Ok(guard) => guard,
        Err(e) => {
            eprintln!("failed to initialize logging: {}", e);
            std::process::exit(1);
        }
    };

    // Validate required config. Each fatal path drops the guard first so the
    // file and OpenTelemetry sinks flush before the process goes away.
    if let Err(e) = validate_required_config(&["WOOFX3_BARKLOADER_KEY"]) {
        tracing::error!("{}", e);
        drop(logging);
        std::process::exit(1);
    }
    if let Err(e) = validate_required_woofx3_json_keys(&["databaseProxyUrl"]) {
        tracing::error!("{}", e);
        drop(logging);
        std::process::exit(1);
    }

    // setup
    let ctx = setup().await.expect("Failed to complete set up");

    let host = String::from("127.0.0.1");
    let port = get_env_or_default("BARKLOADER_PORT", "9653");
    let bind_addr = format!("{}:{}", host, port);

    // Start HTTP server
    info!("Starting server on {}", bind_addr);
    HttpServer::new(move || {
        App::new()
            .app_data(Data::new(ctx.clone()))
            // The assets route depends only on the repository, not the
            // full AppContext, so it gets its own Data registration. It
            // shares the same swappable handle, so a storage reload takes
            // effect here too rather than pinning a stale backend.
            .app_data(Data::new(ctx.repository.clone()))
            .wrap(Logger::default()) // Use default format
            .configure(routes::assets::configure)
            .configure(routes::resources::configure)
            .configure(routes::storage::configure)
            .configure(routes::echo::configure)
            .configure(routes::websocket::configure)
            .configure(routes::functions::configure)
            .configure(routes::widgets::configure)
    })
    .bind(bind_addr)?
    .shutdown_timeout(5)
    .run()
    .await
}
