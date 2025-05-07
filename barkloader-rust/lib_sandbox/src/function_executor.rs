use crate::error::Error;
use crate::models::function::Function;
use crate::runtime::RuntimeAdapter;
use crate::runtime::echo::EchoAdapter;
use crate::runtime::lua::LuaAdapter;
use crate::runtime::quickjs::QuickJSAdapter;
use serde_json::Value;
use std::collections::HashMap;

pub struct FunctionExecutor {
    adapters: HashMap<String, Box<dyn RuntimeAdapter>>,
}

impl FunctionExecutor {
    pub fn new() -> Result<Self, Error> {
        let mut executor = Self {
            adapters: HashMap::new(),
        };        

        executor.add_adapter("echo".to_string(), Box::new(EchoAdapter::new()));
        executor.add_adapter("lua".to_string(), Box::new(LuaAdapter::new()?));
        executor.add_adapter("js".to_string(), Box::new(QuickJSAdapter::new()?));

        Ok(executor)
    }

    // method to add adapters
    pub fn add_adapter(&mut self, extension: String, adapter: Box<dyn RuntimeAdapter>) {
        self.adapters.insert(extension, adapter);
    }
    
    pub fn execute(&self, function: &Function, args: Value) -> Result<Value, Error> {
        let extension = function.get_extension()
            .ok_or(Error::UnknownFunctionType)?;
        
        let adapter = self.adapters.get(&extension)
            .ok_or(Error::UnsupportedRuntime(extension.clone()))?;
        
        adapter.execute(&function.code, args)
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::error::Error;
    use serde_json::json;

    // Mock RuntimeAdapter for testing
    struct MockRuntimeAdapter;
    
    impl RuntimeAdapter for MockRuntimeAdapter {
        fn execute(&self, code: &str, args: serde_json::Value) -> Result<serde_json::Value, Error> {
            let mut result = args.as_object().unwrap().clone();
            result.insert("result".to_string(), json!(format!("Hello {}", code)));
            Ok(json!(result))
        }
        
        fn create_sandbox(&self) -> Result<(), Error> {
            Ok(())
        }
    }

    #[test]
    fn test_new_executor() {
        let result = FunctionExecutor::new();
        assert!(result.is_ok());
        let executor = result.unwrap();
        assert_eq!(executor.adapters.len(), 3);
    }

    #[test]
    fn test_add_adapter() {
        let mut executor = FunctionExecutor::new().unwrap();
        let adapter = Box::new(MockRuntimeAdapter);
        
        executor.add_adapter("mock".to_string(), adapter);
        assert!(executor.adapters.contains_key("mock"));
    }

    #[test]
    fn test_execute_with_adapter() {
        let mut executor = FunctionExecutor::new().unwrap();
        let adapter = Box::new(MockRuntimeAdapter);
        executor.add_adapter("mock".to_string(), adapter);

        let function = Function {
            name: "test_function".to_string(),
            path: std::env::current_dir().unwrap().join("hello.mock"),
            code: "wolfy".to_string(),
            is_trusted: false,
        };

        let args = json!({ "input": "test" });
        let result = executor.execute(&function, args.clone());
        
        assert!(result.is_ok());
        let result_value = result.unwrap();
        assert_eq!(result_value["input"], args["input"]);
        assert_eq!(result_value["result"], json!("Hello wolfy"));
    }

    #[test]
    fn test_execute_without_adapter() {
        let executor = FunctionExecutor::new().unwrap();
        let function = Function {
            name: "test_function".to_string(),
            path: std::env::current_dir().unwrap().join("test_function.nonexistent"),
            code: "test code".to_string(),
            is_trusted: false,
        };

        let args = json!({ "input": "test" });
        let result = executor.execute(&function, args);
        
        assert!(result.is_err());
        assert!(matches!(result.unwrap_err(), Error::UnsupportedRuntime(_)));
    }

    #[test]
    fn test_execute_with_unknown_extension() {
        let executor = FunctionExecutor::new().unwrap();
        let function = Function {
            name: "test_function".to_string(),
            path: std::env::current_dir().unwrap().join("test_function"),
            code: "test code".to_string(),
            is_trusted: false,
        };

        let args = json!({ "input": "test" });
        let result = executor.execute(&function, args);
        
        assert!(result.is_err());
        assert!(matches!(result.unwrap_err(), Error::UnknownFunctionType));
    }
}
