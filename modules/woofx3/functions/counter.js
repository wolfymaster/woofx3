// Counters: one number per `counter` resource instance, kept in this module's
// storage at `state:<canonicalId>` — the key every resource kind keeps its value
// under, and the one the dashboard reads.
//
// A counter may carry goals: numbers it announces reaching, so the same counter
// that shows deaths or gifted subs can also fire an alert at 100, 250 and 500.
// A goal may have a name ("New emote"), which the announcement carries.
// Reaching one is an edge, not a level — only the change that carries the
// counter from below a goal to at or above it announces `goal.reached`, so a
// counter that keeps climbing announces once per goal. Crossing again after
// dropping below announces again only when the counter says to, which is why
// the moment each goal was first reached is stored beside the number: one
// compare-and-set settles the value and the record of it together, and there is
// no transaction spanning two keys to fall back on.
//
// The stored value is `{ value, reached }`. A counter written before goals
// existed holds a bare number and still reads correctly, so nothing has to be
// migrated.
//
// What a counter starts at, how far it steps, which goals it announces and how
// long its value lives are the instance's own settings, chosen when it was
// created and read back through `ctx.resources.get`. A counter scoped to the
// stream session is written with `clearOnSessionEnd`, so the engine drops it
// when the session ends; a counter with no stored value reads as its initial
// value either way.
//
// Every change goes through `compareAndSet`, because a chat command and a
// workflow can change the same counter at the same moment, and a read followed
// by a write would lose one of the two.

// Enough to ride out a burst of simultaneous updates; running out means
// something is writing this key continuously, which is worth failing loudly.
const MAX_ATTEMPTS = 25;

// The engine's limit on events one invocation may return. A single change can
// cross several goals at once, so the announcements are capped to fit beside
// the `counter.changed` that carries them.
const MAX_EVENTS = 16;

function counterIncrement(ctx) {
  const counter = loadCounter(ctx);
  const amount = amountOrStep(ctx, counter);
  return update(ctx, counter, (previous) => previous + amount);
}

function counterDecrement(ctx) {
  const counter = loadCounter(ctx);
  const amount = amountOrStep(ctx, counter);
  return update(ctx, counter, (previous) => previous - amount);
}

function counterSet(ctx) {
  const counter = loadCounter(ctx);
  const value = Number(parameters(ctx).value);
  if (!Number.isFinite(value)) {
    throw new Error(`counter: cannot set ${counter.target} to "${parameters(ctx).value}", which is not a number`);
  }
  return update(ctx, counter, () => value);
}

// Puts the counter back to its starting value and forgets which goals it has
// reached, so a counter started over can reach them for the first time again.
function counterReset(ctx) {
  const counter = loadCounter(ctx);
  return update(ctx, counter, () => counter.initial, { forget: true });
}

function parameters(ctx) {
  return (ctx.event && ctx.event.parameters) || {};
}

// The chosen counter and its settings. Refuses a target that is not a counter,
// since writing a number over another kind's value would corrupt it silently.
function loadCounter(ctx) {
  const target = parameters(ctx).target;
  if (typeof target !== "string" || target === "") {
    throw new Error("counter: no counter chosen");
  }
  const instance = ctx.resources.get(target);
  if (!instance) {
    throw new Error(`counter: ${target} does not exist — it may have been deleted`);
  }
  if (instance.kind !== "counter") {
    throw new Error(`counter: ${target} is a ${instance.kind}, not a counter`);
  }
  const settings = instance.settings || {};
  return {
    target,
    key: `state:${target}`,
    initial: numberOr(settings.initialValue, 0),
    step: numberOr(settings.step, 1),
    goals: parseGoals(settings.goals),
    announceEveryTime: settings.announceEveryTime === true,
    options: { clearOnSessionEnd: settings.lifetime === "session" },
  };
}

// The goals a counter announces reaching, as `{ value, name }`, smallest first
// and one per number. The instance's settings hold them as a list of rows; a
// counter set up before goals had names holds them as a comma-separated string
// of numbers, which still reads. A row whose number is not a number is skipped
// rather than failing the change, because counting is the counter's job and a
// typo in an optional setting must not stop it. Two rows with the same number
// are one goal, named by the first that has a name.
function parseGoals(raw) {
  const rows = typeof raw === "string" ? raw.split(",").map((part) => ({ value: part })) : raw;
  if (!Array.isArray(rows)) {
    return [];
  }
  const goals = [];
  for (const row of rows) {
    if (row === null || typeof row !== "object") {
      continue;
    }
    const text = typeof row.value === "string" ? row.value.trim() : row.value;
    const value = Number(text);
    if (text === "" || text === null || text === undefined || !Number.isFinite(value)) {
      continue;
    }
    const name = typeof row.name === "string" ? row.name.trim() : "";
    const existing = goals.find((goal) => goal.value === value);
    if (!existing) {
      goals.push({ value, name });
    } else if (existing.name === "") {
      existing.name = name;
    }
  }
  return goals.sort((a, b) => a.value - b.value);
}

