use crate::util::{
    get_env_or_default, get_env_or_default_with_key, get_woofx3_json_value,
    validate_required_config, validate_required_woofx3_json_keys,
};
use actix_web::{App, HttpServer, middleware::Logger, web::Data};
use anyhow::Result;
use env_logger::Env;
use lib_repository::{Repository, RepositoryFactory, RepositoryImpl};
use futures::executor::block_on;
use lib_sandbox::extensions::{
    ChatExtension, PlatformAlertsExtension, PlatformChatExtension, TwitchExtension,
};
use lib_sandbox::host::grpc::GrpcStorageClient;
use lib_sandbox::host::noop::{noop_host_context, NoopChatSender};
use lib_sandbox::host::{ChatSender, ExtensionRegistry};
use crate::services::env_reader::OsEnvReader;
use crate::services::http_client::ReqwestHttpClient;
use crate::services::sandbox_resources::HttpResourceClient;
use lib_sandbox::{ModuleRegistry, SandboxFactory};
use log::{info, warn};
use std::sync::Arc;
use types::AppContext;

mod errors;
mod routes;
mod services;
mod types;
mod util;
mod websocket;
const DEFAULT_MODULE_DIR: &str = "modules";

async fn setup() -> Result<AppContext> {
    let registry = Arc::new(ModuleRegistry::new());

    // Capture the raw async_nats::Client alongside the host context so we can
    // subscribe to NATS subjects directly (not just publish via NatsPublisher).
    let mut nats_raw_client: Option<async_nats::Client> = None;

    let host_ctx = {
        let mut ctx = noop_host_context();

        let storage_addr = get_env_or_default("STORAGE_ADDR", "");
        if !storage_addr.is_empty() {
            match block_on(GrpcStorageClient::new(storage_addr.clone(), String::new())) {
                Ok(client) => {
                    info!("Connected to storage service at {}", storage_addr);
                    ctx.storage = Arc::new(client);
                }
                Err(e) => {
                    warn!("Failed to connect to storage service: {}; falling back to noop", e);
                }
            }
        } else {
            info!("STORAGE_ADDR not set; using noop storage client");
        }

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

        // Resource-instance lifecycle (`ctx.resources.*`) — backed by db-proxy via Twirp.
        let resource_proxy_url = get_woofx3_json_value("databaseProxyUrl", "");
        if !resource_proxy_url.is_empty() {
            info!(
                "Wiring HttpResourceClient against db-proxy {}",
                resource_proxy_url
            );
            ctx.resources = Arc::new(HttpResourceClient::new(resource_proxy_url));
        } else {
            info!("databaseProxyUrl not set in .woofx3.json; using noop resource client");
        }

        ctx.env = Arc::new(OsEnvReader);
        ctx.http = Arc::new(ReqwestHttpClient::new());

        ctx
    };

    let builtin_dispatcher: Arc<dyn lib_sandbox::BuiltinDispatcher> = {
        let message_bus: Arc<dyn services::builtin_actions::MessageBusPublisher> = Arc::new(
            services::builtin_actions::adapters::NatsMessageBusPublisher::new(host_ctx.nats.clone()),
        );
        let logger: Arc<dyn services::builtin_actions::Logger> =
            Arc::new(services::builtin_actions::adapters::LogCrateLogger);
        Arc::new(services::builtin_actions::bridge::BuiltinActionBridge::new(
            message_bus, logger,
        ))
    };

    let sandbox = SandboxFactory::new(registry.clone(), host_ctx)
        .with_builtin_dispatcher(builtin_dispatcher);

    let scheduler = Arc::new(services::background_scheduler::BackgroundTaskScheduler::new(
        sandbox.clone(),
    ));

    // db-proxy is required: sandbox registry metadata comes from module_functions rows.
    let db_proxy_url = get_woofx3_json_value("databaseProxyUrl", "");
    if db_proxy_url.is_empty() {
        anyhow::bail!("databaseProxyUrl in .woofx3.json is required for barkloader");
    }

    let repository_config = crate::services::storage_settings::resolve_repository_config(
        Some(db_proxy_url.as_str()),
        DEFAULT_MODULE_DIR,
    )
    .await?;

    let repository = RepositoryFactory::new(&repository_config).await?;
    repository.setup()?;

    boot_modules(&registry, &repository, &db_proxy_url, &scheduler).await?;

    // Register compile-time built-in actions (see builtin_actions::REGISTRY).
    if let Err(e) =
        services::builtin_actions::autoload::register_builtin_actions(&db_proxy_url).await
    {
        warn!("Failed to register builtin actions: {:?}", e);
    }

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
    };

    Ok(ctx)
}

async fn boot_modules(
    registry: &Arc<ModuleRegistry>,
    repository: &RepositoryImpl,
    db_proxy_url: &str,
    scheduler: &Arc<services::background_scheduler::BackgroundTaskScheduler>,
) -> Result<()> {
    crate::services::module_service::registry_loader::hydrate_registry_from_db(
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
    // Initialize env_logger
    env_logger::init_from_env(Env::default().default_filter_or("info"));

    // Validate required config
    if let Err(e) = validate_required_config(&["WOOFX3_BARKLOADER_KEY"]) {
        log::error!("{}", e);
        std::process::exit(1);
    }
    if let Err(e) = validate_required_woofx3_json_keys(&["databaseProxyUrl"]) {
        log::error!("{}", e);
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
            // full AppContext, so it gets its own Data registration.
            .app_data(Data::new(ctx.repository.clone()))
            .wrap(Logger::default()) // Use default format
            .configure(routes::assets::configure)
            .configure(routes::echo::configure)
            .configure(routes::websocket::configure)
            .configure(routes::functions::configure)
    })
    .bind(bind_addr)?
    .shutdown_timeout(5)
    .run()
    .await
}
