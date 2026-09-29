//! The single scheduler for everything barkloader runs on its own clock:
//! cron background tasks, their `runOnLoad` firings, and the deadlines module
//! functions arm with `ctx.schedule.at`.
//!
//! One min-heap of `(fire_at, generation, key)` and one map of key to entry.
//! Every arm takes a fresh generation from a single counter, so replacing or
//! cancelling an entry never searches the heap: the old heap item simply no
//! longer matches its entry's generation and is dropped when it surfaces. One
//! loop sleeps until the earliest heap item or until a change wakes it, which
//! is how an entry earlier than the current sleep interrupts it.
//!
//! Entries live in memory only. Deadlines are a cache of state the module
//! already keeps in its durable storage; after a restart its `runOnLoad`
//! task re-arms them and handles whatever came due while the process was
//! down. That is why nothing here is persisted, and why a stale or duplicate
//! firing must be harmless to the module.

use async_trait::async_trait;
use chrono::{DateTime, Utc};
use lib_module::module_manifest::ManifestDeadline;
use lib_module::{ModuleSchedule, ScheduleRegistrar};
use lib_sandbox::SandboxFactory;
use lib_sandbox::host::ScheduleClient;
use lib_sandbox::models::request::InvokeRequest;
use serde_json::{Value, json};
use std::cmp::Reverse;
use std::collections::{BinaryHeap, HashMap, HashSet};
use std::str::FromStr;
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::{Arc, Mutex};
use std::time::Duration;
use tokio::sync::Notify;
use tokio::time::Instant;
use tracing::{debug, error, info, warn};

/// Furthest ahead a deadline may be armed. Entries are memory, not storage;
/// anything further out belongs in the module's own state, picked up by its
/// reconcile task.
pub const DEADLINE_HORIZON_MS: i64 = 30 * 24 * 60 * 60 * 1000;

/// How many times a `runOnLoad` firing is attempted before giving up until
/// the next load. Its usual failure is a dependency that is not ready yet at
/// boot, which the next cron fire would otherwise be the only retry for.
const LOAD_ATTEMPTS: u32 = 8;
const LOAD_RETRY_BASE: Duration = Duration::from_secs(1);
const LOAD_RETRY_MAX: Duration = Duration::from_secs(60);

/// Wall-clock time in Unix epoch milliseconds. Deadlines and cron schedules
/// are wall-clock; sleeping is on tokio's monotonic clock. Abstracted so the
/// tests can tie the two together under paused time.
pub trait Clock: Send + Sync {
    fn now_ms(&self) -> i64;
}

pub struct SystemClock;

impl Clock for SystemClock {
    fn now_ms(&self) -> i64 {
        Utc::now().timestamp_millis()
    }
}

/// Runs one module function to completion. Implemented by `SandboxFactory`;
/// the tests supply their own.
#[async_trait]
pub trait FunctionInvoker: Send + Sync + 'static {
    async fn invoke(&self, request: InvokeRequest) -> Result<(), String>;
}

#[async_trait]
impl FunctionInvoker for SandboxFactory {
    async fn invoke(&self, request: InvokeRequest) -> Result<(), String> {
        self.invoke_blocking(request)
            .await
            .map(|_| ())
            .map_err(|e| e.to_string())
    }
}

/// Identity of an entry. At most one invocation per key runs at a time.
#[derive(Debug, Clone, PartialEq, Eq, Hash, PartialOrd, Ord)]
enum EntryKey {
    /// A cron background task; re-arms from its schedule after each firing.
    Cron { module: String, task: String },
    /// The load-time firing of a `runOnLoad` task; retried with backoff.
    Load { module: String, task: String },
    /// A deadline a module function armed; one-shot.
    Deadline {
        module: String,
        deadline: String,
        key: String,
    },
}

impl EntryKey {
    fn module(&self) -> &str {
        match self {
            Self::Cron { module, .. }
            | Self::Load { module, .. }
            | Self::Deadline { module, .. } => module,
        }
    }
}

enum EntryKind {
    Cron { schedule: Box<cron::Schedule> },
    Load { attempt: u32 },
    Deadline { due_at_ms: i64, params: Value },
}

struct Entry {
    generation: u64,
    function_id: String,
    kind: EntryKind,
    /// When this entry sits in the heap. `None` while its invocation runs.
    armed_at: Option<Instant>,
    /// Came due while an invocation for the same key was still running; it
    /// fires as soon as that one completes.
    deferred: bool,
}

struct ModuleDeclarations {
    schedule: ModuleSchedule,
    enabled: bool,
}

#[derive(Default)]
struct State {
    next_generation: u64,
    heap: BinaryHeap<Reverse<(Instant, u64, EntryKey)>>,
    entries: HashMap<EntryKey, Entry>,
    /// Keys with an invocation running now.
    in_flight: HashSet<EntryKey>,
    modules: HashMap<String, ModuleDeclarations>,
    /// Deadline entries per `(module, deadline)`, for `maxPending`.
    pending: HashMap<(String, String), usize>,
}

/// One entry taken off the heap to be invoked.
struct Firing {
    key: EntryKey,
    generation: u64,
    request: InvokeRequest,
}

