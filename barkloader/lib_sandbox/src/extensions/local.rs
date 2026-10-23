//! `ctx.local`: lets module code talk to its own `local[]` endpoints, the
//! devices on the streamer's network its manifest declares (VTube Studio, a
//! key light), through the connectors host's companion gateway.
//!
//! The module names one of its declared endpoints and a message; barkloader
//! stamps the module's own id from the invocation, never from the arguments,
//! and asks on the fixed subject `engine.companion.module.request`. The
//! gateway decides whether the module may reach the endpoint (an endpoint a
//! host adapter claims, such as OBS's, it may not), chooses the address,
//! holds the socket and writes the frame. Module code never supplies an
//! address and never holds a socket.
//!
//! The install-time approval of the module's `local[]` entries is the grant;
//! there is no permission to declare. The checks made here (a declared,
//! websocket endpoint) only refuse early what the gateway would refuse anyway,
//! and the gateway makes them again against the stored manifest.
//!
//! Every call is bounded the same way as `ctx.obs`: by what is left of the
//! invocation's deadline, by a per-invocation call count, and by a limit on
//! requests in flight at once. Each request also carries the time it may be
//! served for (`budgetMs`), so the gateway never writes to the device after
//! barkloader has stopped waiting.

use super::args::describe;
use super::in_flight::InFlight;
use crate::contracts::companion_gateway::{
    ModuleEndpointFailureCode, ModuleEndpointMatch, ModuleEndpointMatchRequest,
    ModuleEndpointMatchValue, ModuleEndpointReply, ModuleEndpointRequest, ModuleEndpointSend,
    SUBJECT_MODULE_REQUEST,
};
use crate::host::{CallScope, HostError, HostExtension, HostFunction, NatsRequester, RequestError};
use crate::protected_settings::LocalEndpointProtocol;
use serde_json::{Map, Value, json};
use std::sync::Arc;
use std::time::Duration;

const NAMESPACE: &str = "local";

/// The longest one call waits for the connectors host. The gateway answers
/// within the request's budget, at most `MAX_BUDGET`, so this only bounds a
/// hung connectors host. A call never waits past the invocation's deadline
/// either.
pub const REQUEST_TIMEOUT: Duration = Duration::from_secs(5);

/// How many `ctx.local` calls one invocation may make. A device protocol
/// that signs in and then asks for a few things needs a handful; more is a
/// loop.
pub const MAX_CALLS_PER_INVOCATION: u32 = 20;

/// How many `ctx.local` requests may wait on the connectors host at once,
/// across every invocation. Each holds a blocking thread.
pub const MAX_IN_FLIGHT: usize = 32;

/// How long a call waits for an in-flight slot before giving up.
pub const IN_FLIGHT_WAIT: Duration = Duration::from_secs(2);

/// The longest a request may be served for, and what a call that sets no
/// `timeoutMs` asks for. It is the contract's upper bound on `budgetMs`
/// (shared/common/contracts/companion-gateway.json) and connectors' own
/// limit on the subject, and stays below `REQUEST_TIMEOUT` so the gateway's
/// answer always arrives before barkloader stops waiting.
pub const MAX_BUDGET: Duration = Duration::from_millis(4_500);

/// The shortest budget a request may carry: the contract's lower bound on
/// `budgetMs`. A call with less time left than this fails without asking.
pub const MIN_BUDGET: Duration = Duration::from_millis(100);

/// What a request's budget leaves of the invocation's remaining time, so the
/// gateway's answer reaches the function before its caller stops waiting.
pub const DEADLINE_MARGIN: Duration = Duration::from_millis(200);

/// `code`s a module can branch on. A refusal from the gateway carries its own
/// code (`ModuleEndpointFailureCode`, such as `adapter_owned` or
/// `not_routed`) by the same name; these are the ones barkloader sets itself.
pub const TIMEOUT: &str = "timeout";
pub const UNAVAILABLE: &str = "unavailable";
pub const REQUEST_FAILED: &str = "request_failed";
pub const CALL_LIMIT: &str = "call_limit";
pub const BUSY: &str = "busy";
pub const INVALID_ARGUMENTS: &str = "invalid_arguments";

/// What a function asks the gateway to do.
#[derive(Clone, Copy, PartialEq, Eq)]
enum Operation {
    /// Write one frame.
    Send,
    /// Write one frame and wait for the device's answer to it.
    Request,
}

/// The functions module code may call.
const FUNCTIONS: &[(&str, Operation)] =
    &[("send", Operation::Send), ("request", Operation::Request)];

/// The limits every call is held to.
#[derive(Debug, Clone, Copy)]
pub struct Limits {
    pub request_timeout: Duration,
    pub max_calls_per_invocation: u32,
    pub max_in_flight: usize,
    pub in_flight_wait: Duration,
}

