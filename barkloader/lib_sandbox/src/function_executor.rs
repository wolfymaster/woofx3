use crate::error::Error;
use crate::host::InvocationContext;
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

    pub fn add_adapter(&mut self, extension: String, adapter: Box<dyn RuntimeAdapter>) {
        self.adapters.insert(extension, adapter);
    }

    pub fn execute(
        &self,
        function: &Function,
        invocation: &InvocationContext,
    ) -> Result<Value, Error> {
        let extension = function.get_extension().ok_or(Error::UnknownFunctionType)?;

        let adapter = self
            .adapters
            .get(&extension)
            .ok_or(Error::UnsupportedRuntime(extension.clone()))?;

        let entry_point = function.resolved_entry_point();
        adapter.execute(&function.code, entry_point, invocation)
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::error::Error;
    use crate::host::noop::noop_host_context;
    use serde_json::json;

    struct MockRuntimeAdapter;

    impl RuntimeAdapter for MockRuntimeAdapter {
        fn execute(
            &self,
            code: &str,
            _entry_point: &str,
            invocation: &InvocationContext,
        ) -> Result<Value, Error> {
            Ok(json!({
                "event": invocation.event,
                "result": format!("Hello {}", code),
            }))
        }
    }

    fn test_invocation(event: Value) -> InvocationContext {
        InvocationContext {
            event,
            user: Value::Null,
            host: noop_host_context(),
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
            file_name: "hello.mock".to_string(),
            code: "wolfy".to_string(),
            is_trusted: false,
            entry_point: None,
        };

        let event = json!({ "input": "test" });
        let invocation = test_invocation(event.clone());
        let result = executor.execute(&function, &invocation);

        assert!(result.is_ok());
        let result_value = result.unwrap();
        assert_eq!(result_value["event"]["input"], event["input"]);
        assert_eq!(result_value["result"], json!("Hello wolfy"));
    }

    #[test]
    fn test_execute_without_adapter() {
        let executor = FunctionExecutor::new().unwrap();
        let function = Function {
            name: "test_function".to_string(),
            file_name: "test_function.nonexistent".to_string(),
            code: "test code".to_string(),
            is_trusted: false,
            entry_point: None,
        };

        let invocation = test_invocation(json!({ "input": "test" }));
        let result = executor.execute(&function, &invocation);

        assert!(result.is_err());
        assert!(matches!(result.unwrap_err(), Error::UnsupportedRuntime(_)));
    }

    #[test]
    fn test_execute_with_unknown_extension() {
        let executor = FunctionExecutor::new().unwrap();
        let function = Function {
            name: "test_function".to_string(),
            file_name: "test_function".to_string(),
            code: "test code".to_string(),
            is_trusted: false,
            entry_point: None,
        };

        let invocation = test_invocation(json!({ "input": "test" }));
        let result = executor.execute(&function, &invocation);

        assert!(result.is_err());
        assert!(matches!(result.unwrap_err(), Error::UnknownFunctionType));
    }
}
