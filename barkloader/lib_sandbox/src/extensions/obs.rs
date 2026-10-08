//! `ctx.obs`: asks the scene manager, which holds the engine's one OBS
//! WebSocket connection, to change OBS or to list its names, and returns what
//! it answered.
//!
//! A module chooses what to ask for; the engine chooses where the request goes.
//! Each function is a request/reply on a fixed subject, `engine.obs.command`
//! for a change and `engine.obs.options` for a listing, made on the sandbox's
//! blocking thread, so module code learns that OBS applied the change, or why
//! it did not (OBS not running, a scene renamed since the step was saved), and
//! can fail its step with that reason. The scene manager owns every OBS rule
//! and answers a refusal with its own message, which is thrown to the module
//! unchanged.
//!
//! Every call is bounded the same way as `ctx.twitch`: by what is left of the
//! invocation's deadline, by a per-invocation call count, and by a limit on
//! requests in flight at once.

use super::in_flight::InFlight;
use crate::host::{CallScope, HostError, HostExtension, HostFunction, NatsRequester, RequestError};
use crate::permissions::OBS_CONTROL;
use serde_json::{Map, Value, json};
use std::sync::Arc;
use std::time::Duration;
use woofx3_cloudevents::BaseEvent;

/// Must match `EventType.ObsCommand` and `ObsControlCommand` in
/// shared/common/typescript/cloudevents/Obs/commands.ts, which the scene
/// manager answers.
const COMMAND_SUBJECT: &str = "engine.obs.command";

/// Must match `EventType.ObsOptions` in shared/common/typescript/cloudevents/Obs/commands.ts.
const OPTIONS_SUBJECT: &str = "engine.obs.options";

const NAMESPACE: &str = "obs";

/// The CloudEvent `source` of every request, naming the service that sent it.
const EVENT_SOURCE: &str = "barkloader";

/// The longest one call waits for the scene manager. It gives up on OBS
/// itself after 3.5 seconds and answers with the reason, so this only bounds a
/// hung scene manager. A call never waits past the invocation's deadline
/// either.
pub const REQUEST_TIMEOUT: Duration = Duration::from_secs(5);

/// How many `ctx.obs` calls one invocation may make. A function that sets up
/// a scene does a handful; more is a loop.
pub const MAX_CALLS_PER_INVOCATION: u32 = 10;

/// How many `ctx.obs` requests may wait on the scene manager at once, across
/// every invocation. Each holds a blocking thread.
pub const MAX_IN_FLIGHT: usize = 32;

/// How long a call waits for an in-flight slot before giving up.
pub const IN_FLIGHT_WAIT: Duration = Duration::from_secs(2);

/// `code`s a module can branch on, besides `PERMISSION_DENIED`. A refusal
/// from the scene manager (OBS not connected, no scene by that name) carries
/// only its message.
pub const TIMEOUT: &str = "timeout";
pub const UNAVAILABLE: &str = "unavailable";
pub const REQUEST_FAILED: &str = "request_failed";
pub const CALL_LIMIT: &str = "call_limit";
pub const BUSY: &str = "busy";
pub const INVALID_ARGUMENTS: &str = "invalid_arguments";

/// What a function asks the scene manager for.
#[derive(Clone, Copy)]
enum Operation {
    /// A change to OBS, carried as the `data` of an `engine.obs.command`.
    Command(fn(&str, &Map<String, Value>) -> Result<Value, HostError>),
    /// A list of OBS names, carried as `{ list }` on `engine.obs.options`.
    List(&'static str),
}

/// The functions module code may call and the permission each needs. Changing
/// OBS changes what viewers see or hear, so it needs `obs.control`; listing
/// names reads nothing a streamer would keep from a module that asks.
const FUNCTIONS: &[(&str, Operation, Option<&str>)] = &[
    (
        "switchScene",
        Operation::Command(switch_scene),
        Some(OBS_CONTROL),
    ),
    (
        "setSourceVisibility",
        Operation::Command(set_source_visibility),
        Some(OBS_CONTROL),
    ),
    (
        "setInputMute",
        Operation::Command(set_input_mute),
        Some(OBS_CONTROL),
    ),
    (
        "showBrowserSource",
        Operation::Command(show_browser_source),
        Some(OBS_CONTROL),
    ),
    ("listScenes", Operation::List("scenes"), None),
    ("listSources", Operation::List("sources"), None),
    ("listInputs", Operation::List("inputs"), None),
];

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

pub struct ObsExtension {
    functions: Vec<HostFunction>,
}

impl ObsExtension {
    pub fn new(nats: Arc<dyn NatsRequester>) -> Self {
        Self::with_limits(nats, Limits::default())
    }