struct Inner {
    state: Mutex<State>,
    notify: Notify,
    clock: Arc<dyn Clock>,
    started: AtomicBool,
}

/// Cheap to clone; every clone is the same scheduler.
#[derive(Clone)]
pub struct ModuleScheduler {
    inner: Arc<Inner>,
}

impl ModuleScheduler {
    pub fn new(clock: Arc<dyn Clock>) -> Self {
        Self {
            inner: Arc::new(Inner {
                state: Mutex::new(State::default()),
                notify: Notify::new(),
                clock,
                started: AtomicBool::new(false),
            }),
        }
    }

    /// Start the loop that fires entries. Separate from `new` because the
    /// sandbox that runs the functions is built from a host context that
    /// already holds this scheduler as its `ScheduleClient`. Entries armed
    /// before this call wait for it.
    pub fn start(&self, invoker: Arc<dyn FunctionInvoker>) -> tokio::task::JoinHandle<()> {
        let already_started = self.inner.started.swap(true, Ordering::SeqCst);
        assert!(!already_started, "module scheduler started twice");
        tokio::spawn(run(self.inner.clone(), invoker))
    }

    /// Replace everything the module has scheduled with what `schedule`
    /// declares, and fire its `runOnLoad` tasks.
    pub fn register(&self, module: &str, schedule: &ModuleSchedule) {
        {
            let mut state = self.inner.lock();
            let dropped = state.drop_module_entries(module);
            state.modules.insert(
                module.to_string(),
                ModuleDeclarations {
                    schedule: schedule.clone(),
                    enabled: true,
                },
            );
            let armed = state.arm_module(module, self.inner.clock.as_ref());
            info!(
                "Scheduler registered module {}: {} entr(ies) armed, {} dropped, {} deadline declaration(s)",
                module,
                armed,
                dropped,
                schedule.deadlines.len()
            );
        }
        self.inner.notify.notify_one();
    }

    /// Drop everything the module has scheduled and forget its declarations.
    pub fn unregister(&self, module: &str) {
        let mut state = self.inner.lock();
        let dropped = state.drop_module_entries(module);
        if state.modules.remove(module).is_some() {
            info!(
                "Scheduler unregistered module {} ({} entr(ies) dropped)",
                module, dropped
            );
        }
    }

    /// Disabling drops the module's entries and refuses new deadlines but
    /// keeps its declarations, so enabling can arm them again and fire its
    /// `runOnLoad` tasks without a trip to the database.
    pub fn set_enabled(&self, module: &str, enabled: bool) {
        {
            let mut state = self.inner.lock();
            let Some(declarations) = state.modules.get_mut(module) else {
                return;
            };
            if declarations.enabled == enabled {
                return;
            }
            declarations.enabled = enabled;
            if enabled {
                let armed = state.arm_module(module, self.inner.clock.as_ref());
                info!(
                    "Scheduler enabled module {} ({} entr(ies) armed)",
                    module, armed
                );
            } else {
                let dropped = state.drop_module_entries(module);
                info!(
                    "Scheduler disabled module {} ({} entr(ies) dropped)",
                    module, dropped
                );
            }
        }
        self.inner.notify.notify_one();
    }
}

impl Inner {
    fn lock(&self) -> std::sync::MutexGuard<'_, State> {
        self.state.lock().expect("scheduler state lock poisoned")
    }

    /// Instant on tokio's clock that corresponds to wall-clock `when_ms`.
    /// Converted once, when armed: a later wall-clock step does not move an
    /// entry that is already waiting.
    fn instant_for(&self, when_ms: i64) -> Instant {
        instant_for(self.clock.as_ref(), when_ms)
    }

    /// Take every entry due at `now` off the heap, and report when the next
    /// one is due.
    fn take_due(&self, now: Instant) -> (Vec<Firing>, Option<Instant>) {
        let mut state = self.lock();
        let mut due = Vec::new();
        while let Some(Reverse((fire_at, generation, _))) = state.heap.peek() {
            if *fire_at > now {
                break;
            }
            let generation = *generation;
            let Some(Reverse((_, _, key))) = state.heap.pop() else {
                break;
            };
            if let Some(firing) = state.fire(key, generation, self.clock.now_ms()) {
                due.push(firing);
            }
        }
        state.compact_heap();
        let next = state.heap.peek().map(|Reverse((at, _, _))| *at);
        (due, next)
    }

    /// Record the end of an invocation: re-arm a cron task, retry or finish a
    /// load firing, and release anything that came due behind it.
    fn complete(&self, key: &EntryKey, generation: u64, succeeded: bool) {
        let now_ms = self.clock.now_ms();
        let mut state = self.lock();
        let removed = state.in_flight.remove(key);
        assert!(
            removed,
            "completed an invocation that was not in flight: {key:?}"
        );

        let Some(entry) = state.entries.get_mut(key) else {
            return;
        };
        if entry.generation != generation {
            // A newer entry under the same key: a deadline armed again while
            // it ran, or a module registered again. Its own arm stands; it
            // only waited if it came due in the meantime.
            if entry.deferred {
                entry.deferred = false;
                let generation = entry.generation;
                state.push(key.clone(), generation, Instant::now());
            }
            return;
        }

        match &mut entry.kind {
            EntryKind::Cron { schedule } => match next_cron_ms(schedule, now_ms) {
                Some(next_ms) => {
                    let at = instant_for(self.clock.as_ref(), next_ms);
                    state.push(key.clone(), generation, at);
                }
                None => {
                    warn!(
                        "Background task {:?} has no upcoming fire time; stopping",
                        key
                    );
                    state.remove_entry(key);
                }
            },
            EntryKind::Load { attempt } => {
                if succeeded {
                    state.remove_entry(key);
                    return;
                }
                if *attempt >= LOAD_ATTEMPTS {
                    error!(
                        "Background task {:?} failed on load {} time(s); giving up until the next load",
                        key, attempt
                    );
                    state.remove_entry(key);
                    return;
                }
                let delay = load_retry_delay(*attempt);
                *attempt += 1;
                debug!("Background task {:?} load retry in {:?}", key, delay);
                state.push(key.clone(), generation, Instant::now() + delay);
            }
            EntryKind::Deadline { .. } => {
                unreachable!("a deadline entry is removed when it fires");
            }
        }
    }
}