impl Default for Limits {
    fn default() -> Self {
        Self {
            request_timeout: REQUEST_TIMEOUT,
            max_calls_per_invocation: MAX_CALLS_PER_INVOCATION,
            max_in_flight: MAX_IN_FLIGHT,
            in_flight_wait: IN_FLIGHT_WAIT,
        }
    }
}

pub struct LocalExtension {
    functions: Vec<HostFunction>,
}

impl LocalExtension {
    pub fn new(nats: Arc<dyn NatsRequester>) -> Self {
        Self::with_limits(nats, Limits::default())
    }

    pub fn with_limits(nats: Arc<dyn NatsRequester>, limits: Limits) -> Self {
        let in_flight = Arc::new(InFlight::new(limits.max_in_flight));
        let functions = FUNCTIONS
            .iter()
            .map(|&(name, operation)| {
                let nats = nats.clone();
                let in_flight = in_flight.clone();
                HostFunction::scoped(name, move |scope: &CallScope, args: Value| {
                    call(
                        nats.as_ref(),
                        &in_flight,
                        &limits,
                        scope,
                        name,
                        operation,
                        args,
                    )
                })
            })
            .collect();
        Self { functions }
    }
}

impl HostExtension for LocalExtension {
    fn namespace(&self) -> &str {
        NAMESPACE
    }

    fn functions(&self) -> &[HostFunction] {
        &self.functions
    }
}

/// One call's arguments, read and checked.
struct LocalCall {
    endpoint: String,
    message: String,
    matching: Option<ModuleEndpointMatch>,
    timeout: Option<Duration>,
}

impl LocalCall {
    /// The request for this call by `module_id`, served for `budget`.
    fn request(&self, module_id: &str, budget: Duration) -> ModuleEndpointRequest {
        let budget_ms = i64::try_from(budget.as_millis()).expect("a budget fits in i64");
        match &self.matching {
            None => ModuleEndpointRequest::Send(ModuleEndpointSend {
                module_id: module_id.to_string(),
                endpoint_id: self.endpoint.clone(),
                message: self.message.clone(),
                budget_ms,
            }),
            Some(matching) => ModuleEndpointRequest::Request(ModuleEndpointMatchRequest {
                module_id: module_id.to_string(),
                endpoint_id: self.endpoint.clone(),
                message: self.message.clone(),
                budget_ms,
                r#match: matching.clone(),
            }),
        }
    }
}

fn call(
    nats: &dyn NatsRequester,
    in_flight: &InFlight,
    limits: &Limits,
    scope: &CallScope,
    name: &str,
    operation: Operation,
    args: Value,
) -> Result<Value, HostError> {
    // Everything about the call itself is checked before anything is counted
    // or sent, so a bad call fails with the reason instead of reaching the
    // device.
    let call = read_call(name, operation, args)?;
    check_endpoint(scope, name, &call.endpoint)?;
    call.request(scope.module_id(), MAX_BUDGET)
        .validate()
        .map_err(|err| {
            HostError::with_code(format!("ctx.local.{name}: {err}"), INVALID_ARGUMENTS)
        })?;

    let made = scope.record_call(NAMESPACE);
    if made > limits.max_calls_per_invocation {
        return Err(HostError::with_code(
            format!(
                "ctx.local.{name}: a function may make at most {} ctx.local calls per run",
                limits.max_calls_per_invocation
            ),
            CALL_LIMIT,
        ));
    }

    let spent = || {
        HostError::with_code(
            format!("ctx.local.{name}: the function has too little time left to reach the device"),
            TIMEOUT,
        )
    };
    if scope.remaining().is_zero() {
        return Err(spent());
    }
    let Some(_slot) = in_flight.acquire(limits.in_flight_wait.min(scope.remaining())) else {
        return Err(HostError::with_code(
            format!(
                "ctx.local.{name}: too many local endpoint requests are waiting; try again shortly"
            ),
            BUSY,
        ));
    };
    let Some(budget) = budget(call.timeout, scope.remaining()) else {
        return Err(spent());
    };
    let timeout = limits.request_timeout.min(scope.remaining());

    let request = serde_json::to_value(call.request(scope.module_id(), budget))
        .expect("a module endpoint request serializes");
    let reply = match nats.request(SUBJECT_MODULE_REQUEST, request, timeout) {
        Ok(reply) => reply,
        Err(RequestError::TimedOut) => {
            let after = match operation {
                Operation::Send => "; the message may still have been sent",
                Operation::Request => "",
            };
            return Err(HostError::with_code(
                format!(
                    "ctx.local.{name}: the connectors host did not answer within {:.1}s{after}",
                    timeout.as_secs_f64()
                ),
                TIMEOUT,
            ));
        }
        Err(RequestError::NoResponders) => {
            return Err(HostError::with_code(
                format!("ctx.local.{name}: no connectors host is running to reach local endpoints"),
                UNAVAILABLE,
            ));
        }
        Err(RequestError::Failed(reason)) => {
            return Err(HostError::with_code(
                format!("ctx.local.{name}: {reason}"),
                REQUEST_FAILED,
            ));
        }
    };
    read_reply(name, &call.endpoint, operation, reply)
}