// The counter as it stands, from a stored value in either shape or from
// nothing. `reached` maps a goal to the moment it was first reached.
function readState(counter, stored) {
  if (stored === null || stored === undefined) {
    return { value: counter.initial, reached: {} };
  }
  if (typeof stored === "object") {
    const value = Number(stored.value);
    const reached = stored.reached;
    return {
      value: Number.isFinite(value) ? value : counter.initial,
      reached: reached !== null && typeof reached === "object" ? reached : {},
    };
  }
  // Written before counters carried goals.
  const value = Number(stored);
  return { value: Number.isFinite(value) ? value : counter.initial, reached: {} };
}

// Which goals this change reached, and the record of first crossings to store
// beside the new value.
//
// Only goals the counter still carries are recorded, so removing a goal and
// adding it back lets it be reached for the first time again rather than
// leaving a record nothing can clear.
function crossings(counter, before, previous, value, forget) {
  const record = {};
  const announce = [];
  const now = Date.now();

  for (const goal of counter.goals) {
    const key = String(goal.value);
    const stored = forget ? Number.NaN : Number(before[key]);
    let at = Number.isFinite(stored) ? stored : null;

    const crossed = previous < goal.value && value >= goal.value;
    const first = crossed && at === null;
    if (first) {
      at = now;
    }
    if (crossed && (first || counter.announceEveryTime)) {
      announce.push({ goal: goal.value, goalName: goal.name, first, firstReachedAt: at });
    }
    if (at !== null) {
      record[key] = at;
    }
  }

  return { record, announce };
}

// Apply `next` to the current value until the write lands, and report both
// sides of it — `previous` and `next` are what later workflow steps read. A
// change that moved the number is announced as `counter.changed`, so workflows
// can act on it whichever action, command or page made it, and each goal the
// change reached is announced as `goal.reached` alongside it.
function update(ctx, counter, next, { forget = false } = {}) {
  let stored = ctx.storage.get(counter.key);
  for (let attempt = 0; attempt < MAX_ATTEMPTS; attempt++) {
    const state = readState(counter, stored);
    const previous = state.value;
    const value = next(previous);
    const reached = crossings(counter, state.reached, previous, value, forget);
    const written = { value, reached: reached.record };

    const result = ctx.storage.compareAndSet(counter.key, stored === undefined ? null : stored, written, counter.options);
    if (result.swapped) {
      const outcome = {
        target: counter.target,
        previous,
        next: value,
        reached: reached.announce.map((announced) => announced.goal),
      };

      const events = [];
      if (previous !== value) {
        events.push({ type: "counter.changed", data: { target: counter.target, previous, next: value } });
      }
      for (const announced of reached.announce) {
        if (events.length >= MAX_EVENTS) {
          break;
        }
        events.push({
          type: "goal.reached",
          data: {
            target: counter.target,
            previous,
            next: value,
            goal: announced.goal,
            goalName: announced.goalName,
            first: announced.first,
            firstReachedAt: announced.firstReachedAt,
          },
        });
      }

      return ctx.result(outcome, events);
    }
    stored = result.current;
  }
  throw new Error(`counter: ${counter.target} changed ${MAX_ATTEMPTS} times while updating it`);
}

// The step's `amount` when one is given, else the counter's own step. The amount
// is often an expression over the event (e.g. the bits cheered), so it is checked
// here rather than trusted to the form's minimum.
function amountOrStep(ctx, counter) {
  const raw = parameters(ctx).amount;
  if (raw === null || raw === undefined || raw === "") {
    return counter.step;
  }
  const amount = Number(raw);
  if (!Number.isFinite(amount)) {
    throw new Error(`counter: cannot change ${counter.target} by "${raw}", which is not a number`);
  }
  if (amount <= 0) {
    throw new Error(`counter: cannot change ${counter.target} by ${amount}; the amount must be more than 0`);
  }
  return amount;
}

function numberOr(value, fallback) {
  const number = Number(value);
  return value === null || value === undefined || value === "" || !Number.isFinite(number) ? fallback : number;
}