impl State {
    fn take_generation(&mut self) -> u64 {
        self.next_generation += 1;
        self.next_generation
    }

    fn push(&mut self, key: EntryKey, generation: u64, at: Instant) {
        let entry = self
            .entries
            .get_mut(&key)
            .expect("only an existing entry is armed");
        assert_eq!(
            entry.generation, generation,
            "arming a superseded generation"
        );
        entry.armed_at = Some(at);
        self.heap.push(Reverse((at, generation, key)));
    }

    /// Insert or replace the entry under `key` and arm it at `at`.
    fn insert(&mut self, key: EntryKey, function_id: String, kind: EntryKind, at: Instant) {
        let generation = self.take_generation();
        let is_new_deadline =
            matches!(key, EntryKey::Deadline { .. }) && !self.entries.contains_key(&key);
        if is_new_deadline {
            *self.pending.entry(pending_slot(&key)).or_default() += 1;
        }
        self.entries.insert(
            key.clone(),
            Entry {
                generation,
                function_id,
                kind,
                armed_at: None,
                deferred: false,
            },
        );
        self.push(key, generation, at);
    }

    fn remove_entry(&mut self, key: &EntryKey) -> Option<Entry> {
        let entry = self.entries.remove(key)?;
        if matches!(key, EntryKey::Deadline { .. }) {
            let slot = pending_slot(key);
            let count = self
                .pending
                .get_mut(&slot)
                .expect("every deadline entry is counted");
            *count -= 1;
            if *count == 0 {
                self.pending.remove(&slot);
            }
        }
        Some(entry)
    }

    fn remove_where(&mut self, doomed: impl Fn(&EntryKey) -> bool) -> usize {
        let keys: Vec<EntryKey> = self.entries.keys().filter(|k| doomed(k)).cloned().collect();
        for key in &keys {
            self.remove_entry(key);
        }
        keys.len()
    }

    fn drop_module_entries(&mut self, module: &str) -> usize {
        self.remove_where(|key| key.module() == module)
    }

    /// Arm the module's cron tasks and fire its `runOnLoad` tasks now.
    /// Returns how many entries were armed.
    fn arm_module(&mut self, module: &str, clock: &dyn Clock) -> usize {
        let tasks = match self.modules.get(module) {
            Some(declarations) => declarations.schedule.background_tasks.clone(),
            None => return 0,
        };
        let now_ms = clock.now_ms();
        let mut armed = 0;
        for task in &tasks {
            let function_id = format!("{}:function:{}", module, task.function);
            let normalized = lib_module::cron_schedule::normalize_cron(&task.schedule);
            match cron::Schedule::from_str(&normalized) {
                Ok(schedule) => match next_cron_ms(&schedule, now_ms) {
                    Some(next_ms) => {
                        let key = EntryKey::Cron {
                            module: module.to_string(),
                            task: task.id.clone(),
                        };
                        let kind = EntryKind::Cron {
                            schedule: Box::new(schedule),
                        };
                        self.insert(key, function_id.clone(), kind, instant_for(clock, next_ms));
                        armed += 1;
                    }
                    None => {
                        warn!(
                            "Background task {}/{}: no upcoming fire time",
                            module, task.id
                        );
                    }
                },
                Err(e) => {
                    warn!(
                        "Background task {}/{}: invalid cron expression '{}': {}",
                        module, task.id, task.schedule, e
                    );
                }
            }
            if task.run_on_load {
                let key = EntryKey::Load {
                    module: module.to_string(),
                    task: task.id.clone(),
                };
                self.insert(
                    key,
                    function_id,
                    EntryKind::Load { attempt: 1 },
                    Instant::now(),
                );
                armed += 1;
            }
        }
        armed
    }

