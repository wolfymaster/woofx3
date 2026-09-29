// Timers: one countdown per `timer` resource instance, kept in this module's
// storage at `state:<canonicalId>` — the key every resource kind keeps its value
// under, and the one the dashboard and widgets read.
//
// A timer is never written once a second. A running timer is stored as the
// moment it reaches zero, `{ running: true, endsAt }`, and a stopped one as what
// it has left, `{ running: false, remainingMs }`; whoever shows it works out the
// time left from those. A timer with no stored value is stopped at its full
// duration, so a new or session-cleared timer needs no write to be ready.
//
// Every write that leaves a timer running arms the `timer_end` deadline, keyed
// by the timer's canonical id, for its `endsAt`; every write that stops it
// cancels that entry. `timerExpire` runs when the entry comes due, stops the
// timer and announces `timer.ended`. Starting and pausing are announced by the
// actions that do them. Workflows act on all three.
//
// Deadline entries live in memory only, so storage stays the source of truth:
// `timerReconcile` runs when the module loads and once a minute after, ends the
// timers that ran out while nothing was watching and arms the rest. A firing
// that no longer matches storage (time added, timer paused or deleted) does
// nothing.
//
// How long a timer runs and how long its value lives are the instance's own
// settings, read back through `ctx.resources.get`. Every change goes through
// `compareAndSet`, because a chat command, a workflow and a deadline firing can
// change the same timer at the same moment.

const DEADLINE = "timer_end";

// Enough to ride out a burst of simultaneous updates; running out means
// something is writing this key continuously, which is worth failing loudly.
const MAX_ATTEMPTS = 25;

// A day. Far beyond any stream, and a bound on what a workflow adding time on
// every event can build up.
const MAX_REMAINING_MS = 24 * 60 * 60 * 1000;

// The engine's limit on events one invocation may return. A reconcile that
// finds more timers than this already run out arms the rest to fire at once,
// so each ends on its own firing.
const MAX_EVENTS = 16;

// Runs a stopped timer from what it has left, or from its full duration when it
// has already run out. Starting a running timer changes nothing.
function timerStart(ctx) {
  const timer = loadTimer(ctx);
  return update(ctx, timer, (remainingMs) => ({
    running: true,
    remainingMs: remainingMs > 0 ? remainingMs : timer.durationMs,
  }));
}

function timerPause(ctx) {
  const timer = loadTimer(ctx);
  return update(ctx, timer, (remainingMs) => ({ running: false, remainingMs }), { announcePause: true });
}

// Stops the timer at its full duration.
function timerReset(ctx) {
  const timer = loadTimer(ctx);
  return update(ctx, timer, () => ({ running: false, remainingMs: timer.durationMs }));
}

// Adds time to a running or stopped timer; negative seconds take it away. A
// running timer that has run out but not yet been ended starts counting down
// again.
function timerAdd(ctx) {
  const timer = loadTimer(ctx);
  const seconds = secondsParameter(ctx, timer, "seconds");
  return update(ctx, timer, (remainingMs, running) => ({ running, remainingMs: remainingMs + seconds * 1000 }));
}

// Sets the time left without starting or stopping the timer.
function timerSet(ctx) {
  const timer = loadTimer(ctx);
  const seconds = secondsParameter(ctx, timer, "seconds");
  return update(ctx, timer, (_, running) => ({ running, remainingMs: seconds * 1000 }));
}

// Runs when a timer's `timer_end` entry comes due. Ends the timer only when
// storage still says it is running and out of time, and announces `timer.ended`
// only when this call's write is the one that stopped it, so a stale or repeated
// firing does nothing. A firing that arrives before `endsAt` arms the entry again
// for it.
function timerExpire(ctx) {
  const target = parameters(ctx).target;
  if (typeof target !== "string" || target === "") {
    throw new Error("timer: a timer_end firing carried no target");
  }
  const instance = ctx.resources.get(target);
  if (!instance || instance.kind !== "timer") {
    return ctx.result({ ended: 0 });
  }
  const timer = timerFromInstance(instance);
  const stored = ctx.storage.get(timer.key);
  if (!isRunning(stored)) {
    return ctx.result({ ended: 0 });
  }
  if (Number(stored.endsAt) > Date.now()) {
    arm(ctx, timer, stored.endsAt);
    return ctx.result({ ended: 0 });
  }
  const events = end(ctx, timer, stored) ? [endedEvent(timer)] : [];
  return ctx.result({ ended: events.length }, events);
}

// Rebuilds this module's timer deadlines from storage: ends every running timer
// that has run out and arms the rest. Runs when the module loads, which is how
// deadlines come back after a restart, and once a minute as the safety net for
// an arm or cancel that did not happen.
function timerReconcile(ctx) {
  const now = Date.now();
  const events = [];
  let armed = 0;
  const prefix = `${ctx.module.id}:timer:`;
  for (const instance of ctx.resources.list("timer")) {
    if (!instance.canonical_id.startsWith(prefix)) {
      continue;
    }
    const timer = timerFromInstance(instance);
    const stored = ctx.storage.get(timer.key);
    if (!isRunning(stored)) {
      continue;
    }
    if (Number(stored.endsAt) <= now && events.length < MAX_EVENTS) {
      if (end(ctx, timer, stored)) {
        events.push(endedEvent(timer));
      }
      continue;
    }
    if (arm(ctx, timer, stored.endsAt)) {
      armed++;
    }
  }
  return ctx.result({ ended: events.length, armed }, events);
}

