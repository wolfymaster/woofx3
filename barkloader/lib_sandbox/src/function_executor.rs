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
    pub fn new() -> Self {
        Self {
            adapters: HashMap::new(),
        }
    }

    pub fn add_adapter(&mut self, extension: String, adapter: Box<dyn RuntimeAdapter>) {
        self.adapters.insert(extension, adapter);
    }

    /// Builds and caches the adapter for `extension` on first use. A fresh
    /// `Sandbox` (and its `FunctionExecutor`) is created per invoke, and
    /// each invoke only ever needs one runtime — eagerly constructing every
    /// supported runtime (QuickJS *and* Lua) up front wasted a VM
    /// allocation on every single call regardless of which one the
    /// function actually used.
    fn adapter_for(&mut self, extension: &str) -> Result<&dyn RuntimeAdapter, Error> {
        if !self.adapters.contains_key(extension) {
            let adapter: Box<dyn RuntimeAdapter> = match extension {
                "echo" => Box::new(EchoAdapter::new()),
                "lua" => Box::new(LuaAdapter::new()?),
                "js" => Box::new(QuickJSAdapter::new()?),
                other => return Err(Error::UnsupportedRuntime(other.to_string())),
            };
            self.adapters.insert(extension.to_string(), adapter);
        }

        Ok(self
            .adapters
            .get(extension)
            .expect("adapter inserted above")
            .as_ref())
    }

    pub fn execute(
        &mut self,
        function: &Function,
        invocation: &InvocationContext,
    ) -> Result<Value, Error> {
        let extension = function.get_extension().ok_or(Error::UnknownFunctionType)?;
        let adapter = self.adapter_for(&extension)?;
        let entry_point = function.resolved_entry_point();
        adapter.execute(&function.code, entry_point, invocation)
    }
}

impl Default for FunctionExecutor {
    fn default() -> Self {
        Self::new()
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
            module_id: String::new(),
            module_name: String::new(),
            module_version: String::new(),
        }
    }

    #[test]
    fn test_new_executor_builds_no_adapters_up_front() {
        // Adapter construction is lazy: a fresh executor hasn't paid for
        // any runtime (echo/lua/js) until execute() actually needs one.
        let executor = FunctionExecutor::new();
        assert!(executor.adapters.is_empty());
    }

    #[test]
    fn test_execute_only_builds_the_requested_runtime() {
        let mut executor = FunctionExecutor::new();
        let adapter = Box::new(MockRuntimeAdapter);
        executor.add_adapter("mock".to_string(), adapter);

        let function = Function {
            name: "test_function".to_string(),
            file_name: "hello.mock".to_string(),
            code: "wolfy".to_string(),
            is_trusted: false,
            entry_point: None,
        };
        let invocation = test_invocation(json!({ "input": "test" }));
        executor.execute(&function, &invocation).unwrap();

        // Only the "mock" extension was ever requested — echo/lua/js were
        // never constructed.
        assert_eq!(executor.adapters.len(), 1);
        assert!(executor.adapters.contains_key("mock"));
    }

    #[test]
    fn test_add_adapter() {
        let mut executor = FunctionExecutor::new();
        let adapter = Box::new(MockRuntimeAdapter);

        executor.add_adapter("mock".to_string(), adapter);
        assert!(executor.adapters.contains_key("mock"));
    }

    #[test]
    fn test_execute_with_adapter() {
        let mut executor = FunctionExecutor::new();
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
        let mut executor = FunctionExecutor::new();
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
        let mut executor = FunctionExecutor::new();
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
