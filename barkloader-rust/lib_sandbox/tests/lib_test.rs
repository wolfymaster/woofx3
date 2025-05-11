use lib_sandbox::{ Config, Sandbox };
use lib_sandbox::models::request::InvokeRequest;

#[test]
fn test_sandbox() {
    let sandbox = Sandbox::new(Config {
        modules_dir: std::env::current_dir().unwrap().join("tests/modules"),
    }).unwrap();
    
    let result = sandbox.invoke(InvokeRequest {
        function: "example/example".to_string(),
        args: serde_json::json!({ "input": "test" }),
    }).unwrap();
    
    assert_eq!(result["code"], serde_json::json!("// This file is intentionally empty"));
    assert_eq!(result["args"], serde_json::json!({ "input": "test" }));
}

#[test]
fn test_lua_adapter() {
    let sandbox = Sandbox::new(Config {
        modules_dir: std::env::current_dir().unwrap().join("tests/modules"),
    }).unwrap();
    
    let result = sandbox.invoke(InvokeRequest {
        function: "example/helloworld".to_string(),
        args: serde_json::json!({ "name": "wolfy" }),
    }).unwrap();

    assert_eq!(result["response"], serde_json::json!("Hello wolfy"));
}

#[test]
fn test_quickjs_adapter() {
    let sandbox = Sandbox::new(Config {
        modules_dir: std::env::current_dir().unwrap().join("tests/modules"),
    }).unwrap();
    
    let result = sandbox.invoke(InvokeRequest {
        function: "example/sayhello".to_string(),
        args: serde_json::json!({ "name": "wolfy" }),
    }).unwrap();

    assert_eq!(result["response"], serde_json::json!("Hello wolfy"));
}

#[test]
fn test_null_args() {
    let sandbox = Sandbox::new(Config {
        modules_dir: std::env::current_dir().unwrap().join("tests/modules"),
    }).unwrap();
    
    let result = sandbox.invoke(InvokeRequest {
        function: "example/sayhello".to_string(),
        args: serde_json::Value::Null,
    }).unwrap();

    assert_eq!(result["response"], serde_json::json!("Hello World"));
}