/// How long the request may be served for: what the call asked for (by
/// default `MAX_BUDGET`), never more than `MAX_BUDGET`, and never past the
/// invocation's deadline less `DEADLINE_MARGIN`. `None` when that leaves less
/// than `MIN_BUDGET`.
fn budget(asked: Option<Duration>, remaining: Duration) -> Option<Duration> {
    let budget = asked
        .unwrap_or(MAX_BUDGET)
        .min(MAX_BUDGET)
        .min(remaining.saturating_sub(DEADLINE_MARGIN));
    // Whole milliseconds, as the request carries it.
    let budget = Duration::from_millis(u64::try_from(budget.as_millis()).expect("fits in u64"));
    (budget >= MIN_BUDGET).then_some(budget)
}

/// Refuses an endpoint the module does not declare, or one the gateway could
/// not carry, with the gateway's own code for it.
fn check_endpoint(scope: &CallScope, name: &str, id: &str) -> Result<(), HostError> {
    let Some(endpoint) = scope.local_endpoint(id) else {
        return Err(HostError::with_code(
            format!(
                "ctx.local.{name}: this module declares no local endpoint {id:?}; declare it in the module manifest's \"local\""
            ),
            ModuleEndpointFailureCode::NotDeclared.to_string(),
        ));
    };
    match endpoint.protocol {
        LocalEndpointProtocol::Websocket => Ok(()),
        LocalEndpointProtocol::Http => Err(HostError::with_code(
            format!(
                "ctx.local.{name}: local endpoint {id:?} is an http endpoint; ctx.local reaches only websocket endpoints"
            ),
            ModuleEndpointFailureCode::ProtocolUnsupported.to_string(),
        )),
    }
}

fn read_call(name: &str, operation: Operation, args: Value) -> Result<LocalCall, HostError> {
    let Value::Object(args) = args else {
        return Err(HostError::with_code(
            format!("ctx.local.{name} takes an object of arguments"),
            INVALID_ARGUMENTS,
        ));
    };
    let endpoint = match args.get("endpoint") {
        Some(Value::String(id)) if !id.is_empty() => id.clone(),
        other => {
            return Err(invalid(
                name,
                "endpoint",
                "the id of one of the module's local endpoints",
                other,
            ));
        }
    };
    let message = message_text(name, args.get("message"))?;
    let matching = match operation {
        Operation::Send => {
            if args.get("match").is_some_and(|value| !value.is_null()) {
                return Err(HostError::with_code(
                    "ctx.local.send takes no match; use ctx.local.request to wait for the device's answer",
                    INVALID_ARGUMENTS,
                ));
            }
            None
        }
        Operation::Request => Some(read_match(name, &args)?),
    };
    let timeout = read_timeout(name, args.get("timeoutMs"))?;
    Ok(LocalCall {
        endpoint,
        message,
        matching,
        timeout,
    })
}

/// A string is sent as it is; an object or a list is sent as its JSON text.
fn message_text(name: &str, value: Option<&Value>) -> Result<String, HostError> {
    match value {
        Some(Value::String(text)) => Ok(text.clone()),
        Some(value @ (Value::Object(_) | Value::Array(_))) => {
            Ok(serde_json::to_string(value).expect("a JSON value serializes"))
        }
        other => Err(invalid(
            name,
            "message",
            "a string, or an object or list to send as JSON",
            other,
        )),
    }
}

/// `match` is `{ field, value }`: the device's answer is the first JSON
/// object it sends whose top-level `field` holds `value`. The contract bounds
/// both; this reads only their types.
fn read_match(name: &str, args: &Map<String, Value>) -> Result<ModuleEndpointMatch, HostError> {
    let Some(Value::Object(matching)) = args.get("match") else {
        return Err(invalid(
            name,
            "match",
            "an object { field, value } naming the answer to wait for",
            args.get("match"),
        ));
    };
    let field = match matching.get("field") {
        Some(Value::String(field)) => field.clone(),
        other => return Err(invalid(name, "match.field", "a string", other)),
    };
    let value = match matching.get("value") {
        Some(Value::String(text)) => ModuleEndpointMatchValue::Text(text.clone()),
        Some(Value::Number(number)) => match whole_number(number) {
            Some(integer) => ModuleEndpointMatchValue::Integer(integer),
            None => {
                return Err(invalid(
                    name,
                    "match.value",
                    "a string or a whole number",
                    matching.get("value"),
                ));
            }
        },
        other => {
            return Err(invalid(
                name,
                "match.value",
                "a string or a whole number",
                other,
            ));
        }
    };
    Ok(ModuleEndpointMatch { field, value })
}

