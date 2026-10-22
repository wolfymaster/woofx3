use crate::services::http_client::{HttpPolicy, HttpPolicyMode, ReqwestHttpClient};
use crate::services::http_storage_client::HttpStorageClient;
use crate::services::oauth::{OAuthExtension, OAuthService, sealed_setting_writer};
use crate::services::sandbox_resources::HttpResourceClient;
use crate::util::{
    get_config_value, get_env_or_default, get_env_or_default_with_key, validate_required_config,
    validate_required_config_keys,
};
use actix_web::{App, HttpServer, web::Data};
use anyhow::Result;
use lib_module::db_proxy::RequestContext as DbRequestContext;
use lib_repository::{Repository, RepositoryFactory, RepositoryImpl};
use lib_sandbox::extensions::{ChatExtension, ObsExtension, TwitchExtension};
use lib_sandbox::host::noop::{NoopChatSender, NoopNatsRequester, noop_host_context};
use lib_sandbox::host::{ChatSender, ExtensionRegistry, NatsRequester};
use lib_sandbox::{ModuleRegistry, SandboxActionRunner, SandboxFactory};
use middleware::service_auth::{ALLOWED_HOST_CONFIG_KEY, ALLOWED_HOST_ENV_VAR, ServiceAuth};
use std::sync::Arc;
use std::time::{Duration, Instant};
use tracing::{info, warn};
use types::{AppContext, SharedRepository};
use woofx3_runtime::{SecretError, validate_secret};

mod bundled_modules;
mod callback;
mod middleware;
mod routes;
mod services;
mod types;
mod util;
mod websocket;
const DEFAULT_MODULE_DIR: &str = "modules";
const SERVICE_NAME: &str = "barkloader";

/// How long to wait for the message bus before giving up on it. The
/// orchestrator starts every service at once, so a refused connection at
/// startup means "not yet", not "never".
const MESSAGEBUS_WAIT: Duration = Duration::from_secs(60);
const MESSAGEBUS_RETRY_INTERVAL: Duration = Duration::from_secs(2);

/// Connect to the message bus, waiting for it to accept connections.
///
/// Without a bus barkloader publishes no readiness heartbeat, and anything
/// gating on that -- the api's GET /ready, and so a provisioner waiting on a
/// new engine -- waits forever. Retrying is what keeps a boot race from
/// becoming a permanently degraded engine.
async fn connect_messagebus(
    url: &str,
    token: Option<&str>,
) -> Result<Arc<crate::services::nats::NatsService>> {
    let deadline = Instant::now() + MESSAGEBUS_WAIT;
    loop {
        match crate::services::nats::NatsService::connect(url, token).await {
            Ok(nats) => return Ok(nats),
            Err(e) => {
                if Instant::now() + MESSAGEBUS_RETRY_INTERVAL >= deadline {
                    return Err(e);
                }
                warn!(
                    "Messagebus at {} is not accepting connections yet ({}); retrying",
                    url, e
                );
                tokio::time::sleep(MESSAGEBUS_RETRY_INTERVAL).await;
            }
        }
    }
}