function isRunning(stored) {
  return Boolean(stored) && stored.running === true;
}

// Stops a timer that has run out, unless another writer changed it since
// `stored` was read. That writer armed or cancelled the deadline itself.
function end(ctx, timer, stored) {
  const ended = { running: false, remainingMs: 0 };
  return ctx.storage.compareAndSet(timer.key, stored, ended, timer.options).swapped;
}

function endedEvent(timer) {
  return { type: "timer.ended", data: { target: timer.target } };
}

// Arms the timer's deadline for `endsAt`. A refusal (the deadline holding its
// `maxPending` entries) is logged rather than thrown: the timer's value has
// already been written, and the reconcile task ends a running timer whose
// deadline was never armed, up to a minute late.
function arm(ctx, timer, endsAt) {
  try {
    ctx.schedule.at(DEADLINE, timer.target, Number(endsAt), { target: timer.target });
    return true;
  } catch (err) {
    ctx.log.error(`timer: could not arm the end of ${timer.target}: ${err && err.message ? err.message : err}`);
    return false;
  }
}

function parameters(ctx) {
  return (ctx.event && ctx.event.parameters) || {};
}

function secondsParameter(ctx, timer, name) {
  const raw = parameters(ctx)[name];
  const seconds = Number(raw);
  if (raw === null || raw === undefined || raw === "" || !Number.isFinite(seconds)) {
    throw new Error(`timer: cannot change ${timer.target} by "${raw}", which is not a number of seconds`);
  }
  return seconds;
}

// The chosen timer and its settings. Refuses a target that is not a timer,
// since writing a timer over another kind's value would corrupt it silently.
function loadTimer(ctx) {
  const target = parameters(ctx).target;
  if (typeof target !== "string" || target === "") {
    throw new Error("timer: no timer chosen");
  }
  const instance = ctx.resources.get(target);
  if (!instance) {
    throw new Error(`timer: ${target} does not exist — it may have been deleted`);
  }
  if (instance.kind !== "timer") {
    throw new Error(`timer: ${target} is a ${instance.kind}, not a timer`);
  }
  return timerFromInstance(instance);
}

function timerFromInstance(instance) {
  const settings = instance.settings || {};
  return {
    target: instance.canonical_id,
    key: `state:${instance.canonical_id}`,
    durationMs: clampRemaining(numberOr(settings.duration, 300) * 1000),
    options: { clearOnSessionEnd: settings.lifetime === "session" },
  };
}

// Time left at `now` and whether the timer is counting down, from a stored
// value in either shape, or from nothing.
function readTimer(timer, stored, now) {
  if (stored === null || stored === undefined) {
    return { running: false, remainingMs: timer.durationMs };
  }
  if (stored.running) {
    return { running: true, remainingMs: Math.max(0, Number(stored.endsAt) - now) };
  }
  return { running: false, remainingMs: Math.max(0, Number(stored.remainingMs)) };
}

// Apply `next` to the timer as it stands until the write lands, and report both
// sides of it. `next` returns the time left and whether the timer runs; this
// turns a running one into the moment it ends.
//
// A timer that goes from standing still to counting down is announced as
// `timer.started`. Stopping one is announced as `timer.paused` only when the
// caller is pausing it, so a reset is not mistaken for a pause.
function update(ctx, timer, next, { announcePause = false } = {}) {
  let stored = ctx.storage.get(timer.key);
  for (let attempt = 0; attempt < MAX_ATTEMPTS; attempt++) {
    const now = Date.now();
    const previous = readTimer(timer, stored, now);
    const wanted = next(previous.remainingMs, previous.running);
    const remainingMs = clampRemaining(wanted.remainingMs);
    const value = wanted.running ? { running: true, endsAt: now + remainingMs } : { running: false, remainingMs };
    const result = ctx.storage.compareAndSet(timer.key, stored === undefined ? null : stored, value, timer.options);
    if (result.swapped) {
      if (value.running) {
        arm(ctx, timer, value.endsAt);
      } else {
        ctx.schedule.cancel(DEADLINE, timer.target);
      }
      const outcome = {
        target: timer.target,
        running: wanted.running,
        previous: toSeconds(previous.remainingMs),
        remaining: toSeconds(remainingMs),
        endsAt: wanted.running ? value.endsAt : null,
      };
      const wasCounting = previous.running && previous.remainingMs > 0;
      const isCounting = wanted.running && remainingMs > 0;
      const events = [];
      if (!wasCounting && isCounting) {
        events.push({ type: "timer.started", data: { target: timer.target, remaining: outcome.remaining } });
      }
      if (announcePause && wasCounting && !isCounting) {
        events.push({ type: "timer.paused", data: { target: timer.target, remaining: outcome.remaining } });
      }
      return ctx.result(outcome, events);
    }
    stored = result.current;
  }
  throw new Error(`timer: ${timer.target} changed ${MAX_ATTEMPTS} times while updating it`);
}

function clampRemaining(ms) {
  return Math.min(MAX_REMAINING_MS, Math.max(0, Math.round(ms)));
}

// Whole seconds, rounded up, so a timer with any time left never reads as 0.
function toSeconds(ms) {
  return Math.ceil(ms / 1000);
}

function numberOr(value, fallback) {
  const number = Number(value);
  return value === null || value === undefined || value === "" || !Number.isFinite(number) ? fallback : number;
}