/// `timeoutMs` is how long the call may wait for the device, a whole number
/// of at least `MIN_BUDGET`. More than `MAX_BUDGET` is read as `MAX_BUDGET`.
fn read_timeout(name: &str, value: Option<&Value>) -> Result<Option<Duration>, HostError> {
    let min = u64::try_from(MIN_BUDGET.as_millis()).expect("fits in u64");
    match value {
        None | Some(Value::Null) => Ok(None),
        Some(Value::Number(number)) => match whole_number(number) {
            Some(ms) if ms >= min as i64 => Ok(Some(Duration::from_millis(ms as u64))),
            _ => Err(invalid(
                name,
                "timeoutMs",
                &format!("a whole number of milliseconds, at least {min}"),
                value,
            )),
        },
        other => Err(invalid(
            name,
            "timeoutMs",
            &format!("a whole number of milliseconds, at least {min}"),
            other,
        )),
    }
}

/// A whole-valued number, also as a float since JavaScript arithmetic can
/// produce one, within the range JavaScript holds exactly.
fn whole_number(number: &serde_json::Number) -> Option<i64> {
    const MAX_SAFE_INTEGER: f64 = 9_007_199_254_740_991.0;
    number.as_i64().or_else(|| {
        number
            .as_f64()
            .filter(|float| float.fract() == 0.0 && float.abs() <= MAX_SAFE_INTEGER)
            .map(|float| float as i64)
    })
}

/// The gateway answers with a `ModuleEndpointReply`: `ok` with the session
/// epoch (and, on a request, the device's answer as raw text), or `failed`
/// with a code and a reason, which is thrown with that code.
fn read_reply(
    name: &str,
    endpoint: &str,
    operation: Operation,
    reply: Value,
) -> Result<Value, HostError> {
    let unreadable = |why: String| {
        HostError::with_code(
            format!("ctx.local.{name}: the connectors host's reply {why}"),
            REQUEST_FAILED,
        )
    };
    let reply: ModuleEndpointReply = serde_json::from_value(reply)
        .map_err(|err| unreadable(format!("is not a module endpoint reply: {err}")))?;
    reply
        .validate()
        .map_err(|err| unreadable(format!("breaks the contract: {err}")))?;
    let ok = match reply {
        ModuleEndpointReply::Ok(ok) => ok,
        ModuleEndpointReply::Failed(failed) => {
            return Err(HostError::with_code(
                format!(
                    "ctx.local.{name} to endpoint {endpoint:?}: {}",
                    failed.message
                ),
                failed.code.to_string(),
            ));
        }
    };
    match operation {
        Operation::Send => Ok(json!({ "ok": true, "sessionEpoch": ok.session_epoch })),
        Operation::Request => {
            let text = ok
                .reply
                .ok_or_else(|| unreadable("has no answer from the device".to_string()))?;
            let answer: Value = serde_json::from_str(&text)
                .map_err(|err| unreadable(format!("carries an answer that is not JSON: {err}")))?;
            Ok(json!({ "reply": answer, "sessionEpoch": ok.session_epoch }))
        }
    }
}

