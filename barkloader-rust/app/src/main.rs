use crate::util::{get_env_or_default, get_path_from_env};
use actix_web::{App, HttpServer, middleware::Logger, web::Data};
use anyhow::Result;
use env_logger::Env;
use lib_repository::{FileRepositoryConfig, Repository, RepositoryConfig, RepositoryFactory, RepositoryImpl};
use lib_sandbox::host::noop::noop_host_context;
use lib_sandbox::{ModuleRegistry, ModuleMetadata, ModuleState, RegisteredModule, SandboxFactory};
use lib_sandbox::models::function::Function;
use log::{info, warn};
use std::collections::HashMap;
use std::path::Path;
use std::sync::Arc;
use types::AppContext;

mod errors;
mod routes;
mod services;
mod types;
mod util;
mod websocket;

const DEFAULT_REPOSITORY_TYPE: &str = "file";
const DEFAULT_MODULE_DIR: &str = "modules";

async fn setup() -> Result<AppContext> {
    let destination = get_path_from_env("MODULES_DIR", DEFAULT_MODULE_DIR);

    let registry = Arc::new(ModuleRegistry::new());

    let sandbox = SandboxFactory::new(registry.clone(), noop_host_context());

    let repository_config = RepositoryConfig::File(FileRepositoryConfig {
        destination
    });

    let repository =
        match get_env_or_default("REPOSITORY_TYPE", DEFAULT_REPOSITORY_TYPE).as_str() {
            "file" => RepositoryFactory::new(&repository_config),
            "s3" => RepositoryFactory::new(&repository_config),
            _ => return Err(anyhow::anyhow!("Invalid repository type")),
        }
        .await;

    repository.setup()?;

    boot_modules(&registry, &repository)?;

    let db_proxy_url = {
        let val = get_env_or_default("DB_PROXY_ADDR", "");
        if val.is_empty() {
            warn!("DB_PROXY_ADDR not set; trigger registration will be skipped");
            None
        } else {
            Some(val)
        }
    };

    let ctx = AppContext {
        repository,
        sandbox,
        registry,
        db_proxy_url,
    };

    Ok(ctx)
}

fn boot_modules(registry: &Arc<ModuleRegistry>, repository: &RepositoryImpl) -> Result<()> {
    let module_files = repository.list_prefix("modules/")?;
    if module_files.is_empty() {
        info!("No modules found in repository");
        return Ok(());
    }

    let mut modules_map: HashMap<String, Vec<String>> = HashMap::new();
    for key in &module_files {
        let parts: Vec<&str> = key.splitn(3, '/').collect();
        if parts.len() == 3 {
            modules_map.entry(parts[1].to_string()).or_default().push(key.clone());
        }
    }

    for (module_name, file_keys) in &modules_map {
        let mut functions = HashMap::new();
        for key in file_keys {
            let file_name = Path::new(key).file_name()
                .and_then(|n| n.to_str())
                .unwrap_or("");
            let func_name = Path::new(file_name).file_stem()
                .and_then(|n| n.to_str())
                .unwrap_or("");

            match repository.read_file(key) {
                Ok(bytes) => {
                    let code = String::from_utf8_lossy(&bytes).to_string();
                    functions.insert(func_name.to_string(), Function::new(
                        func_name.to_string(),
                        file_name.to_string(),
                        code,
                        false,
                    ));
                }
                Err(err) => {
                    log::error!("Failed to read module file {}: {}", key, err);
                }
            }
        }

        if !functions.is_empty() {
            let module = RegisteredModule {
                metadata: ModuleMetadata {
                    name: module_name.clone(),
                    version: "unknown".to_string(),
                    installed_at: 0,
                    updated_at: 0,
                },
                functions,
                state: ModuleState::Active,
            };
            if let Err(err) = registry.register_module(module_name.clone(), module) {
                log::error!("Failed to register module {}: {}", module_name, err);
            }
            info!("Loaded module: {}", module_name);
        }
    }

    info!("Boot complete: loaded {} modules", modules_map.len());
    Ok(())
}

#[actix_web::main]
async fn main() -> std::io::Result<()> {
    // Initialize env_logger
    env_logger::init_from_env(Env::default().default_filter_or("info"));

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
            .wrap(Logger::default()) // Use default format
            .configure(routes::echo::configure)
            .configure(routes::websocket::configure)
            .configure(routes::functions::configure)
    })
    .bind(bind_addr)?
    .run()
    .await
}
