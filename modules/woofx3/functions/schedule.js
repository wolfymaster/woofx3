// Schedules: one repeating interval per `schedule` resource instance, kept in
// this module's storage at `state:<canonicalId>` — the key every resource kind
// keeps its value under, and the one the dashboard reads.
//
// Nothing polls for a schedule coming due. A running schedule is stored as its
// next run, `{ running: true, nextAt, intervalMs, lastFiredAt }`, with the
// `schedule_due` deadline armed for `nextAt`; the firing announces
// `schedule.fired`, moves `nextAt` on and arms the deadline again. A stopped one
// is `{ running: false, lastFiredAt }`, and one with no stored value is stopped,
// so a new or session-cleared schedule does nothing until something starts it.
// What a run does is up to the workflows triggered by `schedule.fired`.
//
// Runs stay on the grid set by the start, `nextAt` plus whole intervals, so a
// slow workflow or a late firing never makes the schedule drift.
//
// Deadline entries live in memory only, so storage stays the source of truth:
// `scheduleReconcile` runs when the module loads and once a minute after, and
// arms every running schedule again. A firing that no longer matches storage
// (schedule stopped or deleted, or already fired) does nothing, and every change
// goes through `compareAndSet`, so only one writer ever announces a given run.

const DEADLINE = "schedule_due";

// Enough to ride out a burst of simultaneous updates; running out means
// something is writing this key continuously, which is worth failing loudly.
const MAX_ATTEMPTS = 25;

// The shortest interval: a floor on how hard a schedule can drive its workflows
// and chat, whatever its settings claim. Must match `min` on the `interval`
// setting in manifest.json.
const MIN_INTERVAL_MINUTES = 1;

// The longest interval, inside barkloader's 30-day DEADLINE_HORIZON_MS, so a next
// run can always be armed directly. Must match `max` on the `interval` setting.
const MAX_INTERVAL_MINUTES = 28 * 24 * 60;

const DEFAULT_INTERVAL_MINUTES = 15;

const MS_PER_MINUTE = 60 * 1000;

// Starts the schedule, with its first run one interval from now. Starting a
// running schedule changes nothing, so it keeps its place on its grid.
function scheduleStart(ctx) {
  const schedule = loadSchedule(ctx);
  return update(ctx, schedule, (stored, now) => {
    if (isRunning(stored)) {
      return stored;
    }
    return runningValue(now + schedule.intervalMs, schedule, lastFiredAt(stored));
  });
}

function scheduleStop(ctx) {
  const schedule = loadSchedule(ctx);
  return update(ctx, schedule, (stored) => ({ running: false, lastFiredAt: lastFiredAt(stored) }));
}

// Reads the schedule without writing anything — what a workflow or another
// module (through `ctx.resources.run`) checks before deciding to change it.
function scheduleGet(ctx) {
  const schedule = loadSchedule(ctx);
  return outcome(schedule, ctx.storage.get(schedule.key));
}

// Runs when a schedule's `schedule_due` entry comes due. Announces the run only
// when this call's write is the one that moved `nextAt` on, so a stale or
// repeated firing does nothing.
//
// A run more than an interval late is skipped rather than announced, the way cron
// skips what came due while it was not running: an engine started after a night
// off should not post its 15-minute chat message the moment it boots. So is a run
// while the stream is offline, unless the schedule's `runWhileOffline` is on; both
// keep the schedule's place on its grid.
//
// When whether the stream is live cannot be read, `ctx.stream.isLive` throws out of
// this firing before anything is written, so the reconcile task retries the run
// within a minute rather than guessing either way.
function scheduleFire(ctx) {
  const target = parameters(ctx).target;
  if (typeof target !== "string" || target === "") {
    throw new Error("schedule: a schedule_due firing carried no target");
  }
  const instance = ctx.resources.get(target);
  if (!instance || instance.kind !== "schedule") {
    return ctx.result({ fired: false });
  }
  const schedule = scheduleFromInstance(instance);
  const stored = ctx.storage.get(schedule.key);
  if (!isRunning(stored)) {
    return ctx.result({ fired: false });
  }
  const now = Date.now();
  const nextAt = Number(stored.nextAt);
  if (nextAt > now) {
    arm(ctx, schedule, nextAt);
    return ctx.result({ fired: false });
  }
  const fired = now - nextAt <= schedule.intervalMs && (schedule.runWhileOffline || ctx.stream.isLive());
  const following = nextAt + (Math.floor((now - nextAt) / schedule.intervalMs) + 1) * schedule.intervalMs;
  const value = runningValue(following, schedule, fired ? now : lastFiredAt(stored));
  if (!ctx.storage.compareAndSet(schedule.key, stored, value, schedule.options).swapped) {
    return ctx.result({ fired: false });
  }
  arm(ctx, schedule, following);
  if (!fired) {
    return ctx.result({ fired: false });
  }
  return ctx.result({ fired: true }, [{ type: "schedule.fired", data: { target: schedule.target, firedAt: now } }]);
}

