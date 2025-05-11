use actix_web::{
    App, 
    HttpServer, 
    middleware::Logger,
    web::Data, 
};
use anyhow::Result;
use env_logger::Env;
use log::info;
use lib_repository::{RepositoryConfig, RepositoryType};
use lib_sandbox::{Config, SandboxFactory};
use types::{AppContext, RepositoryContext};

mod errors;
mod routes;
mod services;
mod types;
mod util;
mod websocket;

const DEFAULT_REPOSITORY_TYPE: &str = "file";
const DEFAULT_MODULE_DIR: &str = "modules";

async fn setup() -> Result<AppContext> {
    let destination = util::get_path_from_env("MODULES_DIR", DEFAULT_MODULE_DIR);
    info!("Modules directory: {:?}", destination.as_path());
    let sandbox = SandboxFactory::new(Config {
        modules_dir: destination.clone(),
    })
    .expect("Failed to create sandbox");
    let ctx = AppContext {
        repository: RepositoryContext { 
            config: RepositoryConfig {
                destination,
            },
            kind: match util::get_env_or_default("REPOSITORY_TYPE", DEFAULT_REPOSITORY_TYPE).as_str() {
                "file" => RepositoryType::File,
                "s3" => RepositoryType::S3,
                _ => {
                    return Err(anyhow::anyhow!("Invalid repository type"))
                }
            }, 
        },
        sandbox: sandbox,
    };
    lib_repository::create_repository(
        ctx.repository.kind.clone(),
         &ctx.repository.config
    ).await.setup()?;
    Ok(ctx)
}

#[actix_web::main]
async fn main() -> std::io::Result<()> {
    // Initialize env_logger
    env_logger::init_from_env(Env::default().default_filter_or("info"));

    // setup
    let ctx = setup().await.expect("Failed to setup");

    // Start HTTP server
    info!("Starting server on 127.0.0.1:8080");
    HttpServer::new(move || {
        App::new()
            .app_data(Data::new(ctx.clone()))
            .wrap(Logger::default()) // Use default format
            .configure(routes::echo::configure)
            .configure(routes::websocket::configure)
            // .configure(routes::functions::configure)
    })
    .bind("127.0.0.1:8080")?
    .run()
    .await
}
