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
// Nothing runs at the moment a timer reaches zero, so `timerExpire` — the
// module's `timer_expiry` background task, once a second — stops every timer
// that has run out and announces `timer.ended` for it. Starting and pausing are
// announced by the actions that do them. Workflows act on all three.
//
// How long a timer runs and how long its value lives are the instance's own
// settings, read back through `ctx.resources.get`. Every change goes through
// `compareAndSet`, because a chat command, a workflow and the expiry task can
// change the same timer at the same moment.

// Enough to ride out a burst of simultaneous updates; running out means
// something is writing this key continuously, which is worth failing loudly.
const MAX_ATTEMPTS = 25;

// A day. Far beyond any stream, and a bound on what a workflow adding time on
// every event can build up.
const MAX_REMAINING_MS = 24 * 60 * 60 * 1000;

// The engine's limit on events one invocation may return. Timers past it that
// have run out are still running on the next pass, which ends them then.
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

// Ends every running timer of this module that has reached zero: stops it with
// no time left and announces `timer.ended`. A timer changed between the read and
// the write (time added at the last second) is left for the next pass to judge.
function timerExpire(ctx) {
  const now = Date.now();
  const events = [];
  const prefix = `${ctx.module.id}:timer:`;
  for (const instance of ctx.resources.list("timer")) {
    if (events.length >= MAX_EVENTS) {
      break;
    }
    if (!instance.canonical_id.startsWith(prefix)) {
      continue;
    }
    const timer = timerFromInstance(instance);
    const stored = ctx.storage.get(timer.key);
    if (!stored || stored.running !== true || Number(stored.endsAt) > now) {
      continue;
    }
    const ended = { running: false, remainingMs: 0 };
    if (ctx.storage.compareAndSet(timer.key, stored, ended, timer.options).swapped) {
      events.push({ type: "timer.ended", data: { target: timer.target } });
    }
  }
  return ctx.result({ ended: events.length }, events);
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
