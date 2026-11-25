//! `ctx.<platform>`: asks a connectors platform adapter to act on the linked
//! channel and returns what it answered.
//!
//! Each call is a request/reply on the platform's `<platform>api` subject,
//! made on the sandbox's blocking thread, so module code gets the result (a
//! clip's url, a user's profile) or an error it can handle, instead of firing
//! and hoping. The adapter owns every platform rule and answers a refusal
//! with its own message, which is thrown to the module unchanged.
//!
//! A waiting call holds one of the runtime's blocking threads, so every call
//! is bounded three ways: by what is left of the invocation's deadline, by a
//! per-invocation call count, and by a limit on requests in flight at once.
//! Each platform's extension has its own call count and in-flight limit.

use super::in_flight::InFlight;
use crate::host::{CallScope, HostError, HostExtension, HostFunction, NatsRequester, RequestError};
use serde_json::{Value, json};
use std::sync::Arc;
use std::time::Duration;

/// One platform's api as module code sees it.
#[derive(Debug)]
pub struct PlatformApiSpec {
    /// The `ctx` namespace, e.g. `twitch` for `ctx.twitch`.
    pub namespace: &'static str,
    /// The connectors subject the adapter serves, e.g. `twitchapi`.
    pub subject: &'static str,
    /// The platform's name in messages a streamer may read.
    pub display_name: &'static str,
    /// The commands module code may call, each the adapter's own command
    /// name, with the manifest permission it needs.
    pub commands: &'static [(&'static str, Option<&'static str>)],
    /// The commands an uploaded module's form fields may request on
    /// `subject`. Each is a read a picker needs; see
    /// `lib_module::manifest_validate`'s form request check.
    pub field_source_commands: &'static [&'static str],
}

impl PlatformApiSpec {
    /// The reply type the adapter answers a refused request with; must match
    /// `platformApiErrorType` in shared/common/typescript/cloudevents/PlatformApi/reply.ts.
    pub fn error_reply_type(&self) -> String {
        format!("{}.error", self.subject)
    }
}

/// Every platform api a module can reach, served by its own extension.
pub const PLATFORM_API_SPECS: &[&PlatformApiSpec] =
    &[&super::twitch::TWITCH_SPEC, &super::kick::KICK_SPEC];

/// The longest one call waits for the adapter. Platforms answer in well under
/// a second; this bounds a hung service. A call never waits past the
/// invocation's deadline either.
pub const REQUEST_TIMEOUT: Duration = Duration::from_secs(10);

/// How many calls into one platform's api one invocation may make. A function
/// that acts on the channel does a handful; more is a loop.
pub const MAX_CALLS_PER_INVOCATION: u32 = 10;

/// How many requests may wait on one platform's adapter at once, across every
/// invocation. Each holds a blocking thread, so this keeps a slow adapter from
/// starving everything else the sandbox runs.
pub const MAX_IN_FLIGHT: usize = 32;

/// How long a call waits for an in-flight slot before giving up.
pub const IN_FLIGHT_WAIT: Duration = Duration::from_secs(2);

/// `code`s a module can branch on, besides `PERMISSION_DENIED` and whatever
/// `code` the adapter puts on a refusal.
pub const TIMEOUT: &str = "timeout";
pub const UNAVAILABLE: &str = "unavailable";
pub const REQUEST_FAILED: &str = "request_failed";
pub const CALL_LIMIT: &str = "call_limit";
pub const BUSY: &str = "busy";

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

pub struct PlatformApiExtension {
    spec: &'static PlatformApiSpec,
    functions: Vec<HostFunction>,
}

impl PlatformApiExtension {
    pub fn new(nats: Arc<dyn NatsRequester>, spec: &'static PlatformApiSpec) -> Self {
        Self::with_limits(nats, spec, Limits::default())
    }

    pub fn with_limits(
        nats: Arc<dyn NatsRequester>,
        spec: &'static PlatformApiSpec,
        limits: Limits,
    ) -> Self {
        let in_flight = Arc::new(InFlight::new(limits.max_in_flight));
        let functions = spec
            .commands
            .iter()
            .map(|&(command, permission)| {
                let nats = nats.clone();
                let in_flight = in_flight.clone();
                HostFunction::scoped(command, move |scope: &CallScope, args: Value| {
                    request(
                        nats.as_ref(),
                        spec,
                        &in_flight,
                        &limits,
                        scope,
                        command,
                        args,
                    )
                })
                .requiring(permission)
            })
            .collect();
        Self { spec, functions }
    }
}