    pub fn with_limits(nats: Arc<dyn NatsRequester>, limits: Limits) -> Self {
        let in_flight = Arc::new(InFlight::new(limits.max_in_flight));
        let functions = FUNCTIONS
            .iter()
            .map(|&(name, operation, permission)| {
                let nats = nats.clone();
                let in_flight = in_flight.clone();
                HostFunction::scoped(name, move |scope: &CallScope, args: Value| {
                    request(
                        nats.as_ref(),
                        &in_flight,
                        &limits,
                        scope,
                        name,
                        operation,
                        args,
                    )
                })
                .requiring(permission)
            })
            .collect();
        Self { functions }
    }
}

impl HostExtension for ObsExtension {
    fn namespace(&self) -> &str {
        NAMESPACE
    }

    fn functions(&self) -> &[HostFunction] {
        &self.functions
    }
}

fn request(
    nats: &dyn NatsRequester,
    in_flight: &InFlight,
    limits: &Limits,
    scope: &CallScope,
    name: &str,
    operation: Operation,
    args: Value,
) -> Result<Value, HostError> {
    let args = match args {
        Value::Null => Map::new(),
        Value::Object(args) => args,
        _ => {
            return Err(HostError::with_code(
                format!("ctx.obs.{name} takes an object of arguments"),
                INVALID_ARGUMENTS,
            ));
        }
    };

    // Arguments are checked before anything is counted or sent, so a bad call
    // fails with the reason instead of reaching OBS.
    let (subject, data) = match operation {
        Operation::Command(build) => (COMMAND_SUBJECT, build(name, &args)?),
        Operation::List(list) => (OPTIONS_SUBJECT, json!({ "list": list })),
    };

    let made = scope.record_call(NAMESPACE);
    if made > limits.max_calls_per_invocation {
        return Err(HostError::with_code(
            format!(
                "ctx.obs.{name}: a function may make at most {} ctx.obs calls per run",
                limits.max_calls_per_invocation
            ),
            CALL_LIMIT,
        ));
    }

    let spent = || {
        HostError::with_code(
            format!("ctx.obs.{name}: the function has run out of time"),
            TIMEOUT,
        )
    };
    if scope.remaining().is_zero() {
        return Err(spent());
    }
    let Some(_slot) = in_flight.acquire(limits.in_flight_wait.min(scope.remaining())) else {
        return Err(HostError::with_code(
            format!("ctx.obs.{name}: too many OBS requests are waiting; try again shortly"),
            BUSY,
        ));
    };
    let timeout = limits.request_timeout.min(scope.remaining());
    if timeout.is_zero() {
        return Err(spent());
    }

    let envelope = serde_json::to_value(BaseEvent::new(subject, EVENT_SOURCE, data))
        .expect("a CloudEvent with a JSON payload serializes");
    let reply = match nats.request(subject, envelope, timeout) {
        Ok(reply) => reply,
        Err(RequestError::TimedOut) => {
            let after = match operation {
                Operation::Command(_) => "; OBS may still have applied it",
                Operation::List(_) => "",
            };
            return Err(HostError::with_code(
                format!(
                    "ctx.obs.{name}: the scene manager did not answer within {:.1}s{after}",
                    timeout.as_secs_f64()
                ),
                TIMEOUT,
            ));
        }
        Err(RequestError::NoResponders) => {
            return Err(HostError::with_code(
                format!("ctx.obs.{name}: no scene manager is running to reach OBS"),
                UNAVAILABLE,
            ));
        }
        Err(RequestError::Failed(reason)) => {
            return Err(HostError::with_code(
                format!("ctx.obs.{name}: {reason}"),
                REQUEST_FAILED,
            ));
        }
    };

    match operation {
        Operation::Command(_) => read_command_reply(name, reply),
        Operation::List(_) => read_list_reply(name, reply),
    }
}

/// The scene manager answers a command with `{ ok: true }` or
/// `{ ok: false, error }`, the `ObsControlReply` in
/// shared/common/typescript/cloudevents/Obs/commands.ts.
fn read_command_reply(name: &str, reply: Value) -> Result<Value, HostError> {
    match reply.get("ok").and_then(Value::as_bool) {
        Some(true) => Ok(json!({ "ok": true })),
        Some(false) => {
            let message = reply
                .get("error")
                .and_then(Value::as_str)
                .filter(|error| !error.is_empty())
                .map(str::to_string)
                .unwrap_or_else(|| format!("ctx.obs.{name}: OBS refused without a reason"));
            Err(HostError::new(message))
        }
        None => Err(HostError::with_code(
            format!("ctx.obs.{name}: the scene manager's reply has no ok flag"),
            REQUEST_FAILED,
        )),
    }
}

/// The scene manager answers a listing with the options array, or `{ error }`
/// when it cannot list (OBS not connected, say).
fn read_list_reply(name: &str, reply: Value) -> Result<Value, HostError> {
    if reply.is_array() {
        return Ok(reply);
    }
    match reply.get("error").and_then(Value::as_str) {
        Some(error) if !error.is_empty() => Err(HostError::new(error)),
        _ => Err(HostError::with_code(
            format!("ctx.obs.{name}: the scene manager's reply is neither a list nor an error"),
            REQUEST_FAILED,
        )),
    }
}

fn switch_scene(name: &str, args: &Map<String, Value>) -> Result<Value, HostError> {
    let scene_name = required_string(name, args, "sceneName")?;
    Ok(json!({ "command": "switch_scene", "sceneName": scene_name }))
}

/// `sceneName` is optional: the scene manager uses the current program scene
/// when it is absent, so an empty one is left off rather than sent.
fn set_source_visibility(name: &str, args: &Map<String, Value>) -> Result<Value, HostError> {
    let source_name = required_string(name, args, "sourceName")?;
    let scene_name = optional_string(name, args, "sceneName")?;
    let visible = optional_bool(name, args, "visible", true)?;
    let mut command = json!({
        "command": "set_source_visibility",
        "sourceName": source_name,
        "visible": visible,
    });
    if let Some(scene_name) = scene_name.filter(|scene| !scene.is_empty()) {
        command["sceneName"] = Value::String(scene_name);
    }
    Ok(command)
}

fn set_input_mute(name: &str, args: &Map<String, Value>) -> Result<Value, HostError> {
    let input_name = required_string(name, args, "inputName")?;
    let muted = optional_bool(name, args, "muted", true)?;
    Ok(json!({ "command": "set_input_mute", "inputName": input_name, "muted": muted }))
}

/// The size a browser source is created at when the call does not say. OBS's
/// own default is 800x600, which leaves a full-screen page cropped; a module
/// showing a page on stream almost always wants the canvas size.
const BROWSER_SOURCE_DEFAULT_WIDTH: u64 = 1920;
const BROWSER_SOURCE_DEFAULT_HEIGHT: u64 = 1080;

/// 8K. Each browser source renders off-screen at its full size, so a larger
/// one costs the streamer's machine without being seen any sharper.
const BROWSER_SOURCE_MAX_WIDTH: u64 = 7680;
const BROWSER_SOURCE_MAX_HEIGHT: u64 = 4320;

/// `url` must be an absolute http(s) URL: a browser source loads whatever it
/// is given, and `file:` would show the streamer's own files on stream.
/// `width` and `height` only size a source the call creates; an existing one
/// keeps the size the streamer gave it.
fn show_browser_source(name: &str, args: &Map<String, Value>) -> Result<Value, HostError> {
    let source_name = required_string(name, args, "sourceName")?;
    let url = required_string(name, args, "url")?;
    let scheme_ok = url::Url::parse(&url)
        .map(|parsed| matches!(parsed.scheme(), "http" | "https") && parsed.has_host())
        .unwrap_or(false);
    if !scheme_ok {
        return Err(invalid(
            name,
            "url",
            "an absolute http:// or https:// URL",
            args.get("url"),
        ));
    }
    let scene_name = optional_string(name, args, "sceneName")?;
    let width = optional_size(
        name,
        args,
        "width",
        BROWSER_SOURCE_DEFAULT_WIDTH,
        BROWSER_SOURCE_MAX_WIDTH,
    )?;
    let height = optional_size(
        name,
        args,
        "height",
        BROWSER_SOURCE_DEFAULT_HEIGHT,
        BROWSER_SOURCE_MAX_HEIGHT,
    )?;
    let mut command = json!({
        "command": "show_browser_source",
        "sourceName": source_name,
        "url": url,
        "width": width,
        "height": height,
    });
    if let Some(scene_name) = scene_name.filter(|scene| !scene.is_empty()) {
        command["sceneName"] = Value::String(scene_name);
    }
    Ok(command)
}

fn invalid(name: &str, key: &str, expected: &str, got: Option<&Value>) -> HostError {
    HostError::with_code(
        format!(
            "ctx.obs.{name}: {key} must be {expected}, got {}",
            describe(got)
        ),
        INVALID_ARGUMENTS,
    )
}

fn describe(value: Option<&Value>) -> String {
    match value {
        None | Some(Value::Null) => "nothing".to_string(),
        Some(Value::String(text)) if text.is_empty() => "an empty string".to_string(),
        Some(Value::String(text)) => format!("{text:?}"),
        Some(Value::Bool(flag)) => flag.to_string(),
        Some(Value::Number(number)) => number.to_string(),
        Some(Value::Array(_)) => "a list".to_string(),
        Some(Value::Object(_)) => "an object".to_string(),
    }
}

fn required_string(name: &str, args: &Map<String, Value>, key: &str) -> Result<String, HostError> {
    match args.get(key) {
        Some(Value::String(text)) if !text.is_empty() => Ok(text.clone()),
        other => Err(invalid(name, key, "a non-empty string", other)),
    }
}

fn optional_string(
    name: &str,
    args: &Map<String, Value>,
    key: &str,
) -> Result<Option<String>, HostError> {
    match args.get(key) {
        None | Some(Value::Null) => Ok(None),
        Some(Value::String(text)) => Ok(Some(text.clone())),
        other => Err(invalid(name, key, "a string", other)),
    }
}

/// A boolean, or the strings "true" and "false": a value filled in from a
/// workflow step's parameters or a form reaches module code as text.
fn optional_bool(
    name: &str,
    args: &Map<String, Value>,
    key: &str,
    fallback: bool,
) -> Result<bool, HostError> {
    match args.get(key) {
        None | Some(Value::Null) => Ok(fallback),
        Some(Value::Bool(flag)) => Ok(*flag),
        Some(Value::String(text)) if text == "true" => Ok(true),
        Some(Value::String(text)) if text == "false" => Ok(false),
        other => Err(invalid(name, key, "true or false", other)),
    }
}

/// A whole number from 1 to `max`. A whole-valued float is accepted, since
/// JavaScript arithmetic can produce one, and so is a string of digits, since
/// a value filled in from a workflow step's parameters reaches module code as
/// text.
fn optional_size(
    name: &str,
    args: &Map<String, Value>,
    key: &str,
    fallback: u64,
    max: u64,
) -> Result<u64, HostError> {
    let value = args.get(key);
    let number = match value {
        None | Some(Value::Null) => return Ok(fallback),
        Some(Value::Number(number)) => number.as_u64().or_else(|| {
            number
                .as_f64()
                .filter(|float| float.fract() == 0.0 && *float >= 1.0 && *float <= max as f64)
                .map(|float| float as u64)
        }),
        Some(Value::String(text)) => text.trim().parse::<u64>().ok(),
        Some(_) => None,
    };
    match number {
        Some(number) if (1..=max).contains(&number) => Ok(number),
        _ => Err(invalid(
            name,
            key,
            &format!("a whole number from 1 to {max}"),
            value,
        )),
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::host::PERMISSION_DENIED;
    use std::sync::Mutex;
    use std::time::Instant;

    /// Answers every request with `reply` and records what was asked.
    struct FakeSceneManager {
        reply: Result<Value, RequestError>,
        requests: Mutex<Vec<(String, Value, Duration)>>,
    }

    impl FakeSceneManager {
        fn answering(reply: Result<Value, RequestError>) -> Arc<Self> {
            Arc::new(Self {
                reply,
                requests: Mutex::new(Vec::new()),
            })
        }

        fn sent(&self) -> Vec<(String, Value, Duration)> {
            self.requests.lock().unwrap().clone()
        }
    }

    impl NatsRequester for FakeSceneManager {
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

    fn function<'a>(ext: &'a ObsExtension, name: &str) -> &'a HostFunction {
        ext.functions().iter().find(|f| f.name == name).unwrap()
    }

    fn granted(ids: &[&str]) -> CallScope {
        CallScope::new(
            ids.iter().map(|id| id.to_string()).collect(),
            Instant::now() + Duration::from_secs(30),
        )
    }

    fn control() -> CallScope {
        granted(&[OBS_CONTROL])
    }

    fn call(
        ext: &ObsExtension,
        name: &str,
        scope: &CallScope,
        args: Value,
    ) -> Result<Value, HostError> {
        function(ext, name).call("obs", scope, args)
    }

    #[test]
    fn exposes_the_module_functions_with_their_permissions() {
        let ext = ObsExtension::new(FakeSceneManager::answering(Ok(Value::Null)));
        let table: Vec<(&str, Option<&str>)> = ext
            .functions()
            .iter()
            .map(|f| (f.name.as_str(), f.permission))
            .collect();
        assert_eq!(
            table,
            vec![
                ("switchScene", Some(OBS_CONTROL)),
                ("setSourceVisibility", Some(OBS_CONTROL)),
                ("setInputMute", Some(OBS_CONTROL)),
                ("showBrowserSource", Some(OBS_CONTROL)),
                ("listScenes", None),
                ("listSources", None),
                ("listInputs", None),
            ]
        );
    }

    #[test]
    fn switch_scene_sends_the_command_as_a_cloudevent_and_returns_ok() {
        let nats = FakeSceneManager::answering(Ok(json!({ "ok": true })));
        let ext = ObsExtension::new(nats.clone());

        let result = call(
            &ext,
            "switchScene",
            &control(),
            json!({ "sceneName": "BRB" }),
        )
        .unwrap();

        assert_eq!(result, json!({ "ok": true }));
        let sent = nats.sent();
        assert_eq!(sent.len(), 1);
        let (subject, envelope, timeout) = &sent[0];
        assert_eq!(subject, "engine.obs.command");
        assert_eq!(*timeout, REQUEST_TIMEOUT);
        assert_eq!(envelope["type"], "engine.obs.command");
        assert_eq!(envelope["source"], "barkloader");
        assert_eq!(
            envelope["data"],
            json!({ "command": "switch_scene", "sceneName": "BRB" })
        );
    }

    #[test]
    fn set_source_visibility_defaults_visible_and_leaves_off_an_absent_scene() {
        let nats = FakeSceneManager::answering(Ok(json!({ "ok": true })));
        let ext = ObsExtension::new(nats.clone());

        call(
            &ext,
            "setSourceVisibility",
            &control(),
            json!({ "sourceName": "Cam" }),
        )
        .unwrap();
        call(
            &ext,
            "setSourceVisibility",
            &control(),
            json!({ "sourceName": "Cam", "sceneName": "", "visible": "false" }),
        )
        .unwrap();
        call(
            &ext,
            "setSourceVisibility",
            &control(),
            json!({ "sourceName": "Cam", "sceneName": "Game", "visible": false }),
        )
        .unwrap();

        let data: Vec<Value> = nats
            .sent()
            .into_iter()
            .map(|(_, e, _)| e["data"].clone())
            .collect();
        assert_eq!(
            data,
            vec![
                json!({ "command": "set_source_visibility", "sourceName": "Cam", "visible": true }),
                json!({ "command": "set_source_visibility", "sourceName": "Cam", "visible": false }),
                json!({
                    "command": "set_source_visibility",
                    "sourceName": "Cam",
                    "sceneName": "Game",
                    "visible": false
                }),
            ]
        );
    }

    #[test]
    fn set_input_mute_defaults_muted_to_true() {
        let nats = FakeSceneManager::answering(Ok(json!({ "ok": true })));
        let ext = ObsExtension::new(nats.clone());

        call(
            &ext,
            "setInputMute",
            &control(),
            json!({ "inputName": "Mic" }),
        )
        .unwrap();

        assert_eq!(
            nats.sent()[0].1["data"],
            json!({ "command": "set_input_mute", "inputName": "Mic", "muted": true })
        );
    }

    #[test]
    fn show_browser_source_defaults_the_size_and_leaves_off_an_absent_scene() {
        let nats = FakeSceneManager::answering(Ok(json!({ "ok": true })));
        let ext = ObsExtension::new(nats.clone());

        let result = call(
            &ext,
            "showBrowserSource",
            &control(),
            json!({ "sourceName": "Winner", "url": "https://player.twitch.tv/?channel=wolfy" }),
        )
        .unwrap();
        call(
            &ext,
            "showBrowserSource",
            &control(),
            json!({
                "sourceName": "Winner",
                "url": "http://localhost:8080/page",
                "sceneName": "Game",
                "width": 1280.0,
                "height": "720"
            }),
        )
        .unwrap();
        call(
            &ext,
            "showBrowserSource",
            &control(),
            json!({ "sourceName": "Winner", "url": "https://example.com", "sceneName": "" }),
        )
        .unwrap();

        assert_eq!(result, json!({ "ok": true }));
        let data: Vec<Value> = nats
            .sent()
            .into_iter()
            .map(|(_, e, _)| e["data"].clone())
            .collect();
        assert_eq!(
            data,
            vec![
                json!({
                    "command": "show_browser_source",
                    "sourceName": "Winner",
                    "url": "https://player.twitch.tv/?channel=wolfy",
                    "width": 1920,
                    "height": 1080
                }),
                json!({
                    "command": "show_browser_source",
                    "sourceName": "Winner",
                    "url": "http://localhost:8080/page",
                    "sceneName": "Game",
                    "width": 1280,
                    "height": 720
                }),
                json!({
                    "command": "show_browser_source",
                    "sourceName": "Winner",
                    "url": "https://example.com",
                    "width": 1920,
                    "height": 1080
                }),
            ]
        );
    }

    #[test]
    fn show_browser_source_refuses_a_url_that_is_not_http_or_https() {
        let nats = FakeSceneManager::answering(Ok(json!({ "ok": true })));
        let ext = ObsExtension::new(nats.clone());

        for url in [
            json!("file:///etc/passwd"),
            json!("javascript:alert(1)"),
            json!("data:text/html,hi"),
            json!("ftp://example.com"),
            json!("example.com/page"),
            json!("/relative/page"),
            json!("https://"),
            json!(""),
            json!(42),
        ] {
            let err = call(
                &ext,
                "showBrowserSource",
                &control(),
                json!({ "sourceName": "Winner", "url": url }),
            )
            .unwrap_err();
            assert_eq!(err.code.as_deref(), Some(INVALID_ARGUMENTS), "{url}: {err}");
            assert!(err.message.contains("url must be"), "{url}: {err}");
        }
        assert!(nats.sent().is_empty());
    }

    #[test]
    fn show_browser_source_refuses_a_size_that_is_not_a_sensible_whole_number() {
        let nats = FakeSceneManager::answering(Ok(json!({ "ok": true })));
        let ext = ObsExtension::new(nats.clone());

        for (key, value) in [
            ("width", json!(0)),
            ("width", json!(-5)),
            ("width", json!(1920.5)),
            ("width", json!(7681)),
            ("height", json!(4321)),
            ("height", json!("tall")),
            ("height", json!(true)),
        ] {
            let mut args = json!({ "sourceName": "Winner", "url": "https://example.com" });
            args[key] = value.clone();
            let err = call(&ext, "showBrowserSource", &control(), args).unwrap_err();
            assert_eq!(
                err.code.as_deref(),
                Some(INVALID_ARGUMENTS),
                "{key}={value}"
            );
            assert!(
                err.message
                    .contains(&format!("{key} must be a whole number")),
                "{key}={value}: {err}"
            );
        }
        assert!(nats.sent().is_empty());
    }

    #[test]
    fn bad_arguments_are_refused_with_the_reason_before_sending() {
        let nats = FakeSceneManager::answering(Ok(json!({ "ok": true })));
        let ext = ObsExtension::new(nats.clone());

        for (name, args, reason) in [
            (
                "switchScene",
                json!({}),
                "sceneName must be a non-empty string, got nothing",
            ),
            (
                "switchScene",
                json!({ "sceneName": "" }),
                "got an empty string",
            ),
            ("switchScene", json!("BRB"), "takes an object of arguments"),
            (
                "setSourceVisibility",
                json!({ "sourceName": "Cam", "visible": "yes" }),
                "visible must be true or false",
            ),
            (
                "setSourceVisibility",
                json!({ "sourceName": "Cam", "sceneName": 3 }),
                "sceneName must be a string",
            ),
            (
                "setInputMute",
                json!({ "inputName": 7 }),
                "inputName must be a non-empty string, got 7",
            ),
            (
                "showBrowserSource",
                json!({ "url": "https://example.com" }),
                "sourceName must be a non-empty string, got nothing",
            ),
            (
                "showBrowserSource",
                json!({ "sourceName": "Winner" }),
                "url must be a non-empty string, got nothing",
            ),
        ] {
            let err = call(&ext, name, &control(), args).unwrap_err();
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
    fn changes_are_refused_without_obs_control_before_sending() {
        let nats = FakeSceneManager::answering(Ok(json!({ "ok": true })));
        let ext = ObsExtension::new(nats.clone());

        for name in [
            "switchScene",
            "setSourceVisibility",
            "setInputMute",
            "showBrowserSource",
        ] {
            let err = call(&ext, name, &granted(&[]), json!({})).unwrap_err();
            assert_eq!(err.code.as_deref(), Some(PERMISSION_DENIED), "{name}");
            assert!(err.message.contains(OBS_CONTROL), "{err}");
        }
        assert!(nats.sent().is_empty());
    }

    #[test]
    fn a_refusal_from_the_scene_manager_is_thrown_unchanged() {
        let nats = FakeSceneManager::answering(Ok(json!({
            "ok": false,
            "error": "OBS has no scene named \"BRB\""
        })));
        let ext = ObsExtension::new(nats);

        let err = call(
            &ext,
            "switchScene",
            &control(),
            json!({ "sceneName": "BRB" }),
        )
        .unwrap_err();

        assert_eq!(err.message, "OBS has no scene named \"BRB\"");
        assert_eq!(err.code, None);
    }

    #[test]
    fn a_command_reply_without_an_ok_flag_is_a_failed_request() {
        let ext = ObsExtension::new(FakeSceneManager::answering(Ok(json!({ "weird": 1 }))));
        let err = call(
            &ext,
            "switchScene",
            &control(),
            json!({ "sceneName": "BRB" }),
        )
        .unwrap_err();
        assert_eq!(err.code.as_deref(), Some(REQUEST_FAILED));
    }

    #[test]
    fn listing_needs_no_permission_and_returns_the_options() {
        let options =
            json!([{ "value": "BRB", "label": "BRB" }, { "value": "Game", "label": "Game" }]);
        let nats = FakeSceneManager::answering(Ok(options.clone()));
        let ext = ObsExtension::new(nats.clone());

        for (name, list) in [
            ("listScenes", "scenes"),
            ("listSources", "sources"),
            ("listInputs", "inputs"),
        ] {
            let result = call(&ext, name, &granted(&[]), Value::Null).unwrap();
            assert_eq!(result, options, "{name}");
            let (subject, envelope, _) = nats.sent().pop().unwrap();
            assert_eq!(subject, "engine.obs.options");
            assert_eq!(envelope["data"], json!({ "list": list }));
        }
    }

    #[test]
    fn a_listing_the_scene_manager_cannot_give_throws_its_reason() {
        let ext = ObsExtension::new(FakeSceneManager::answering(Ok(json!({
            "error": "OBS is not connected (retrying)"
        }))));
        let err = call(&ext, "listScenes", &granted(&[]), Value::Null).unwrap_err();
        assert_eq!(err.message, "OBS is not connected (retrying)");
        assert_eq!(err.code, None);
    }

    #[test]
    fn transport_failures_carry_codes_a_module_can_branch_on() {
        for (reply, code, words) in [
            (
                Err(RequestError::TimedOut),
                TIMEOUT,
                "may still have applied it",
            ),
            (
                Err(RequestError::NoResponders),
                UNAVAILABLE,
                "no scene manager is running",
            ),
            (
                Err(RequestError::Failed("broken pipe".into())),
                REQUEST_FAILED,
                "broken pipe",
            ),
        ] {
            let ext = ObsExtension::new(FakeSceneManager::answering(reply));
            let err = call(
                &ext,
                "switchScene",
                &control(),
                json!({ "sceneName": "BRB" }),
            )
            .unwrap_err();
            assert_eq!(err.code.as_deref(), Some(code));
            assert!(err.message.contains(words), "{err}");
        }
    }

    #[test]
    fn a_listing_that_times_out_does_not_claim_obs_acted() {
        let ext = ObsExtension::new(FakeSceneManager::answering(Err(RequestError::TimedOut)));
        let err = call(&ext, "listInputs", &granted(&[]), Value::Null).unwrap_err();
        assert_eq!(err.code.as_deref(), Some(TIMEOUT));
        assert!(!err.message.contains("applied"), "{err}");
    }

    #[test]
    fn a_run_may_make_only_so_many_calls() {
        let ext = ObsExtension::with_limits(
            FakeSceneManager::answering(Ok(json!([]))),
            Limits {
                max_calls_per_invocation: 2,
                ..Limits::default()
            },
        );
        let scope = granted(&[]);
        call(&ext, "listScenes", &scope, Value::Null).unwrap();
        call(&ext, "listScenes", &scope, Value::Null).unwrap();
        let err = call(&ext, "listScenes", &scope, Value::Null).unwrap_err();
        assert_eq!(err.code.as_deref(), Some(CALL_LIMIT));
        call(&ext, "listScenes", &granted(&[]), Value::Null).expect("the limit is per invocation");
    }

    #[test]
    fn a_call_never_waits_past_the_invocation_deadline() {
        let nats = FakeSceneManager::answering(Ok(json!({ "ok": true })));
        let ext = ObsExtension::new(nats.clone());
        let scope = CallScope::new(
            [OBS_CONTROL.to_string()].into_iter().collect(),
            Instant::now() + Duration::from_millis(500),
        );

        call(&ext, "switchScene", &scope, json!({ "sceneName": "BRB" })).unwrap();

        assert!(nats.sent()[0].2 <= Duration::from_millis(500));
    }

    #[test]
    fn a_spent_invocation_is_refused_without_sending() {
        let nats = FakeSceneManager::answering(Ok(json!({ "ok": true })));
        let ext = ObsExtension::new(nats.clone());
        let scope = CallScope::new(
            [OBS_CONTROL.to_string()].into_iter().collect(),
            Instant::now(),
        );

        let err = call(&ext, "switchScene", &scope, json!({ "sceneName": "BRB" })).unwrap_err();

        assert_eq!(err.code.as_deref(), Some(TIMEOUT));
        assert!(nats.sent().is_empty());
    }
}