fn invalid(name: &str, key: &str, expected: &str, got: Option<&Value>) -> HostError {
    HostError::with_code(
        format!(
            "ctx.local.{name}: {key} must be {expected}, got {}",
            describe(got)
        ),
        INVALID_ARGUMENTS,
    )
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::protected_settings::RegisteredLocalEndpoint;
    use std::collections::HashSet;
    use std::sync::Mutex;
    use std::sync::mpsc;
    use std::time::Instant;

    const MODULE: &str = "vtube_studio";

    /// Answers every request with `reply` and records what was asked.
    struct FakeConnectorsHost {
        reply: Result<Value, RequestError>,
        requests: Mutex<Vec<(String, Value, Duration)>>,
    }

    impl FakeConnectorsHost {
        fn answering(reply: Result<Value, RequestError>) -> Arc<Self> {
            Arc::new(Self {
                reply,
                requests: Mutex::new(Vec::new()),
            })
        }

        fn ok() -> Arc<Self> {
            Self::answering(Ok(json!({ "status": "ok", "sessionEpoch": "e1" })))
        }

        fn sent(&self) -> Vec<(String, Value, Duration)> {
            self.requests.lock().unwrap().clone()
        }

        fn budgets(&self) -> Vec<i64> {
            self.sent()
                .iter()
                .map(|(_, request, _)| request["budgetMs"].as_i64().unwrap())
                .collect()
        }
    }

    impl NatsRequester for FakeConnectorsHost {
        fn request(
            &self,
            subject: &str,
            data: Value,
            timeout: Duration,
        ) -> Result<Value, RequestError> {
            self.requests
                .lock()
                .unwrap()
                .push((subject.to_string(), data, timeout));
            self.reply.clone()
        }
    }

    fn endpoint(id: &str, protocol: LocalEndpointProtocol) -> RegisteredLocalEndpoint {
        RegisteredLocalEndpoint {
            id: id.into(),
            protocol,
        }
    }

    fn scope_until(deadline: Instant) -> CallScope {
        CallScope::new(HashSet::new(), deadline)
            .with_module_id(MODULE.to_string())
            .with_local_endpoints(vec![
                endpoint("vts", LocalEndpointProtocol::Websocket),
                endpoint("lights", LocalEndpointProtocol::Http),
            ])
    }

    fn scope() -> CallScope {
        scope_until(Instant::now() + Duration::from_secs(30))
    }

    fn call(
        ext: &LocalExtension,
        name: &str,
        scope: &CallScope,
        args: Value,
    ) -> Result<Value, HostError> {
        ext.functions()
            .iter()
            .find(|f| f.name == name)
            .unwrap()
            .call(NAMESPACE, scope, args)
    }

    fn ask(ext: &LocalExtension, scope: &CallScope) -> Result<Value, HostError> {
        call(
            ext,
            "request",
            scope,
            json!({ "endpoint": "vts", "message": { "requestID": "r1" }, "match": { "field": "requestID", "value": "r1" } }),
        )
    }

    #[test]
    fn test_local_exposes_send_and_request_with_no_permission() {
        let ext = LocalExtension::new(FakeConnectorsHost::ok());
        let table: Vec<(&str, Option<&str>)> = ext
            .functions()
            .iter()
            .map(|f| (f.name.as_str(), f.permission))
            .collect();
        assert_eq!(table, vec![("send", None), ("request", None)]);
    }

    #[test]
    fn test_local_send_asks_the_gateway_and_returns_the_session_epoch() {
        let nats = FakeConnectorsHost::ok();
        let ext = LocalExtension::new(nats.clone());

        let result = call(
            &ext,
            "send",
            &scope(),
            json!({ "endpoint": "vts", "message": "hello" }),
        )
        .unwrap();

        assert_eq!(result, json!({ "ok": true, "sessionEpoch": "e1" }));
        let sent = nats.sent();
        assert_eq!(sent.len(), 1);
        let (subject, request, timeout) = &sent[0];
        assert_eq!(subject, "engine.companion.module.request");
        assert_eq!(*timeout, REQUEST_TIMEOUT);
        assert_eq!(
            *request,
            json!({
                "op": "send",
                "moduleId": MODULE,
                "endpointId": "vts",
                "message": "hello",
                "budgetMs": 4500
            })
        );
    }

    #[test]
    fn test_local_request_sends_an_object_as_json_and_returns_the_parsed_answer() {
        let nats = FakeConnectorsHost::answering(Ok(json!({
            "status": "ok",
            "reply": "{\"requestID\":\"r1\",\"data\":{\"active\":true}}",
            "sessionEpoch": "e2"
        })));
        let ext = LocalExtension::new(nats.clone());

        let result = ask(&ext, &scope()).unwrap();

        assert_eq!(
            result,
            json!({ "reply": { "requestID": "r1", "data": { "active": true } }, "sessionEpoch": "e2" })
        );
        let (_, request, _) = &nats.sent()[0];
        assert_eq!(
            *request,
            json!({
                "op": "request",
                "moduleId": MODULE,
                "endpointId": "vts",
                "message": "{\"requestID\":\"r1\"}",
                "budgetMs": 4500,
                "match": { "field": "requestID", "value": "r1" }
            })
        );
    }

    #[test]
    fn test_local_module_id_comes_from_the_invocation_not_the_arguments() {
        let nats = FakeConnectorsHost::ok();
        let ext = LocalExtension::new(nats.clone());

        call(
            &ext,
            "send",
            &scope(),
            json!({ "endpoint": "vts", "message": "x", "moduleId": "woofx3_obs", "endpointId": "obs" }),
        )
        .unwrap();

        let (_, request, _) = &nats.sent()[0];
        assert_eq!(request["moduleId"], MODULE);
        assert_eq!(request["endpointId"], "vts");
    }

    #[test]
    fn test_local_undeclared_and_http_endpoints_are_refused_before_any_request() {
        let nats = FakeConnectorsHost::ok();
        let ext = LocalExtension::new(nats.clone());

        for (endpoint, code) in [
            ("obs", "not_declared"),
            ("other_module_endpoint", "not_declared"),
            ("lights", "protocol_unsupported"),
        ] {
            for (name, args) in [
                ("send", json!({ "endpoint": endpoint, "message": "x" })),
                (
                    "request",
                    json!({ "endpoint": endpoint, "message": "x", "match": { "field": "id", "value": 1 } }),
                ),
            ] {
                let err = call(&ext, name, &scope(), args).unwrap_err();
                assert_eq!(err.code.as_deref(), Some(code), "{name} {endpoint}: {err}");
                assert!(err.message.contains(endpoint), "{err}");
            }
        }
        assert!(nats.sent().is_empty());
    }

    #[test]
    fn test_local_a_builtin_invocation_declares_no_endpoint() {
        let nats = FakeConnectorsHost::ok();
        let ext = LocalExtension::new(nats.clone());
        let builtin = CallScope::new(HashSet::new(), Instant::now() + Duration::from_secs(30));

        let err = call(
            &ext,
            "send",
            &builtin,
            json!({ "endpoint": "vts", "message": "x" }),
        )
        .unwrap_err();

        assert_eq!(err.code.as_deref(), Some("not_declared"));
        assert!(nats.sent().is_empty());
    }

    #[test]
    fn test_local_bad_arguments_are_refused_with_the_reason_before_sending() {
        let nats = FakeConnectorsHost::ok();
        let ext = LocalExtension::new(nats.clone());
        let big = "x".repeat(65_537);

        for (name, args, reason) in [
            ("send", json!("vts"), "takes an object of arguments"),
            ("send", json!({ "message": "x" }), "endpoint must be the id"),
            (
                "send",
                json!({ "endpoint": "vts" }),
                "message must be a string, or an object or list",
            ),
            (
                "send",
                json!({ "endpoint": "vts", "message": 7 }),
                "message must be a string",
            ),
            (
                "send",
                json!({ "endpoint": "vts", "message": "" }),
                "message:",
            ),
            (
                "send",
                json!({ "endpoint": "vts", "message": big }),
                "message:",
            ),
            (
                "send",
                json!({ "endpoint": "vts", "message": "x", "match": { "field": "id", "value": 1 } }),
                "takes no match",
            ),
            (
                "request",
                json!({ "endpoint": "vts", "message": "x" }),
                "match must be an object",
            ),
            (
                "request",
                json!({ "endpoint": "vts", "message": "x", "match": { "value": 1 } }),
                "match.field must be a string",
            ),
            (
                "request",
                json!({ "endpoint": "vts", "message": "x", "match": { "field": "id", "value": 1.5 } }),
                "match.value must be a string or a whole number",
            ),
            (
                "request",
                json!({ "endpoint": "vts", "message": "x", "match": { "field": "id", "value": true } }),
                "match.value must be a string or a whole number",
            ),
            (
                "request",
                json!({ "endpoint": "vts", "message": "x", "match": { "field": "not a field!", "value": 1 } }),
                "match.field:",
            ),
            (
                "request",
                json!({ "endpoint": "vts", "message": "x", "match": { "field": "id", "value": "" } }),
                "match.value:",
            ),
            (
                "send",
                json!({ "endpoint": "vts", "message": "x", "timeoutMs": 50 }),
                "timeoutMs must be a whole number of milliseconds, at least 100",
            ),
            (
                "send",
                json!({ "endpoint": "vts", "message": "x", "timeoutMs": "1000" }),
                "timeoutMs must be",
            ),
        ] {
            let err = call(&ext, name, &scope(), args).unwrap_err();
            assert_eq!(
                err.code.as_deref(),
                Some(INVALID_ARGUMENTS),
                "{name}: {err}"
            );
            assert!(err.message.contains(reason), "{name}: {err}");
        }
        assert!(nats.sent().is_empty());
    }

    #[test]
    fn test_local_a_whole_float_match_value_is_sent_as_an_integer() {
        let nats = FakeConnectorsHost::answering(Ok(json!({
            "status": "ok", "reply": "{\"id\":3}", "sessionEpoch": "e1"
        })));
        let ext = LocalExtension::new(nats.clone());

        call(
            &ext,
            "request",
            &scope(),
            json!({ "endpoint": "vts", "message": [1, 2], "match": { "field": "id", "value": 3.0 } }),
        )
        .unwrap();

        let (_, request, _) = &nats.sent()[0];
        assert_eq!(request["match"]["value"], json!(3));
        assert_eq!(request["message"], json!("[1,2]"));
    }

    #[test]
    fn test_local_budget_is_clamped_to_the_ask_the_cap_and_the_deadline() {
        let cases = [
            (
                "no timeoutMs, plenty of time",
                None,
                30_000,
                Some((4_500, 4_500)),
            ),
            ("a shorter ask", Some(1_000), 30_000, Some((1_000, 1_000))),
            (
                "an ask past the cap",
                Some(9_000),
                30_000,
                Some((4_500, 4_500)),
            ),
            (
                "the deadline less the margin",
                None,
                1_000,
                Some((700, 800)),
            ),
            (
                "the ask under the deadline",
                Some(300),
                1_000,
                Some((300, 300)),
            ),
        ];
        for (case, timeout_ms, remaining_ms, expected) in cases {
            let nats = FakeConnectorsHost::ok();
            let ext = LocalExtension::new(nats.clone());
            let mut args = json!({ "endpoint": "vts", "message": "x" });
            if let Some(ms) = timeout_ms {
                args["timeoutMs"] = json!(ms);
            }
            let scope = scope_until(Instant::now() + Duration::from_millis(remaining_ms));

            call(&ext, "send", &scope, args).unwrap();

            let (low, high) = expected.unwrap();
            let budget = nats.budgets()[0];
            assert!(
                (low..=high).contains(&budget),
                "{case}: budget {budget} not in {low}..={high}"
            );
            assert!(nats.sent()[0].2 <= Duration::from_millis(remaining_ms));
        }
    }

    #[test]
    fn test_local_too_little_time_left_is_a_timeout_without_a_request() {
        for remaining_ms in [0, 250] {
            let nats = FakeConnectorsHost::ok();
            let ext = LocalExtension::new(nats.clone());
            let scope = scope_until(Instant::now() + Duration::from_millis(remaining_ms));

            let err = call(
                &ext,
                "send",
                &scope,
                json!({ "endpoint": "vts", "message": "x" }),
            )
            .unwrap_err();

            assert_eq!(
                err.code.as_deref(),
                Some(TIMEOUT),
                "{remaining_ms}ms: {err}"
            );
            assert!(nats.sent().is_empty(), "{remaining_ms}ms");
        }
    }

    #[test]
    fn test_local_budget_bounds_are_the_contracts() {
        let call = LocalCall {
            endpoint: "vts".into(),
            message: "x".into(),
            matching: None,
            timeout: None,
        };
        call.request(MODULE, MAX_BUDGET).validate().unwrap();
        call.request(MODULE, MIN_BUDGET).validate().unwrap();
        assert!(
            call.request(MODULE, MAX_BUDGET + Duration::from_millis(1))
                .validate()
                .is_err()
        );
        assert!(
            call.request(MODULE, MIN_BUDGET - Duration::from_millis(1))
                .validate()
                .is_err()
        );
        assert!(MAX_BUDGET < REQUEST_TIMEOUT);
    }

    #[test]
    fn test_local_a_run_may_make_only_so_many_calls() {
        let ext = LocalExtension::with_limits(
            FakeConnectorsHost::ok(),
            Limits {
                max_calls_per_invocation: 2,
                ..Limits::default()
            },
        );
        let scope = scope();
        let send = |scope: &CallScope| {
            call(
                &ext,
                "send",
                scope,
                json!({ "endpoint": "vts", "message": "x" }),
            )
        };
        send(&scope).unwrap();
        send(&scope).unwrap();
        let err = send(&scope).unwrap_err();
        assert!(matches!(err.code.as_deref(), Some(CALL_LIMIT)), "{err}");
        send(&self::scope()).expect("the limit is per invocation");
        assert_eq!(
            MAX_CALLS_PER_INVOCATION,
            Limits::default().max_calls_per_invocation
        );
    }

    /// Holds every request until released, so a test can keep the in-flight
    /// slots taken.
    struct HeldConnectorsHost {
        entered: Mutex<mpsc::Sender<()>>,
        release: Mutex<mpsc::Receiver<()>>,
    }

    impl NatsRequester for HeldConnectorsHost {
        fn request(&self, _: &str, _: Value, _: Duration) -> Result<Value, RequestError> {
            self.entered.lock().unwrap().send(()).unwrap();
            self.release.lock().unwrap().recv().unwrap();
            Ok(json!({ "status": "ok", "sessionEpoch": "e1" }))
        }
    }

    #[test]
    fn test_local_a_call_waits_for_an_in_flight_slot_then_is_busy() {
        let (entered_tx, entered_rx) = mpsc::channel();
        let (release_tx, release_rx) = mpsc::channel();
        let held = Arc::new(HeldConnectorsHost {
            entered: Mutex::new(entered_tx),
            release: Mutex::new(release_rx),
        });
        let ext = Arc::new(LocalExtension::with_limits(
            held,
            Limits {
                max_in_flight: 1,
                in_flight_wait: Duration::from_millis(20),
                ..Limits::default()
            },
        ));

        let first = std::thread::spawn({
            let ext = ext.clone();
            move || {
                call(
                    &ext,
                    "send",
                    &scope(),
                    json!({ "endpoint": "vts", "message": "x" }),
                )
            }
        });
        entered_rx.recv().unwrap();

        let err = call(
            &ext,
            "send",
            &scope(),
            json!({ "endpoint": "vts", "message": "y" }),
        )
        .unwrap_err();
        assert!(matches!(err.code.as_deref(), Some(BUSY)), "{err}");

        release_tx.send(()).unwrap();
        first.join().unwrap().unwrap();
    }

    #[test]
    fn test_local_gateway_failures_are_thrown_with_their_code() {
        let codes = [
            ModuleEndpointFailureCode::NotDeclared,
            ModuleEndpointFailureCode::AdapterOwned,
            ModuleEndpointFailureCode::ProtocolUnsupported,
            ModuleEndpointFailureCode::NotRouted,
            ModuleEndpointFailureCode::AddressRefused,
            ModuleEndpointFailureCode::StoreUnreadable,
            ModuleEndpointFailureCode::Unavailable,
            ModuleEndpointFailureCode::Timeout,
            ModuleEndpointFailureCode::Busy,
            ModuleEndpointFailureCode::Invalid,
        ];
        for code in codes {
            let ext = LocalExtension::new(FakeConnectorsHost::answering(Ok(json!({
                "status": "failed",
                "code": code,
                "message": "turn on the companion for this endpoint",
                "sessionEpoch": "e1"
            }))));

            let err = ask(&ext, &scope()).unwrap_err();

            let expected = code.to_string();
            assert_eq!(err.code.as_deref(), Some(expected.as_str()));
            assert_eq!(
                err.message,
                "ctx.local.request to endpoint \"vts\": turn on the companion for this endpoint"
            );
        }
    }

    #[test]
    fn test_local_codes_barkloader_sets_are_spelled_as_the_contracts() {
        assert_eq!(TIMEOUT, ModuleEndpointFailureCode::Timeout.to_string());
        assert_eq!(
            UNAVAILABLE,
            ModuleEndpointFailureCode::Unavailable.to_string()
        );
        assert_eq!(BUSY, ModuleEndpointFailureCode::Busy.to_string());
    }

    #[test]
    fn test_local_an_unreadable_reply_is_a_failed_request() {
        for reply in [
            json!({ "ok": true }),
            json!({ "status": "ok" }),
            json!({ "status": "failed", "code": "exploded", "message": "x" }),
            json!({ "status": "ok", "sessionEpoch": "" }),
            json!({ "status": "ok", "sessionEpoch": "e1" }),
            json!({ "status": "ok", "reply": "not json", "sessionEpoch": "e1" }),
        ] {
            let ext = LocalExtension::new(FakeConnectorsHost::answering(Ok(reply.clone())));
            let err = ask(&ext, &scope()).unwrap_err();
            assert!(
                matches!(err.code.as_deref(), Some(REQUEST_FAILED)),
                "{reply}: {err}"
            );
        }
    }

    #[test]
    fn test_local_transport_failures_carry_codes_a_module_can_branch_on() {
        for (name, reply, code, words) in [
            (
                "send",
                Err(RequestError::TimedOut),
                TIMEOUT,
                "may still have been sent",
            ),
            (
                "request",
                Err(RequestError::TimedOut),
                TIMEOUT,
                "did not answer",
            ),
            (
                "send",
                Err(RequestError::NoResponders),
                UNAVAILABLE,
                "no connectors host is running",
            ),
            (
                "send",
                Err(RequestError::Failed("broken pipe".into())),
                REQUEST_FAILED,
                "broken pipe",
            ),
        ] {
            let ext = LocalExtension::new(FakeConnectorsHost::answering(reply));
            let err = call(
                &ext,
                name,
                &scope(),
                json!({ "endpoint": "vts", "message": "x", "match": if name == "request" { json!({ "field": "id", "value": 1 }) } else { Value::Null } }),
            )
            .unwrap_err();
            assert_eq!(err.code.as_deref(), Some(code), "{name}: {err}");
            assert!(err.message.contains(words), "{name}: {err}");
            if name == "request" {
                assert!(!err.message.contains("sent"), "{err}");
            }
        }
    }
}