    /// Start the invocation for a popped heap item, or `None` when the item
    /// is stale or has to wait for an invocation of the same key.
    fn fire(&mut self, key: EntryKey, generation: u64, now_ms: i64) -> Option<Firing> {
        let entry = self.entries.get_mut(&key)?;
        if entry.generation != generation || entry.armed_at.is_none() {
            return None;
        }
        entry.armed_at = None;
        if self.in_flight.contains(&key) {
            entry.deferred = true;
            return None;
        }

        let event = match &entry.kind {
            EntryKind::Cron { .. } | EntryKind::Load { .. } => json!({}),
            EntryKind::Deadline { due_at_ms, params } => {
                let EntryKey::Deadline {
                    deadline,
                    key: entry_key,
                    ..
                } = &key
                else {
                    unreachable!("a deadline entry has a deadline key");
                };
                json!({
                    "parameters": params,
                    "deadline": {
                        "id": deadline,
                        "key": entry_key,
                        "dueAt": due_at_ms,
                        "firedAt": now_ms,
                    },
                })
            }
        };
        let request = InvokeRequest {
            function: entry.function_id.clone(),
            event,
            user: None,
            params: json!({}),
            workflow_chain: None,
            timeout_ms: None,
        };
        if matches!(key, EntryKey::Deadline { .. }) {
            self.remove_entry(&key);
        }
        self.in_flight.insert(key.clone());
        Some(Firing {
            key,
            generation,
            request,
        })
    }

    /// Rebuild the heap from the armed entries once superseded items make up
    /// most of it. Replacing an entry leaves its old item behind until it
    /// surfaces, so a module re-arming far-future deadlines would otherwise
    /// grow the heap without bound.
    fn compact_heap(&mut self) {
        let live = self.entries.len();
        if self.heap.len() <= 2 * live + 64 {
            return;
        }
        self.heap = self
            .entries
            .iter()
            .filter_map(|(key, entry)| {
                entry
                    .armed_at
                    .map(|at| Reverse((at, entry.generation, key.clone())))
            })
            .collect();
    }

    fn declared_deadline(
        &self,
        module: &str,
        deadline_id: &str,
    ) -> Result<&ManifestDeadline, String> {
        let declarations = self
            .modules
            .get(module)
            .ok_or_else(|| format!("schedule: module {module} has no schedule registered"))?;
        if !declarations.enabled {
            return Err(format!("schedule: module {module} is disabled"));
        }
        declarations
            .schedule
            .deadlines
            .iter()
            .find(|d| d.id == deadline_id)
            .ok_or_else(|| {
                format!("schedule: deadline {deadline_id:?} is not declared in module {module}'s manifest")
            })
    }
}

impl ScheduleClient for ModuleScheduler {
    fn at(
        &self,
        module_id: &str,
        deadline_id: &str,
        key: &str,
        when_ms: i64,
        params: Value,
    ) -> Result<(), String> {
        let now_ms = self.inner.clock.now_ms();
        if when_ms.saturating_sub(now_ms) > DEADLINE_HORIZON_MS {
            return Err(format!(
                "schedule.at: whenMs is more than 30 days out ({} ms from now)",
                when_ms.saturating_sub(now_ms)
            ));
        }
        {
            let mut state = self.inner.lock();
            let declaration = state.declared_deadline(module_id, deadline_id)?;
            let function_id = format!("{}:function:{}", module_id, declaration.function);
            let max_pending = declaration.max_pending as usize;
            let entry_key = EntryKey::Deadline {
                module: module_id.to_string(),
                deadline: deadline_id.to_string(),
                key: key.to_string(),
            };
            let pending = state
                .pending
                .get(&pending_slot(&entry_key))
                .copied()
                .unwrap_or(0);
            if !state.entries.contains_key(&entry_key) && pending >= max_pending {
                return Err(format!(
                    "schedule.at: deadline {deadline_id:?} already holds its maxPending of {max_pending} entries"
                ));
            }
            let kind = EntryKind::Deadline {
                due_at_ms: when_ms,
                params,
            };
            let at = self.inner.instant_for(when_ms);
            state.insert(entry_key, function_id, kind, at);
        }
        self.inner.notify.notify_one();
        Ok(())
    }

    fn cancel(&self, module_id: &str, deadline_id: &str, key: &str) -> Result<(), String> {
        let mut state = self.inner.lock();
        state.declared_deadline(module_id, deadline_id)?;
        state.remove_entry(&EntryKey::Deadline {
            module: module_id.to_string(),
            deadline: deadline_id.to_string(),
            key: key.to_string(),
        });
        Ok(())
    }

    fn cancel_key(&self, key: &str) {
        let mut state = self.inner.lock();
        state.remove_where(
            |entry_key| matches!(entry_key, EntryKey::Deadline { key: k, .. } if k == key),
        );
    }
}

impl ScheduleRegistrar for ModuleScheduler {
    fn register(&self, module_key: &str, schedule: &ModuleSchedule) {
        ModuleScheduler::register(self, module_key, schedule);
    }

    fn unregister(&self, module_key: &str) {
        ModuleScheduler::unregister(self, module_key);
    }
}

async fn run(inner: Arc<Inner>, invoker: Arc<dyn FunctionInvoker>) {
    info!("Module scheduler started");
    loop {
        let (due, next) = inner.take_due(Instant::now());
        for firing in due {
            tokio::spawn(fire(inner.clone(), invoker.clone(), firing));
        }
        match next {
            Some(at) => {
                tokio::select! {
                    _ = tokio::time::sleep_until(at) => {}
                    _ = inner.notify.notified() => {}
                }
            }
            None => inner.notify.notified().await,
        }
    }
}

