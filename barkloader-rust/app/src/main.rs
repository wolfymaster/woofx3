mod application;
mod error;
mod function_executor;
mod models;
mod module_manager;
mod runtime;

use application::Application;
use models::request::InvokeRequest;

fn main() -> Result<(), error::Error> {
    // Parse command line arguments or configuration if needed
    let config = parse_config()?;
    
    // Create application instance
    let app = Application::new(config)?;
    
    // Create an example invoke request (in a real app, this would come from external input)
    let request = InvokeRequest {
        function: "example/main".to_string(),
        args: serde_json::json!({ "key": "value" }),
    };
    
    // Invoke the function and handle the result
    let result = app.invoke(request)?;
    println!("Result: {}", result);
    
    Ok(())
}

fn parse_config() -> Result<application::Config, error::Error> {
    Ok(application::Config {
        modules_dir: "modules".into(),
    })
}