async fn setup() -> Result<AppContext> {
    let registry = Arc::new(ModuleRegistry::new());

    // Capture the raw async_nats::Client alongside the host context so we can
    // subscribe to NATS subjects directly (not just publish via NatsPublisher).
    let mut nats_raw_client: Option<async_nats::Client> = None;
    // None when the message bus is not configured: with nowhere to publish,
    // there is no readiness to report and nothing can be gating on us.
    let mut heartbeat: Option<services::heartbeat::HeartbeatHandle> = None;

    // Built before the host context because it is the context's
    // `ScheduleClient`; its loop starts once the sandbox that runs the
    // scheduled functions exists.
    let scheduler = Arc::new(services::scheduler::ModuleScheduler::new(Arc::new(
        services::scheduler::SystemClock,
    )));

    let oauth_service: Option<Arc<OAuthService>>;
    // `ctx.resources.run` runs actions in a sandbox built from the very
    // context it is part of, so it is handed that context once it exists.
    let action_runner = SandboxActionRunner::new(registry.clone());
    let host_ctx = {
        let mut ctx = noop_host_context();
        ctx.schedule = scheduler.clone();
        ctx.actions = action_runner.clone();

        let mut chat_sender: Arc<dyn ChatSender> = Arc::new(NoopChatSender);
        let mut requester: Arc<dyn NatsRequester> = Arc::new(NoopNatsRequester);

        let messagebus_url =
            get_env_or_default_with_key("MESSAGEBUS_URL", Some("messagebusUrl"), "");
        let messagebus_token = crate::services::nats::configured_token();
        if !messagebus_url.is_empty() {
            match connect_messagebus(&messagebus_url, messagebus_token.as_deref()).await {
                Ok(nats) => {
                    info!("Connected to messagebus at {}", messagebus_url);
                    nats_raw_client = Some(nats.raw_client().clone());
                    heartbeat = Some(services::heartbeat::HeartbeatHandle::new(
                        nats.raw_client().clone(),
                        SERVICE_NAME,
                    ));
                    chat_sender = Arc::new(crate::services::chat::BusChatSender::new(
                        nats.clone(),
                        "twitch",
                    ));
                    requester = nats.clone();
                    ctx.nats = nats;
                }
                Err(e) => {
                    warn!(
                        "Failed to connect to messagebus: {}; falling back to noop publisher",
                        e
                    );
                }
            }
        } else {
            info!("messagebusUrl not set; using noop NATS publisher and noop chat sender");
        }

        // Resource-instance lifecycle (`ctx.resources.*`) and module storage
        // (`ctx.storage.*`) — both backed by db-proxy via Twirp.
        let resource_proxy_url = get_config_value("databaseProxyUrl", "");
        if !resource_proxy_url.is_empty() {
            info!(
                "Wiring HttpResourceClient/HttpStorageClient against db-proxy {}",
                resource_proxy_url
            );
            ctx.resources = Arc::new(
                HttpResourceClient::new(resource_proxy_url.clone()).with_request_context(
                    DbRequestContext {
                        client_id: String::new(),
                        module_key: String::new(),
                    },
                ),
            );
            ctx.settings = Arc::new(
                crate::services::module_settings_client::HttpSettingsClient::new(
                    resource_proxy_url.clone(),
                ),
            );
            ctx.storage = Arc::new(HttpStorageClient::new(resource_proxy_url.clone()));
        } else {
            info!(
                "databaseProxyUrl not set in .woofx3.json; using noop resource, settings, and storage clients"
            );
        }

        let http_policy = HttpPolicy::from_settings(
            &get_env_or_default("WOOFX3_MODULE_HTTP", ""),
            &get_env_or_default("WOOFX3_MODULE_HTTP_ALLOW_PRIVATE", ""),
        )?;
        info!(
            "ctx.http policy: mode={:?} allow_private={}",
            http_policy.mode, http_policy.allow_private
        );
        if http_policy.mode == HttpPolicyMode::Log {
            warn!("WOOFX3_MODULE_HTTP=log: modules may reach hosts they were not granted");
        }
        ctx.http = Arc::new(ReqwestHttpClient::new(http_policy));

        let oauth = Arc::new(OAuthService::new(
            registry.clone(),
            ctx.settings.clone(),
            sealed_setting_writer(resource_proxy_url),
            ctx.http.clone(),
        ));
        oauth_service = Some(oauth.clone());

        // Platform integrations (twitch / obs / chat) and `ctx.oauth` are
        // bound through the extension registry. Each extension owns its own
        // Arc<dyn …> of the relevant transport, so the runtime adapters stay
        // agnostic to which platforms exist.
        ctx.extensions = Arc::new(
            ExtensionRegistry::new()
                .with(Arc::new(TwitchExtension::new(requester.clone())))
                .with(Arc::new(ObsExtension::new(requester)))
                .with(Arc::new(ChatExtension::new(chat_sender)))
                .with(Arc::new(OAuthExtension::new(oauth))),
        );

        ctx
    };

    action_runner.bind(host_ctx.clone());
    let sandbox = SandboxFactory::new(registry.clone(), host_ctx);

    scheduler.start(Arc::new(sandbox.clone()));

    // db-proxy is required: sandbox registry metadata comes from module_functions
    // rows, and the storage provider is resolved from the engine's settings table.
    // Establish the connection before reading either -- everything below this point
    // treats db-proxy as available, the same contract the Go and TypeScript runtimes
    // give their services by gating init behind the registered `db` service.
    let db_proxy_url = get_config_value("databaseProxyUrl", "");
    if db_proxy_url.is_empty() {
        anyhow::bail!("databaseProxyUrl (WOOFX3_DATABASE_PROXY_URL) is required for barkloader");
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

    let scene_manager_url =
        get_env_or_default_with_key("WOOFX3_SCENE_MANAGER_URL", Some("sceneManagerUrl"), "");
    if scene_manager_url.is_empty() {
        anyhow::bail!("sceneManagerUrl (WOOFX3_SCENE_MANAGER_URL) is required for barkloader");
    }
    let public_url_resolver = Arc::new(services::public_url::PublicUrlResolver::new(
        Some(db_proxy_url.clone()),
        scene_manager_url,
    ));

    // Bundled modules must be installed before the registry is built from
    // installed modules, and before any service resolves a system canonical
    // id. A bundled module that will not install is fatal: the engine's core
    // actions and triggers come from it, and starting anyway is what produces
    // the silent, hard-to-diagnose failures this replaces.
    // Before any upload can arrive: uploads are checked against these.
    bundled_modules::system_only_actions()?;

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

    // Advisory, and deliberately after boot_modules: an installed module going
    // stale against the engine is a thing to be told about, not a reason to
    // refuse to start. Silent when no marketplace is configured.
    let marketplace_url =
        get_env_or_default_with_key("MARKETPLACE_API_URL", Some("marketplaceUrl"), "");
    services::module_drift::report(&marketplace_url, &db_proxy_url).await;

    // Everything a dependent waits on us for is now in place: bundled modules
    // installed and the sandbox registry hydrated. Reconciliation failure is
    // fatal above, so this is only ever reached having succeeded.
    if let Some(hb) = &heartbeat {
        hb.readiness.mark_ready();
        tracing::info!("barkloader ready");
    }

    // Spawn the generic field-options NATS responder when NATS is available.
    if let Some(raw_client) = nats_raw_client {
        // Events this process publishes are stamped with the stream session
        // this subscriber learns from the bus; without it they go out with
        // none.
        tokio::spawn(services::session::run_session_subscriber(
            raw_client.clone(),
        ));
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
        oauth: oauth_service,
        frame_cache: Arc::new(services::frame_cache::FrameCache::new()),
        file_service: Arc::new(services::file_service::FileService::new(
            &routes::functions::upload_dir(),
            services::upload_limits::UploadLimits::from_env()?,
        )?),
        module_locks: Arc::new(types::ModuleLocks::new()),
    };

    Ok(ctx)
}

async fn boot_modules(
    registry: &Arc<ModuleRegistry>,
    repository: &RepositoryImpl,
    db_proxy_url: &str,
    scheduler: &Arc<services::scheduler::ModuleScheduler>,
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

/// The engine secret (`barkloaderKey`), read through `lookup(env_var,
/// config_key)`. It authenticates the api and signs upload grants and media
/// proxy URLs, so a blank, placeholder or short value stops startup.
fn engine_secret(lookup: impl Fn(&str, &str) -> String) -> Result<String, SecretError> {
    let secret = lookup("WOOFX3_BARKLOADER_KEY", "barkloaderKey");
    validate_secret("barkloaderKey", &secret)?;
    Ok(secret)
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

    lib_module::load_reserved_subjects_contract();

    // Validate required config. Each fatal path drops the guard first so the
    // file and OpenTelemetry sinks flush before the process goes away.
    if let Err(e) = validate_required_config(&["WOOFX3_BARKLOADER_KEY"]) {
        tracing::error!("{}", e);
        drop(logging);
        std::process::exit(1);
    }
    let barkloader_key = match engine_secret(|env_var, config_key| {
        get_env_or_default_with_key(env_var, Some(config_key), "")
    }) {
        Ok(secret) => secret,
        Err(e) => {
            tracing::error!("{}", e);
            drop(logging);
            std::process::exit(1);
        }
    };
    let port: u16 = match get_env_or_default("BARKLOADER_PORT", "9653").parse() {
        Ok(port) if port != 0 => port,
        Ok(_) => {
            tracing::error!(
                "BARKLOADER_PORT must not be 0: the Host allow-list needs the bound port"
            );
            drop(logging);
            std::process::exit(1);
        }
        Err(e) => {
            tracing::error!("BARKLOADER_PORT must be a port number: {}", e);
            drop(logging);
            std::process::exit(1);
        }
    };
    let allowed_host =
        get_env_or_default_with_key(ALLOWED_HOST_ENV_VAR, Some(ALLOWED_HOST_CONFIG_KEY), "");
    let service_auth = match ServiceAuth::new(&barkloader_key, port, &allowed_host) {
        Ok(auth) => Arc::new(auth),
        Err(e) => {
            tracing::error!("{}", e);
            drop(logging);
            std::process::exit(1);
        }
    };
    if let Err(e) = validate_required_config_keys(&["databaseProxyUrl"]) {
        tracing::error!("{}", e);
        drop(logging);
        std::process::exit(1);
    }

    // Before setup: a malformed api URL is a configuration error, and is
    // reported as one rather than surfacing on the first thumbnail.
    let callbacks = match callback::CallbackSender::from_config() {
        Ok(callbacks) => Data::new(callbacks),
        Err(e) => {
            tracing::error!("{}", e);
            drop(logging);
            std::process::exit(1);
        }
    };

    // setup
    let ctx = setup().await.expect("Failed to complete set up");

    let bind_addr = format!("127.0.0.1:{}", port);

    // One client for every request, so upstream connections are reused.
    let media_proxy = Data::new(routes::media::MediaProxyService::new(
        barkloader_key,
        services::media_proxy::MediaFetcher::new(),
    ));

    // Start HTTP server
    info!("Starting server on {}", bind_addr);
    let server = HttpServer::new(move || {
        App::new()
            .app_data(Data::new(ctx.clone()))
            .app_data(media_proxy.clone())
            .app_data(callbacks.clone())
            // The assets and archives routes depend only on the repository,
            // not the full AppContext, so they get their own Data registration. It
            // shares the same swappable handle, so a storage reload takes
            // effect here too rather than pinning a stale backend.
            .app_data(Data::new(ctx.repository.clone()))
            .wrap(middleware::access_log())
            .configure(|cfg| routes::configure(cfg, service_auth.clone()))
    })
    .bind(bind_addr)?
    .shutdown_timeout(5)
    .run();
    #[cfg(windows)]
    stop_on_ctrl_break(server.handle());
    server.await
}

/// Stops the server gracefully on CTRL_BREAK_EVENT, the orchestrator's stop
/// request on Windows. actix-web stops on SIGINT, SIGTERM and SIGQUIT on unix,
/// but on Windows only on Ctrl+C, which a process in its own console process
/// group never receives.
#[cfg(windows)]
fn stop_on_ctrl_break(server: actix_web::dev::ServerHandle) {
    actix_web::rt::spawn(async move {
        let mut ctrl_break = match tokio::signal::windows::ctrl_break() {
            Ok(ctrl_break) => ctrl_break,
            Err(e) => {
                warn!(
                    "Cannot listen for CTRL_BREAK, the orchestrator can only kill this process: {}",
                    e
                );
                return;
            }
        };
        if ctrl_break.recv().await.is_some() {
            info!("Received CTRL_BREAK, shutting down");
            server.stop(true).await;
        }
    });
}

#[cfg(test)]
mod tests {
    use super::*;

    fn lookup_returning(value: &'static str) -> impl Fn(&str, &str) -> String {
        move |env_var, config_key| {
            assert_eq!(
                (env_var, config_key),
                ("WOOFX3_BARKLOADER_KEY", "barkloaderKey")
            );
            value.to_string()
        }
    }

    #[test]
    fn test_engine_secret_refuses_unusable_values() {
        let cases = [
            ("", "empty"),
            ("CHANGE_ME", "placeholder"),
            ("short-key", "too short"),
        ];
        for (value, label) in cases {
            let error = engine_secret(lookup_returning(value)).expect_err(label);
            assert!(
                error
                    .to_string()
                    .contains("barkloaderKey (WOOFX3_BARKLOADER_KEY)"),
                "{label}: {error}"
            );
        }
    }

    #[test]
    fn test_engine_secret_returns_a_valid_secret_unchanged() {
        let secret = "0123456789abcdef0123456789abcdef";
        assert_eq!(engine_secret(lookup_returning(secret)).unwrap(), secret);
    }
}