async fn fire(inner: Arc<Inner>, invoker: Arc<dyn FunctionInvoker>, firing: Firing) {
    let Firing {
        key,
        generation,
        request,
    } = firing;
    let function = request.function.clone();
    debug!("Scheduler firing {:?} function={}", key, function);
    let started = Instant::now();
    let result = invoker.invoke(request).await;
    let elapsed_ms = started.elapsed().as_millis();
    match &result {
        Ok(()) => {
            debug!(
                "Scheduler {:?} function={} completed in {}ms",
                key, function, elapsed_ms
            );
        }
        Err(e) => {
            error!(
                "Scheduler {:?} function={} failed after {}ms: {}",
                key, function, elapsed_ms, e
            );
        }
    }
    inner.complete(&key, generation, result.is_ok());
    inner.notify.notify_one();
}

fn pending_slot(key: &EntryKey) -> (String, String) {
    match key {
        EntryKey::Deadline {
            module, deadline, ..
        } => (module.clone(), deadline.clone()),
        other => unreachable!("only deadlines count toward maxPending: {other:?}"),
    }
}

fn instant_for(clock: &dyn Clock, when_ms: i64) -> Instant {
    let now = Instant::now();
    let delta_ms = when_ms.saturating_sub(clock.now_ms());
    if delta_ms <= 0 {
        return now;
    }
    now + Duration::from_millis(delta_ms as u64)
}

fn next_cron_ms(schedule: &cron::Schedule, now_ms: i64) -> Option<i64> {
    let now: DateTime<Utc> = DateTime::from_timestamp_millis(now_ms)?;
    schedule.after(&now).next().map(|t| t.timestamp_millis())
}

/// 1s, 2s, 4s, ... capped at a minute, for the attempt that just failed.
fn load_retry_delay(failed_attempt: u32) -> Duration {
    let factor = 1u32 << failed_attempt.saturating_sub(1).min(16);
    (LOAD_RETRY_BASE * factor).min(LOAD_RETRY_MAX)
}

#[cfg(test)]
mod tests {
    use super::*;
    use lib_module::module_manifest::ManifestBackgroundTask;

    /// A whole minute of wall-clock time, so cron schedules line up with
    /// elapsed test time.
    const BASE_MS: i64 = 1_700_000_040_000;

    /// Wall clock that advances with tokio's paused clock.
    struct PausedClock {
        start: Instant,
    }

    impl Clock for PausedClock {
        fn now_ms(&self) -> i64 {
            BASE_MS + self.start.elapsed().as_millis() as i64
        }
    }

    #[derive(Debug, Clone)]
    struct Call {
        function: String,
        event: Value,
        at_ms: u128,
    }

    /// Records each invocation with the elapsed test time it started at.
    /// `failures` makes the first N calls of a function fail; `hold` keeps a
    /// function's invocations running that long.
    struct RecordingInvoker {
        start: Instant,
        calls: Mutex<Vec<Call>>,
        failures: Mutex<HashMap<String, u32>>,
        hold: HashMap<String, Duration>,
    }

    #[async_trait]
    impl FunctionInvoker for RecordingInvoker {
        async fn invoke(&self, request: InvokeRequest) -> Result<(), String> {
            self.calls.lock().unwrap().push(Call {
                function: request.function.clone(),
                event: request.event.clone(),
                at_ms: self.start.elapsed().as_millis(),
            });
            if let Some(hold) = self.hold.get(&request.function) {
                tokio::time::sleep(*hold).await;
            }
            let mut failures = self.failures.lock().unwrap();
            if let Some(remaining) = failures.get_mut(&request.function) {
                if *remaining > 0 {
                    *remaining -= 1;
                    return Err("not ready".to_string());
                }
            }
            Ok(())
        }
    }

    struct Harness {
        scheduler: ModuleScheduler,
        invoker: Arc<RecordingInvoker>,
    }

    impl Harness {
        fn new() -> Self {
            Self::with(HashMap::new(), HashMap::new())
        }

        fn with(failures: HashMap<String, u32>, hold: HashMap<String, Duration>) -> Self {
            let start = Instant::now();
            let scheduler = ModuleScheduler::new(Arc::new(PausedClock { start }));
            let invoker = Arc::new(RecordingInvoker {
                start,
                calls: Mutex::new(Vec::new()),
                failures: Mutex::new(failures),
                hold,
            });
            scheduler.start(invoker.clone());
            Self { scheduler, invoker }
        }

        fn calls(&self) -> Vec<Call> {
            self.invoker.calls.lock().unwrap().clone()
        }

        fn fired(&self, function: &str) -> Vec<u128> {
            self.calls()
                .into_iter()
                .filter(|c| c.function == function)
                .map(|c| c.at_ms)
                .collect()
        }

        fn now_ms(&self) -> i64 {
            self.scheduler.inner.clock.now_ms()
        }