impl HostExtension for PlatformApiExtension {
    fn namespace(&self) -> &str {
        self.spec.namespace
    }

    fn functions(&self) -> &[HostFunction] {
        &self.functions
    }
}

fn request(
    nats: &dyn NatsRequester,
    spec: &PlatformApiSpec,
    in_flight: &InFlight,
    limits: &Limits,
    scope: &CallScope,
    command: &str,
    args: Value,
) -> Result<Value, HostError> {
    let namespace = spec.namespace;
    let platform = spec.display_name;
    let args = match args {
        Value::Null => json!({}),
        Value::Object(_) => args,
        _ => {
            return Err(HostError::new(format!(
                "ctx.{namespace}.{command} takes an object of arguments"
            )));
        }
    };

    let made = scope.record_call(namespace);
    if made > limits.max_calls_per_invocation {
        return Err(HostError::with_code(
            format!(
                "ctx.{namespace}.{command}: a function may make at most {} ctx.{namespace} calls per run",
                limits.max_calls_per_invocation
            ),
            CALL_LIMIT,
        ));
    }

    let spent = || {
        HostError::with_code(
            format!("ctx.{namespace}.{command}: the function has run out of time"),
            TIMEOUT,
        )
    };
    if scope.remaining().is_zero() {
        return Err(spent());
    }
    let Some(_slot) = in_flight.acquire(limits.in_flight_wait.min(scope.remaining())) else {
        return Err(HostError::with_code(
            format!(
                "ctx.{namespace}.{command}: too many {namespace} requests are waiting; try again shortly"
            ),
            BUSY,
        ));
    };
    let timeout = limits.request_timeout.min(scope.remaining());
    if timeout.is_zero() {
        return Err(spent());
    }

    let payload = json!({ "command": command, "args": args });
    match nats.request(spec.subject, payload, timeout) {
        Ok(reply) => read_reply(spec, command, reply),
        Err(RequestError::TimedOut) => Err(HostError::with_code(
            format!(
                "ctx.{namespace}.{command}: the engine's {platform} connection did not answer within {:.1}s; it may still have acted",
                timeout.as_secs_f64()
            ),
            TIMEOUT,
        )),
        Err(RequestError::NoResponders) => Err(HostError::with_code(
            format!("ctx.{namespace}.{command}: the engine's {platform} connection is not running"),
            UNAVAILABLE,
        )),
        Err(RequestError::Failed(reason)) => Err(HostError::with_code(
            format!("ctx.{namespace}.{command}: {reason}"),
            REQUEST_FAILED,
        )),
    }
}

