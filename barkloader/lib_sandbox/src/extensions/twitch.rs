//! `ctx.twitch`: asks the twitch service to act on the linked channel and
//! returns what it answered.
//!
//! Each call is a request/reply on the `twitchapi` subject, made on the
//! sandbox's blocking thread, so module code gets the result (a clip's url, a
//! marker's position) or an error it can handle, instead of firing and
//! hoping. The twitch service owns every Twitch rule and answers a refusal
//! with its own message, which is thrown to the module unchanged.
//!
//! A waiting call holds one of the runtime's blocking threads, so every call
//! is bounded three ways: by what is left of the invocation's deadline, by a
//! per-invocation call count, and by a limit on requests in flight at once.

use super::in_flight::InFlight;
use crate::host::{CallScope, HostError, HostExtension, HostFunction, NatsRequester, RequestError};
use crate::permissions::{TWITCH_CHANNEL, TWITCH_MODERATION};
use serde_json::{Value, json};
use std::sync::Arc;
use std::time::Duration;

const SUBJECT: &str = "twitchapi";
const NAMESPACE: &str = "twitch";

/// The reply type the twitch service answers a refused request with; must
/// match `respondError` in twitch/src/application.ts.
const ERROR_REPLY_TYPE: &str = "twitchapi.error";

/// The longest one call waits for the twitch service. Twitch itself answers
/// in well under a second; this bounds a hung service. A call never waits
/// past the invocation's deadline either.
pub const REQUEST_TIMEOUT: Duration = Duration::from_secs(10);

/// How many `ctx.twitch` calls one invocation may make. A function that acts
/// on the channel does a handful; more is a loop.
pub const MAX_CALLS_PER_INVOCATION: u32 = 10;

/// How many `ctx.twitch` requests may wait on the twitch service at once,
/// across every invocation. Each holds a blocking thread, so this keeps a
/// slow twitch service from starving everything else the sandbox runs.
pub const MAX_IN_FLIGHT: usize = 32;

/// How long a call waits for an in-flight slot before giving up.
pub const IN_FLIGHT_WAIT: Duration = Duration::from_secs(2);

/// `code`s a module can branch on, besides `PERMISSION_DENIED` and whatever
/// `code` the twitch service puts on a refusal.
pub const TIMEOUT: &str = "timeout";
pub const UNAVAILABLE: &str = "unavailable";
pub const REQUEST_FAILED: &str = "request_failed";
pub const CALL_LIMIT: &str = "call_limit";
pub const BUSY: &str = "busy";