        fn at(&self, key: &str, in_ms: i64, params: Value) -> Result<(), String> {
            self.scheduler
                .at("timer", "timer_end", key, self.now_ms() + in_ms, params)
        }
    }

    const EXPIRE: &str = "timer:function:timer.expire";
    const RECONCILE: &str = "timer:function:timer.reconcile";

    fn deadline(max_pending: u32) -> ManifestDeadline {
        ManifestDeadline {
            id: "timer_end".into(),
            function: "timer.expire".into(),
            max_pending,
            description: String::new(),
        }
    }

    fn task(schedule: &str, run_on_load: bool) -> ManifestBackgroundTask {
        ManifestBackgroundTask {
            id: "timer_reconcile".into(),
            function: "timer.reconcile".into(),
            schedule: schedule.into(),
            description: String::new(),
            run_on_load,
        }
    }

    fn deadlines_only(max_pending: u32) -> ModuleSchedule {
        ModuleSchedule {
            background_tasks: Vec::new(),
            deadlines: vec![deadline(max_pending)],
        }
    }

    async fn advance(ms: u64) {
        tokio::time::sleep(Duration::from_millis(ms)).await;
    }

    #[tokio::test(start_paused = true)]
    async fn an_earlier_entry_interrupts_the_current_sleep() {
        let h = Harness::new();
        h.scheduler.register("timer", &deadlines_only(8));
        h.at("late", 60_000, json!({})).unwrap();
        advance(1_000).await;
        h.at("early", 4_000, json!({})).unwrap();
        advance(10_000).await;

        let calls = h.calls();
        assert_eq!(calls.len(), 1, "{calls:?}");
        assert_eq!(calls[0].event["deadline"]["key"], "early");
        assert_eq!(calls[0].at_ms, 5_000);
    }

    #[tokio::test(start_paused = true)]
    async fn arming_an_existing_key_replaces_it() {
        let h = Harness::new();
        h.scheduler.register("timer", &deadlines_only(8));
        h.at("t1", 10_000, json!({ "v": 1 })).unwrap();
        h.at("t1", 20_000, json!({ "v": 2 })).unwrap();
        advance(30_000).await;

        let calls = h.calls();
        assert_eq!(calls.len(), 1, "{calls:?}");
        assert_eq!(calls[0].at_ms, 20_000);
        assert_eq!(calls[0].event["parameters"], json!({ "v": 2 }));
    }

    #[tokio::test(start_paused = true)]
    async fn a_fired_deadline_carries_its_params_and_identity() {
        let h = Harness::new();
        h.scheduler.register("timer", &deadlines_only(8));
        let due = h.now_ms() + 2_000;
        h.scheduler
            .at("timer", "timer_end", "t1", due, json!({ "target": "t1" }))
            .unwrap();
        advance(3_000).await;

        let calls = h.calls();
        assert_eq!(calls[0].function, EXPIRE);
        assert_eq!(
            calls[0].event,
            json!({
                "parameters": { "target": "t1" },
                "deadline": { "id": "timer_end", "key": "t1", "dueAt": due, "firedAt": due },
            })
        );
    }

    #[tokio::test(start_paused = true)]
    async fn a_cancelled_entry_never_fires() {
        let h = Harness::new();
        h.scheduler.register("timer", &deadlines_only(8));
        h.at("t1", 10_000, json!({})).unwrap();
        h.scheduler.cancel("timer", "timer_end", "t1").unwrap();
        h.scheduler
            .cancel("timer", "timer_end", "never-armed")
            .expect("cancelling nothing is not an error");
        advance(30_000).await;
        assert!(h.calls().is_empty());
    }

    #[tokio::test(start_paused = true)]
    async fn a_time_in_the_past_fires_at_once() {
        let h = Harness::new();
        h.scheduler.register("timer", &deadlines_only(8));
        advance(1_000).await;
        h.at("t1", -5_000, json!({})).unwrap();
        advance(1).await;

        let calls = h.calls();
        assert_eq!(calls.len(), 1);
        assert_eq!(calls[0].at_ms, 1_000);
        let deadline = &calls[0].event["deadline"];
        assert!(deadline["dueAt"].as_i64() < deadline["firedAt"].as_i64());
    }

    #[tokio::test(start_paused = true)]
    async fn max_pending_bounds_the_entries_a_deadline_holds() {
        let h = Harness::new();
        h.scheduler.register("timer", &deadlines_only(2));
        h.at("a", 1_000, json!({})).unwrap();
        h.at("b", 5_000, json!({})).unwrap();
        let err = h.at("c", 5_000, json!({})).unwrap_err();
        assert!(err.contains("maxPending"), "{err}");
        h.at("a", 2_000, json!({}))
            .expect("replacing an entry does not add one");

        advance(3_000).await;
        h.at("c", 5_000, json!({}))
            .expect("a fired entry frees its slot");

        h.scheduler.cancel("timer", "timer_end", "b").unwrap();
        h.at("d", 5_000, json!({}))
            .expect("a cancelled entry frees its slot");
    }