/// The adapter replies with a CloudEvent: `data` is the result, or
/// `{ error, code? }` when `type` is the spec's error reply type.
fn read_reply(spec: &PlatformApiSpec, command: &str, reply: Value) -> Result<Value, HostError> {
    let data = reply.get("data").cloned().unwrap_or(Value::Null);
    if reply.get("type").and_then(Value::as_str) != Some(spec.error_reply_type().as_str()) {
        return Ok(data);
    }
    let message = data
        .get("error")
        .and_then(Value::as_str)
        .map(str::to_string)
        .unwrap_or_else(|| format!("ctx.{}.{command} failed", spec.namespace));
    Err(match data.get("code").and_then(Value::as_str) {
        Some(code) => HostError::with_code(message, code),
        None => HostError::new(message),
    })
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::host::PERMISSION_DENIED;
    use std::sync::Mutex;
    use std::time::Instant;

    /// Answers every request with `reply` and records what was asked.
    struct FakeAdapter {
        reply: Result<Value, RequestError>,
        requests: Mutex<Vec<(String, Value, Duration)>>,
    }

    impl FakeAdapter {
        fn answering(reply: Result<Value, RequestError>) -> Arc<Self> {
            Arc::new(Self {
                reply,
                requests: Mutex::new(Vec::new()),
            })
        }
    }

    impl NatsRequester for FakeAdapter {
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

    fn function<'a>(ext: &'a PlatformApiExtension, name: &str) -> &'a HostFunction {
        ext.functions().iter().find(|f| f.name == name).unwrap()
    }

    /// A command any module may call.
    fn open_command(spec: &PlatformApiSpec) -> &'static str {
        spec.commands
            .iter()
            .find(|(_, permission)| permission.is_none())
            .map(|(command, _)| *command)
            .expect("every platform api has a command that needs no permission")
    }

    fn privileged_commands(spec: &PlatformApiSpec) -> Vec<(&'static str, &'static str)> {
        spec.commands
            .iter()
            .filter_map(|&(command, permission)| permission.map(|p| (command, p)))
            .collect()
    }

    fn granted(ids: &[&str]) -> CallScope {
        CallScope::new(
            ids.iter().map(|id| id.to_string()).collect(),
            Instant::now() + Duration::from_secs(30),
        )
    }

    fn limits(change: impl FnOnce(&mut Limits)) -> Limits {
        let mut limits = Limits::default();
        change(&mut limits);
        limits
    }

    fn result_reply(spec: &PlatformApiSpec, command: &str, data: Value) -> Value {
        json!({
            "type": format!("{}.{command}.result", spec.subject),
            "source": spec.subject,
            "data": data
        })
    }

    #[test]
    fn exposes_each_spec_command_with_its_permission_under_its_namespace() {
        for spec in PLATFORM_API_SPECS {
            let ext = PlatformApiExtension::new(FakeAdapter::answering(Ok(Value::Null)), spec);
            let table: Vec<(&str, Option<&str>)> = ext
                .functions()
                .iter()
                .map(|f| (f.name.as_str(), f.permission))
                .collect();
            assert_eq!(table, spec.commands.to_vec(), "{}", spec.namespace);
            assert_eq!(ext.namespace(), spec.namespace);
        }
    }

    #[test]
    fn specs_have_distinct_namespaces_and_subjects() {
        for (i, a) in PLATFORM_API_SPECS.iter().enumerate() {
            for b in &PLATFORM_API_SPECS[i + 1..] {
                assert_ne!(a.namespace, b.namespace);
                assert_ne!(a.subject, b.subject);
            }
        }
    }

    #[test]
    fn requests_the_command_on_the_spec_subject_and_returns_the_reply_data() {
        for spec in PLATFORM_API_SPECS {
            let command = open_command(spec);
            let nats =
                FakeAdapter::answering(Ok(result_reply(spec, command, json!({ "id": "m1" }))));
            let ext = PlatformApiExtension::new(nats.clone(), spec);

            let result = function(&ext, command)
                .call(
                    spec.namespace,
                    &granted(&[]),
                    json!({ "description": "clutch" }),
                )
                .unwrap();

            assert_eq!(result, json!({ "id": "m1" }));
            let requests = nats.requests.lock().unwrap();
            assert_eq!(
                requests[0],
                (
                    spec.subject.to_string(),
                    json!({ "command": command, "args": { "description": "clutch" } }),
                    REQUEST_TIMEOUT
                )
            );
        }
    }

    #[test]
    fn a_call_without_arguments_sends_empty_args() {
        for spec in PLATFORM_API_SPECS {
            let command = open_command(spec);
            let nats = FakeAdapter::answering(Ok(result_reply(spec, command, json!({}))));
            let ext = PlatformApiExtension::new(nats.clone(), spec);
            function(&ext, command)
                .call(spec.namespace, &granted(&[]), Value::Null)
                .unwrap();
            assert_eq!(
                nats.requests.lock().unwrap()[0].1,
                json!({ "command": command, "args": {} })
            );
        }
    }

    #[test]
    fn refuses_arguments_that_are_not_an_object_without_sending() {
        for spec in PLATFORM_API_SPECS {
            let nats = FakeAdapter::answering(Ok(Value::Null));
            let ext = PlatformApiExtension::new(nats.clone(), spec);
            let err = function(&ext, open_command(spec))
                .call(spec.namespace, &granted(&[]), json!("someone"))
                .unwrap_err();
            assert!(err.message.contains("takes an object"), "{err}");
            assert!(nats.requests.lock().unwrap().is_empty());
        }
    }

    #[test]
    fn privileged_commands_are_refused_without_their_permission_before_sending() {
        for spec in PLATFORM_API_SPECS {
            let nats = FakeAdapter::answering(Ok(json!({ "type": "x", "data": {} })));
            let ext = PlatformApiExtension::new(nats.clone(), spec);
            let privileged = privileged_commands(spec);

            for &(name, needed) in &privileged {
                let err = function(&ext, name)
                    .call(spec.namespace, &granted(&[]), json!({}))
                    .unwrap_err();
                assert_eq!(err.code.as_deref(), Some(PERMISSION_DENIED), "{name}");
                assert!(err.message.contains(needed), "{err}");
            }
            assert!(nats.requests.lock().unwrap().is_empty());

            for &(name, needed) in &privileged {
                function(&ext, name)
                    .call(spec.namespace, &granted(&[needed]), json!({}))
                    .unwrap();
            }
            assert_eq!(nats.requests.lock().unwrap().len(), privileged.len());
        }
    }

    #[test]
    fn a_refusal_is_thrown_with_the_adapter_message_and_code() {
        for spec in PLATFORM_API_SPECS {
            let ext = PlatformApiExtension::new(
                FakeAdapter::answering(Ok(json!({
                    "type": spec.error_reply_type(),
                    "data": { "error": "the channel is not live", "code": "not_live" }
                }))),
                spec,
            );
            let err = function(&ext, open_command(spec))
                .call(spec.namespace, &granted(&[]), Value::Null)
                .unwrap_err();
            assert_eq!(
                err,
                HostError::with_code("the channel is not live", "not_live")
            );
        }
    }

    #[test]
    fn a_refusal_without_a_code_keeps_the_message() {
        for spec in PLATFORM_API_SPECS {
            let ext = PlatformApiExtension::new(
                FakeAdapter::answering(Ok(json!({
                    "type": spec.error_reply_type(),
                    "data": { "error": "not linked yet" }
                }))),
                spec,
            );
            let err = function(&ext, open_command(spec))
                .call(spec.namespace, &granted(&[]), Value::Null)
                .unwrap_err();
            assert_eq!(err, HostError::new("not linked yet"));
        }
    }

    #[test]
    fn another_platforms_error_type_is_not_a_refusal() {
        for spec in PLATFORM_API_SPECS {
            let ext = PlatformApiExtension::new(
                FakeAdapter::answering(Ok(json!({
                    "type": "otherapi.error",
                    "data": { "error": "not ours" }
                }))),
                spec,
            );
            let result = function(&ext, open_command(spec))
                .call(spec.namespace, &granted(&[]), Value::Null)
                .unwrap();
            assert_eq!(result, json!({ "error": "not ours" }));
        }
    }

    #[test]
    fn transport_failures_map_to_codes() {
        for spec in PLATFORM_API_SPECS {
            let command = open_command(spec);
            for (failure, code, says) in [
                (
                    RequestError::TimedOut,
                    TIMEOUT,
                    format!(
                        "{} connection did not answer within 3.0s",
                        spec.display_name
                    ),
                ),
                (
                    RequestError::NoResponders,
                    UNAVAILABLE,
                    format!("{} connection is not running", spec.display_name),
                ),
                (
                    RequestError::Failed("connection closed".to_string()),
                    REQUEST_FAILED,
                    "connection closed".to_string(),
                ),
            ] {
                let ext = PlatformApiExtension::with_limits(
                    FakeAdapter::answering(Err(failure)),
                    spec,
                    limits(|l| l.request_timeout = Duration::from_secs(3)),
                );
                let err = function(&ext, command)
                    .call(spec.namespace, &granted(&[]), Value::Null)
                    .unwrap_err();
                assert_eq!(err.code.as_deref(), Some(code));
                assert!(
                    err.message
                        .starts_with(&format!("ctx.{}.{command}: ", spec.namespace)),
                    "{err}"
                );
                assert!(err.message.contains(&says), "{err}");
            }
        }
    }

    #[test]
    fn a_call_after_the_invocation_deadline_is_refused_without_sending() {
        for spec in PLATFORM_API_SPECS {
            let nats = FakeAdapter::answering(Ok(json!({ "type": "x", "data": {} })));
            let ext = PlatformApiExtension::new(nats.clone(), spec);
            let spent = CallScope::new(Default::default(), Instant::now());
            let err = function(&ext, open_command(spec))
                .call(spec.namespace, &spent, Value::Null)
                .unwrap_err();
            assert_eq!(err.code.as_deref(), Some(TIMEOUT));
            assert!(err.message.contains("run out of time"), "{err}");
            assert!(nats.requests.lock().unwrap().is_empty());
        }
    }

    #[test]
    fn a_call_waits_no_longer_than_the_invocation_has_left() {
        for spec in PLATFORM_API_SPECS {
            let nats = FakeAdapter::answering(Ok(json!({ "type": "x", "data": {} })));
            let ext = PlatformApiExtension::new(nats.clone(), spec);
            let short = CallScope::new(Default::default(), Instant::now() + Duration::from_secs(2));
            function(&ext, open_command(spec))
                .call(spec.namespace, &short, Value::Null)
                .unwrap();
            let waited = nats.requests.lock().unwrap()[0].2;
            assert!(waited <= Duration::from_secs(2), "{waited:?}");
            assert!(waited > Duration::ZERO);
        }
    }

    #[test]
    fn an_invocation_may_make_only_so_many_calls() {
        for spec in PLATFORM_API_SPECS {
            let command = open_command(spec);
            let nats = FakeAdapter::answering(Ok(json!({ "type": "x", "data": {} })));
            let ext = PlatformApiExtension::new(nats.clone(), spec);
            let scope = granted(&[]);
            for _ in 0..MAX_CALLS_PER_INVOCATION {
                function(&ext, command)
                    .call(spec.namespace, &scope, Value::Null)
                    .unwrap();
            }
            let err = function(&ext, command)
                .call(spec.namespace, &scope, Value::Null)
                .unwrap_err();
            assert_eq!(err.code.as_deref(), Some(CALL_LIMIT));
            assert!(err.message.contains("at most 10"), "{err}");
            assert_eq!(
                nats.requests.lock().unwrap().len(),
                MAX_CALLS_PER_INVOCATION as usize
            );

            function(&ext, command)
                .call(spec.namespace, &granted(&[]), Value::Null)
                .expect("the limit is per invocation");
        }
    }

    /// Holds every request until released, so a test can keep one in flight.
    struct HeldAdapter {
        started: Mutex<std::sync::mpsc::Sender<()>>,
        release: Mutex<std::sync::mpsc::Receiver<()>>,
    }

    impl NatsRequester for HeldAdapter {
        fn request(&self, _: &str, _: Value, _: Duration) -> Result<Value, RequestError> {
            self.started.lock().unwrap().send(()).unwrap();
            self.release.lock().unwrap().recv().unwrap();
            Ok(json!({ "type": "x", "data": {} }))
        }
    }

    #[test]
    fn a_call_is_refused_as_busy_while_the_in_flight_limit_is_reached() {
        for spec in PLATFORM_API_SPECS {
            let command = open_command(spec);
            let (started_tx, started) = std::sync::mpsc::channel();
            let (release, release_rx) = std::sync::mpsc::channel();
            let ext = Arc::new(PlatformApiExtension::with_limits(
                Arc::new(HeldAdapter {
                    started: Mutex::new(started_tx),
                    release: Mutex::new(release_rx),
                }),
                spec,
                limits(|l| {
                    l.max_in_flight = 1;
                    l.in_flight_wait = Duration::from_millis(20);
                }),
            ));

            let waiting = {
                let ext = ext.clone();
                std::thread::spawn(move || {
                    function(&ext, command).call(spec.namespace, &granted(&[]), Value::Null)
                })
            };
            started
                .recv_timeout(Duration::from_secs(5))
                .expect("the first call is in flight");

            let err = function(&ext, command)
                .call(spec.namespace, &granted(&[]), Value::Null)
                .unwrap_err();
            assert_eq!(err.code.as_deref(), Some(BUSY));
            assert!(
                err.message
                    .contains(&format!("too many {} requests", spec.namespace)),
                "{err}"
            );

            release.send(()).unwrap();
            waiting.join().unwrap().expect("the held call completes");
        }
    }
}