/// The commands module code may call, each the twitch service's own command
/// name, and the manifest permission it needs. Clips, shoutouts and markers
/// are visible and harmless, so any module may use them. Timing a chatter
/// out and changing the channel's title, category or tags need a permission
/// the module declares and the engine enforces; the module install page shows
/// them (woofx3-ui feat/module-permissions-review). Moderator changes are not
/// reachable from modules at all.
const COMMANDS: &[(&str, Option<&str>)] = &[
    ("clip", None),
    ("shoutout", None),
    ("createMarker", None),
    ("timeout", Some(TWITCH_MODERATION)),
    ("updateStream", Some(TWITCH_CHANNEL)),
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

pub struct TwitchExtension {
    functions: Vec<HostFunction>,
}

impl TwitchExtension {
    pub fn new(nats: Arc<dyn NatsRequester>) -> Self {
        Self::with_limits(nats, Limits::default())
    }

    pub fn with_limits(nats: Arc<dyn NatsRequester>, limits: Limits) -> Self {
        let in_flight = Arc::new(InFlight::new(limits.max_in_flight));
        let functions = COMMANDS
            .iter()
            .map(|&(command, permission)| {
                let nats = nats.clone();
                let in_flight = in_flight.clone();
                HostFunction::scoped(command, move |scope: &CallScope, args: Value| {
                    request(nats.as_ref(), &in_flight, &limits, scope, command, args)
                })
                .requiring(permission)
            })
            .collect();
        Self { functions }
    }
}

impl HostExtension for TwitchExtension {
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
    command: &str,
    args: Value,
) -> Result<Value, HostError> {
    let args = match args {
        Value::Null => json!({}),
        Value::Object(_) => args,
        _ => {
            return Err(HostError::new(format!(
                "ctx.twitch.{command} takes an object of arguments"
            )));
        }
    };

    let made = scope.record_call(NAMESPACE);
    if made > limits.max_calls_per_invocation {
        return Err(HostError::with_code(
            format!(
                "ctx.twitch.{command}: a function may make at most {} ctx.twitch calls per run",
                limits.max_calls_per_invocation
            ),
            CALL_LIMIT,
        ));
    }

    let spent = || {
        HostError::with_code(
            format!("ctx.twitch.{command}: the function has run out of time"),
            TIMEOUT,
        )
    };
    if scope.remaining().is_zero() {
        return Err(spent());
    }
    let Some(_slot) = in_flight.acquire(limits.in_flight_wait.min(scope.remaining())) else {
        return Err(HostError::with_code(
            format!(
                "ctx.twitch.{command}: too many twitch requests are waiting; try again shortly"
            ),
            BUSY,
        ));
    };
    let timeout = limits.request_timeout.min(scope.remaining());
    if timeout.is_zero() {
        return Err(spent());
    }

    let payload = json!({ "command": command, "args": args });
    match nats.request(SUBJECT, payload, timeout) {
        Ok(reply) => read_reply(command, reply),
        Err(RequestError::TimedOut) => Err(HostError::with_code(
            format!(
                "ctx.twitch.{command}: the twitch service did not answer within {:.1}s; it may still have acted",
                timeout.as_secs_f64()
            ),
            TIMEOUT,
        )),
        Err(RequestError::NoResponders) => Err(HostError::with_code(
            format!("ctx.twitch.{command}: the twitch service is not running"),
            UNAVAILABLE,
        )),
        Err(RequestError::Failed(reason)) => Err(HostError::with_code(
            format!("ctx.twitch.{command}: {reason}"),
            REQUEST_FAILED,
        )),
    }
}

/// The twitch service replies with a CloudEvent: `data` is the result, or
/// `{ error, code? }` when `type` is `twitchapi.error`.
fn read_reply(command: &str, reply: Value) -> Result<Value, HostError> {
    let data = reply.get("data").cloned().unwrap_or(Value::Null);
    if reply.get("type").and_then(Value::as_str) != Some(ERROR_REPLY_TYPE) {
        return Ok(data);
    }
    let message = data
        .get("error")
        .and_then(Value::as_str)
        .map(str::to_string)
        .unwrap_or_else(|| format!("ctx.twitch.{command} failed"));
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
    struct FakeTwitch {
        reply: Result<Value, RequestError>,
        requests: Mutex<Vec<(String, Value, Duration)>>,
    }

    impl FakeTwitch {
        fn answering(reply: Result<Value, RequestError>) -> Arc<Self> {
            Arc::new(Self {
                reply,
                requests: Mutex::new(Vec::new()),
            })
        }
    }

    impl NatsRequester for FakeTwitch {
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

    fn function<'a>(ext: &'a TwitchExtension, name: &str) -> &'a HostFunction {
        ext.functions().iter().find(|f| f.name == name).unwrap()
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

    #[test]
    fn exposes_the_module_commands_with_their_permissions() {
        let ext = TwitchExtension::new(FakeTwitch::answering(Ok(Value::Null)));
        let table: Vec<(&str, Option<&str>)> = ext
            .functions()
            .iter()
            .map(|f| (f.name.as_str(), f.permission))
            .collect();
        assert_eq!(
            table,
            vec![
                ("clip", None),
                ("shoutout", None),
                ("createMarker", None),
                ("timeout", Some(TWITCH_MODERATION)),
                ("updateStream", Some(TWITCH_CHANNEL)),
            ]
        );
    }

    #[test]
    fn requests_the_command_on_twitchapi_and_returns_the_reply_data() {
        let nats = FakeTwitch::answering(Ok(json!({
            "type": "twitchapi.createMarker.result",
            "source": "twitchapi",
            "data": { "id": "m1", "positionSeconds": 42 }
        })));
        let ext = TwitchExtension::new(nats.clone());

        let result = function(&ext, "createMarker")
            .call("twitch", &granted(&[]), json!({ "description": "clutch" }))
            .unwrap();

        assert_eq!(result, json!({ "id": "m1", "positionSeconds": 42 }));
        let requests = nats.requests.lock().unwrap();
        assert_eq!(
            requests[0],
            (
                "twitchapi".to_string(),
                json!({ "command": "createMarker", "args": { "description": "clutch" } }),
                REQUEST_TIMEOUT
            )
        );
    }

    #[test]
    fn a_call_without_arguments_sends_empty_args() {
        let nats =
            FakeTwitch::answering(Ok(json!({ "type": "twitchapi.clip.result", "data": {} })));
        let ext = TwitchExtension::new(nats.clone());
        function(&ext, "clip")
            .call("twitch", &granted(&[]), Value::Null)
            .unwrap();
        assert_eq!(
            nats.requests.lock().unwrap()[0].1,
            json!({ "command": "clip", "args": {} })
        );
    }

    #[test]
    fn refuses_arguments_that_are_not_an_object_without_sending() {
        let nats = FakeTwitch::answering(Ok(Value::Null));
        let ext = TwitchExtension::new(nats.clone());
        let err = function(&ext, "shoutout")
            .call("twitch", &granted(&[]), json!("someone"))
            .unwrap_err();
        assert!(err.message.contains("takes an object"), "{err}");
        assert!(nats.requests.lock().unwrap().is_empty());
    }

    #[test]
    fn privileged_commands_are_refused_without_their_permission_before_sending() {
        let nats = FakeTwitch::answering(Ok(json!({ "type": "x", "data": {} })));
        let ext = TwitchExtension::new(nats.clone());

        for (name, needed, held) in [
            ("timeout", TWITCH_MODERATION, TWITCH_CHANNEL),
            ("updateStream", TWITCH_CHANNEL, TWITCH_MODERATION),
        ] {
            let err = function(&ext, name)
                .call("twitch", &granted(&[held]), json!({}))
                .unwrap_err();
            assert_eq!(err.code.as_deref(), Some(PERMISSION_DENIED), "{name}");
            assert!(err.message.contains(needed), "{err}");
        }
        assert!(nats.requests.lock().unwrap().is_empty());

        function(&ext, "timeout")
            .call(
                "twitch",
                &granted(&[TWITCH_MODERATION]),
                json!({ "userId": "u1", "durationSeconds": 60 }),
            )
            .unwrap();
        assert_eq!(nats.requests.lock().unwrap().len(), 1);
    }

    #[test]
    fn a_refusal_is_thrown_with_the_twitch_service_message_and_code() {
        let ext = TwitchExtension::new(FakeTwitch::answering(Ok(json!({
            "type": "twitchapi.error",
            "data": { "error": "createMarker: the channel is not live", "code": "not_live" }
        }))));
        let err = function(&ext, "createMarker")
            .call("twitch", &granted(&[]), Value::Null)
            .unwrap_err();
        assert_eq!(
            err,
            HostError::with_code("createMarker: the channel is not live", "not_live")
        );
    }

    #[test]
    fn a_refusal_without_a_code_keeps_the_message() {
        let ext = TwitchExtension::new(FakeTwitch::answering(Ok(json!({
            "type": "twitchapi.error",
            "data": { "error": "Twitch is not linked yet" }
        }))));
        let err = function(&ext, "clip")
            .call("twitch", &granted(&[]), Value::Null)
            .unwrap_err();
        assert_eq!(err, HostError::new("Twitch is not linked yet"));
    }

    #[test]
    fn transport_failures_map_to_codes() {
        for (failure, code, says) in [
            (
                RequestError::TimedOut,
                TIMEOUT,
                "did not answer within 3.0s",
            ),
            (RequestError::NoResponders, UNAVAILABLE, "not running"),
            (
                RequestError::Failed("connection closed".to_string()),
                REQUEST_FAILED,
                "connection closed",
            ),
        ] {
            let ext = TwitchExtension::with_limits(
                FakeTwitch::answering(Err(failure)),
                limits(|l| l.request_timeout = Duration::from_secs(3)),
            );
            let err = function(&ext, "clip")
                .call("twitch", &granted(&[]), Value::Null)
                .unwrap_err();
            assert_eq!(err.code.as_deref(), Some(code));
            assert!(err.message.starts_with("ctx.twitch.clip: "), "{err}");
            assert!(err.message.contains(says), "{err}");
        }
    }

    #[test]
    fn a_call_after_the_invocation_deadline_is_refused_without_sending() {
        let nats = FakeTwitch::answering(Ok(json!({ "type": "x", "data": {} })));
        let ext = TwitchExtension::new(nats.clone());
        let spent = CallScope::new(Default::default(), Instant::now());
        let err = function(&ext, "clip")
            .call("twitch", &spent, Value::Null)
            .unwrap_err();
        assert_eq!(err.code.as_deref(), Some(TIMEOUT));
        assert!(err.message.contains("run out of time"), "{err}");
        assert!(nats.requests.lock().unwrap().is_empty());
    }

    #[test]
    fn a_call_waits_no_longer_than_the_invocation_has_left() {
        let nats = FakeTwitch::answering(Ok(json!({ "type": "x", "data": {} })));
        let ext = TwitchExtension::new(nats.clone());
        let short = CallScope::new(Default::default(), Instant::now() + Duration::from_secs(2));
        function(&ext, "clip")
            .call("twitch", &short, Value::Null)
            .unwrap();
        let waited = nats.requests.lock().unwrap()[0].2;
        assert!(waited <= Duration::from_secs(2), "{waited:?}");
        assert!(waited > Duration::ZERO);
    }

    #[test]
    fn an_invocation_may_make_only_so_many_calls() {
        let nats = FakeTwitch::answering(Ok(json!({ "type": "x", "data": {} })));
        let ext = TwitchExtension::new(nats.clone());
        let scope = granted(&[]);
        for _ in 0..MAX_CALLS_PER_INVOCATION {
            function(&ext, "createMarker")
                .call("twitch", &scope, Value::Null)
                .unwrap();
        }
        let err = function(&ext, "clip")
            .call("twitch", &scope, Value::Null)
            .unwrap_err();
        assert_eq!(err.code.as_deref(), Some(CALL_LIMIT));
        assert!(err.message.contains("at most 10"), "{err}");
        assert_eq!(
            nats.requests.lock().unwrap().len(),
            MAX_CALLS_PER_INVOCATION as usize
        );

        function(&ext, "clip")
            .call("twitch", &granted(&[]), Value::Null)
            .expect("the limit is per invocation");
    }

    /// Holds every request until released, so a test can keep one in flight.
    struct HeldTwitch {
        started: Mutex<std::sync::mpsc::Sender<()>>,
        release: Mutex<std::sync::mpsc::Receiver<()>>,
    }

    impl NatsRequester for HeldTwitch {
        fn request(&self, _: &str, _: Value, _: Duration) -> Result<Value, RequestError> {
            self.started.lock().unwrap().send(()).unwrap();
            self.release.lock().unwrap().recv().unwrap();
            Ok(json!({ "type": "x", "data": {} }))
        }
    }

    #[test]
    fn a_call_is_refused_as_busy_while_the_in_flight_limit_is_reached() {
        let (started_tx, started) = std::sync::mpsc::channel();
        let (release, release_rx) = std::sync::mpsc::channel();
        let ext = Arc::new(TwitchExtension::with_limits(
            Arc::new(HeldTwitch {
                started: Mutex::new(started_tx),
                release: Mutex::new(release_rx),
            }),
            limits(|l| {
                l.max_in_flight = 1;
                l.in_flight_wait = Duration::from_millis(20);
            }),
        ));

        let waiting = {
            let ext = ext.clone();
            std::thread::spawn(move || {
                function(&ext, "clip").call("twitch", &granted(&[]), Value::Null)
            })
        };
        started
            .recv_timeout(Duration::from_secs(5))
            .expect("the first call is in flight");

        let err = function(&ext, "clip")
            .call("twitch", &granted(&[]), Value::Null)
            .unwrap_err();
        assert_eq!(err.code.as_deref(), Some(BUSY));
        assert!(err.message.contains("too many twitch requests"), "{err}");

        release.send(()).unwrap();
        waiting.join().unwrap().expect("the held call completes");
    }
}