// Rebuilds this module's deadlines from storage. Runs when the module loads,
// which is how deadlines come back after a restart, and once a minute as the
// safety net for an arm or cancel that did not happen. An overdue schedule is
// armed in the past, so its firing alone decides what a late run means.
//
// It is also what applies an edited interval, since editing an instance's settings
// writes nothing here: the next run moves to one new interval from now.
function scheduleReconcile(ctx) {
  const now = Date.now();
  let armed = 0;
  const prefix = `${ctx.module.id}:schedule:`;
  for (const instance of ctx.resources.list("schedule")) {
    if (!instance.canonical_id.startsWith(prefix)) {
      continue;
    }
    const schedule = scheduleFromInstance(instance);
    const stored = ctx.storage.get(schedule.key);
    if (!isRunning(stored)) {
      continue;
    }
    let nextAt = Number(stored.nextAt);
    if (Number(stored.intervalMs) !== schedule.intervalMs) {
      const value = runningValue(now + schedule.intervalMs, schedule, lastFiredAt(stored));
      if (!ctx.storage.compareAndSet(schedule.key, stored, value, schedule.options).swapped) {
        continue;
      }
      nextAt = value.nextAt;
    }
    if (arm(ctx, schedule, nextAt)) {
      armed++;
    }
  }
  return ctx.result({ armed });
}

function isRunning(stored) {
  return Boolean(stored) && stored.running === true;
}

function lastFiredAt(stored) {
  return stored && stored.lastFiredAt ? Number(stored.lastFiredAt) : null;
}

function runningValue(nextAt, schedule, firedAt) {
  return { running: true, nextAt, intervalMs: schedule.intervalMs, lastFiredAt: firedAt };
}

// Arms the schedule's deadline. A refusal (the deadline holding its `maxPending`
// entries) is logged rather than thrown: the value has already been written, and
// the reconcile task arms a running schedule whose deadline was never armed.
function arm(ctx, schedule, nextAt) {
  try {
    ctx.schedule.at(DEADLINE, schedule.target, nextAt, { target: schedule.target });
    return true;
  } catch (err) {
    ctx.log.error(`schedule: could not arm the next run of ${schedule.target}: ${err && err.message ? err.message : err}`);
    return false;
  }
}

function parameters(ctx) {
  return (ctx.event && ctx.event.parameters) || {};
}

// The chosen schedule and its settings. Refuses a target that is not a schedule,
// since writing a schedule over another kind's value would corrupt it silently.
function loadSchedule(ctx) {
  const target = parameters(ctx).target;
  if (typeof target !== "string" || target === "") {
    throw new Error("schedule: no schedule chosen");
  }
  const instance = ctx.resources.get(target);
  if (!instance) {
    throw new Error(`schedule: ${target} does not exist — it may have been deleted`);
  }
  if (instance.kind !== "schedule") {
    throw new Error(`schedule: ${target} is a ${instance.kind}, not a schedule`);
  }
  return scheduleFromInstance(instance);
}

function scheduleFromInstance(instance) {
  const settings = instance.settings || {};
  return {
    target: instance.canonical_id,
    key: `state:${instance.canonical_id}`,
    intervalMs: intervalMinutes(settings.interval) * MS_PER_MINUTE,
    runWhileOffline: settings.runWhileOffline === true,
    options: { clearOnSessionEnd: settings.lifetime === "session" },
  };
}

function intervalMinutes(raw) {
  const minutes = Number(raw);
  if (raw === null || raw === undefined || raw === "" || !Number.isFinite(minutes)) {
    return DEFAULT_INTERVAL_MINUTES;
  }
  return Math.min(MAX_INTERVAL_MINUTES, Math.max(MIN_INTERVAL_MINUTES, minutes));
}

// Apply `next` to the schedule as it stands until the write lands, then arm or
// cancel its deadline to match what was written.
function update(ctx, schedule, next) {
  let stored = ctx.storage.get(schedule.key);
  for (let attempt = 0; attempt < MAX_ATTEMPTS; attempt++) {
    const value = next(stored, Date.now());
    const result = ctx.storage.compareAndSet(schedule.key, stored === undefined ? null : stored, value, schedule.options);
    if (result.swapped) {
      if (isRunning(value)) {
        arm(ctx, schedule, Number(value.nextAt));
      } else {
        ctx.schedule.cancel(DEADLINE, schedule.target);
      }
      return outcome(schedule, value);
    }
    stored = result.current;
  }
  throw new Error(`schedule: ${schedule.target} changed ${MAX_ATTEMPTS} times while updating it`);
}

function outcome(schedule, stored) {
  const running = isRunning(stored);
  return {
    target: schedule.target,
    running,
    nextAt: running ? Number(stored.nextAt) : null,
    lastFiredAt: lastFiredAt(stored),
  };
}