    #[tokio::test(start_paused = true)]
    async fn a_request_the_declarations_do_not_allow_is_refused() {
        let h = Harness::new();
        let err = h.at("t1", 1_000, json!({})).unwrap_err();
        assert!(err.contains("no schedule registered"), "{err}");

        h.scheduler.register("timer", &deadlines_only(8));
        let err = h
            .scheduler
            .at("timer", "undeclared", "t1", h.now_ms(), json!({}))
            .unwrap_err();
        assert!(err.contains("not declared"), "{err}");
        let err = h.scheduler.cancel("timer", "undeclared", "t1").unwrap_err();
        assert!(err.contains("not declared"), "{err}");

        let err = h.at("t1", DEADLINE_HORIZON_MS + 1, json!({})).unwrap_err();
        assert!(err.contains("30 days"), "{err}");
        h.at("t1", DEADLINE_HORIZON_MS, json!({}))
            .expect("exactly the horizon is allowed");
    }

    #[tokio::test(start_paused = true)]
    async fn unregistering_a_module_drops_its_entries() {
        let h = Harness::new();
        h.scheduler.register("timer", &deadlines_only(8));
        h.at("t1", 10_000, json!({})).unwrap();
        h.scheduler.unregister("timer");
        advance(30_000).await;
        assert!(h.calls().is_empty());
        assert!(h.at("t1", 1_000, json!({})).is_err());
    }

    #[tokio::test(start_paused = true)]
    async fn registering_again_drops_what_the_module_had_armed() {
        let h = Harness::new();
        h.scheduler.register("timer", &deadlines_only(8));
        h.at("t1", 10_000, json!({})).unwrap();
        h.scheduler.register("timer", &deadlines_only(8));
        advance(30_000).await;
        assert!(h.calls().is_empty());
    }

    #[tokio::test(start_paused = true)]
    async fn disabling_drops_entries_and_enabling_fires_run_on_load_again() {
        let h = Harness::new();
        let schedule = ModuleSchedule {
            background_tasks: vec![task("0 0 * * * *", true)],
            deadlines: vec![deadline(8)],
        };
        h.scheduler.register("timer", &schedule);
        advance(1).await;
        h.at("t1", 10_000, json!({})).unwrap();

        h.scheduler.set_enabled("timer", false);
        assert!(
            h.at("t2", 1_000, json!({}))
                .unwrap_err()
                .contains("disabled")
        );
        advance(20_000).await;
        assert!(h.fired(EXPIRE).is_empty());

        h.scheduler.set_enabled("timer", true);
        advance(1).await;
        assert_eq!(h.fired(RECONCILE), vec![0, 20_001]);
    }

    #[tokio::test(start_paused = true)]
    async fn cancel_key_drops_every_entry_with_that_key() {
        let h = Harness::new();
        h.scheduler.register("timer", &deadlines_only(8));
        h.at("woofx3:timer:t1", 10_000, json!({})).unwrap();
        h.at("woofx3:timer:t2", 10_000, json!({})).unwrap();
        h.scheduler.cancel_key("woofx3:timer:t1");
        advance(30_000).await;

        let calls = h.calls();
        assert_eq!(calls.len(), 1);
        assert_eq!(calls[0].event["deadline"]["key"], "woofx3:timer:t2");
    }

    #[tokio::test(start_paused = true)]
    async fn cron_tasks_keep_firing_on_schedule() {
        let h = Harness::new();
        h.scheduler.register(
            "timer",
            &ModuleSchedule {
                background_tasks: vec![task("*/10 * * * * *", false)],
                deadlines: Vec::new(),
            },
        );
        advance(35_000).await;
        assert_eq!(h.fired(RECONCILE), vec![10_000, 20_000, 30_000]);
        assert_eq!(h.calls()[0].event, json!({}));
    }

    #[tokio::test(start_paused = true)]
    async fn a_five_field_cron_fires_on_the_minute() {
        let h = Harness::new();
        h.scheduler.register(
            "timer",
            &ModuleSchedule {
                background_tasks: vec![task("* * * * *", false)],
                deadlines: Vec::new(),
            },
        );
        advance(130_000).await;
        assert_eq!(h.fired(RECONCILE), vec![60_000, 120_000]);
    }

    #[tokio::test(start_paused = true)]
    async fn run_on_load_fires_on_register_and_retries_until_it_succeeds() {
        let h = Harness::with(HashMap::from([(RECONCILE.to_string(), 2)]), HashMap::new());
        h.scheduler.register(
            "timer",
            &ModuleSchedule {
                background_tasks: vec![task("0 0 * * * *", true)],
                deadlines: Vec::new(),
            },
        );
        advance(30_000).await;
        // Fails at 0, retries after 1s, fails, retries after 2s, succeeds.
        assert_eq!(h.fired(RECONCILE), vec![0, 1_000, 3_000]);
    }

    #[tokio::test(start_paused = true)]
    async fn run_on_load_gives_up_after_bounded_attempts() {
        let h = Harness::with(
            HashMap::from([(RECONCILE.to_string(), u32::MAX)]),
            HashMap::new(),
        );
        h.scheduler.register(
            "timer",
            &ModuleSchedule {
                background_tasks: vec![task("0 0 0 1 1 *", true)],
                deadlines: Vec::new(),
            },
        );
        advance(3_600_000).await;
        assert_eq!(h.fired(RECONCILE).len(), LOAD_ATTEMPTS as usize);
    }

