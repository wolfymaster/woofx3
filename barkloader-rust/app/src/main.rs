use crate::util::{get_env_or_default, get_path_from_env};
use actix_web::{App, HttpServer, middleware::Logger, web::Data};
use anyhow::Result;
use env_logger::Env;
use lib_repository::{FileRepositoryConfig, Repository, RepositoryConfig, RepositoryFactory};
use lib_sandbox::{Config, SandboxFactory};
use log::info;
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
    let sandbox = SandboxFactory::new(Config {
        modules_dir: destination.clone(),
    })
    .expect("Failed to create sandbox");

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

    let ctx = AppContext {
        repository,
        sandbox,
    };

    Ok(ctx)
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