    #[tokio::test(start_paused = true)]
    async fn a_task_without_run_on_load_does_not_fire_on_register() {
        let h = Harness::new();
        h.scheduler.register(
            "timer",
            &ModuleSchedule {
                background_tasks: vec![task("0 0 * * * *", false)],
                deadlines: Vec::new(),
            },
        );
        advance(30_000).await;
        assert!(h.calls().is_empty());
    }

    #[tokio::test(start_paused = true)]
    async fn an_entry_waits_for_a_running_invocation_of_the_same_key() {
        let h = Harness::with(
            HashMap::new(),
            HashMap::from([(EXPIRE.to_string(), Duration::from_secs(5))]),
        );
        h.scheduler.register("timer", &deadlines_only(8));
        h.at("t1", 0, json!({ "run": 1 })).unwrap();
        advance(1_000).await;
        h.at("t1", 0, json!({ "run": 2 })).unwrap();
        h.at("t2", 0, json!({})).unwrap();
        advance(20_000).await;

        let calls = h.calls();
        let t1: Vec<(u128, Value)> = calls
            .iter()
            .filter(|c| c.event["deadline"]["key"] == "t1")
            .map(|c| (c.at_ms, c.event["parameters"]["run"].clone()))
            .collect();
        assert_eq!(t1, vec![(0, json!(1)), (5_000, json!(2))]);
        let t2: Vec<u128> = calls
            .iter()
            .filter(|c| c.event["deadline"]["key"] == "t2")
            .map(|c| c.at_ms)
            .collect();
        assert_eq!(t2, vec![1_000], "another key does not wait");
    }

    #[tokio::test(start_paused = true)]
    async fn a_failed_deadline_is_not_retried() {
        let h = Harness::with(HashMap::from([(EXPIRE.to_string(), 1)]), HashMap::new());
        h.scheduler.register("timer", &deadlines_only(8));
        h.at("t1", 1_000, json!({})).unwrap();
        advance(60_000).await;
        assert_eq!(h.fired(EXPIRE), vec![1_000]);
    }

    #[tokio::test(start_paused = true)]
    async fn superseded_heap_items_do_not_accumulate() {
        let h = Harness::new();
        h.scheduler.register("timer", &deadlines_only(8));
        for i in 0..1_000 {
            h.at("t1", 1_000_000 + i, json!({})).unwrap();
        }
        advance(1).await;
        let heap_len = h.scheduler.inner.lock().heap.len();
        assert!(heap_len <= 2 * 1 + 64, "heap holds {heap_len} items");
    }

    /// The schedule the bundled woofx3 module declares, as registration reads
    /// it from the stored manifest.
    fn bundled_woofx3_schedule() -> ModuleSchedule {
        let manifest: lib_module::module_manifest::ModuleManifest =
            serde_json::from_str(include_str!("../../../../modules/woofx3/manifest.json"))
                .expect("bundled woofx3 manifest parses");
        ModuleSchedule {
            background_tasks: manifest.background_tasks,
            deadlines: manifest.deadlines,
        }
    }

    // The bundled timer, end to end through its real declarations: it reconciles
    // on load and once a minute, a timer's end fires at its endsAt, moving the
    // end moves the firing, and nothing runs once a second.
    #[tokio::test(start_paused = true)]
    async fn the_bundled_timer_ends_at_its_end_time_and_reconciles_once_a_minute() {
        const WOOFX3_EXPIRE: &str = "woofx3:function:timer.expire";
        const WOOFX3_RECONCILE: &str = "woofx3:function:timer.reconcile";
        let h = Harness::new();
        h.scheduler.register("woofx3", &bundled_woofx3_schedule());
        let target = "woofx3:timer:break";
        let arm = |in_ms: i64| {
            h.scheduler.at(
                "woofx3",
                "timer_end",
                target,
                h.now_ms() + in_ms,
                json!({ "target": target }),
            )
        };
        arm(90_000).unwrap();
        advance(1_000).await;
        arm(29_500).unwrap();
        advance(150_000).await;

        assert_eq!(h.fired(WOOFX3_EXPIRE), vec![30_500]);
        let expiry = h
            .calls()
            .into_iter()
            .find(|c| c.function == WOOFX3_EXPIRE)
            .unwrap();
        assert_eq!(expiry.event["parameters"], json!({ "target": target }));
        assert_eq!(
            expiry.event["deadline"]["dueAt"],
            expiry.event["deadline"]["firedAt"]
        );
        assert_eq!(h.fired(WOOFX3_RECONCILE), vec![0, 60_000, 120_000]);
        assert_eq!(h.calls().len(), 4, "{:?}", h.calls());
    }

    #[test]
    fn load_retry_backs_off_to_a_cap() {
        assert_eq!(load_retry_delay(1), Duration::from_secs(1));
        assert_eq!(load_retry_delay(2), Duration::from_secs(2));
        assert_eq!(load_retry_delay(3), Duration::from_secs(4));
        assert_eq!(load_retry_delay(20), LOAD_RETRY_MAX);
    }
}
