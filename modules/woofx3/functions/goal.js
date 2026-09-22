// Goals: one number per `goal` resource instance and the target it climbs
// toward, kept in this module's storage at `state:<canonicalId>` — the key every
// resource kind keeps its value under, and the one the dashboard reads.
//
// A goal is stored as `{ value, firstReachedAt }` rather than a bare number,
// because reaching the target is an edge, not a level: `goal.reached` is
// announced when a change carries the value from below the target to at or
// above it, and answering "was this the first time" needs the moment the first
// crossing happened. Both live in one value so a single compare-and-set settles
// the number and the record of it together; there is no transaction spanning
// two keys to fall back on.
//
// A goal owns its number and knows nothing about where the number came from.
// Bits, subs, donations and chat commands all reach it through `goal.add`, so
// nothing here is tied to a platform or an event.
//
// What a goal counts toward, what it starts at, whether reaching it again
// announces again and how long its value lives are the instance's own settings,
// read back through `ctx.resources.get`. A goal scoped to the stream session is
// written with `clearOnSessionEnd`, so the engine drops it when the session
// ends; a goal with no stored value reads as its initial value either way.

// Enough to ride out a burst of simultaneous updates; running out means
// something is writing this key continuously, which is worth failing loudly.
const MAX_ATTEMPTS = 25;

// Adds to the goal: the `amount` parameter, or the goal's step when the caller
// gives none. A workflow forwards an event's own number here, so `amount`
// arrives as a string whenever it came from an expression.
function goalAdd(ctx) {
  const goal = loadGoal(ctx);
  const amount = amountParameter(ctx, goal);
  return update(ctx, goal, (previous) => previous + amount);
}

function goalSubtract(ctx) {
  const goal = loadGoal(ctx);
  const amount = amountParameter(ctx, goal);
  return update(ctx, goal, (previous) => previous - amount);
}

function goalSet(ctx) {
  const goal = loadGoal(ctx);
  const value = Number(parameters(ctx).value);
  if (!Number.isFinite(value)) {
    throw new Error(`goal: cannot set ${goal.target} to "${parameters(ctx).value}", which is not a number`);
  }
  return update(ctx, goal, () => value);
}

// Puts the goal back to its starting value and forgets that it was ever
// reached, so a goal started over can be reached again for the first time.
function goalReset(ctx) {
  const goal = loadGoal(ctx);
  return update(ctx, goal, () => goal.initial, { forget: true });
}

function parameters(ctx) {
  return (ctx.event && ctx.event.parameters) || {};
}

function amountParameter(ctx, goal) {
  const raw = parameters(ctx).amount;
  if (raw === null || raw === undefined || raw === "") {
    return goal.step;
  }
  const amount = Number(raw);
  if (!Number.isFinite(amount)) {
    throw new Error(`goal: cannot change ${goal.target} by "${raw}", which is not a number`);
  }
  return amount;
}

// The chosen goal and its settings. Refuses a target that is not a goal, since
// writing a goal over another kind's value would corrupt it silently.
function loadGoal(ctx) {
  const target = parameters(ctx).target;
  if (typeof target !== "string" || target === "") {
    throw new Error("goal: no goal chosen");
  }
  const instance = ctx.resources.get(target);
  if (!instance) {
    throw new Error(`goal: ${target} does not exist — it may have been deleted`);
  }
  if (instance.kind !== "goal") {
    throw new Error(`goal: ${target} is a ${instance.kind}, not a goal`);
  }
  const settings = instance.settings || {};
  return {
    target,
    key: `state:${target}`,
    goal: numberOr(settings.goal, 0),
    initial: numberOr(settings.initialValue, 0),
    step: numberOr(settings.step, 1),
    announceEveryTime: settings.announceEveryTime === true,
    options: { clearOnSessionEnd: settings.lifetime === "session" },
  };
}

function readValue(goal, stored) {
  if (stored === null || stored === undefined) {
    return goal.initial;
  }
  const value = Number(stored.value);
  return Number.isFinite(value) ? value : goal.initial;
}

// When the goal was first reached, or null while it never has been.
function readFirstReachedAt(stored) {
  if (stored === null || stored === undefined) {
    return null;
  }
  const at = Number(stored.firstReachedAt);
  return Number.isFinite(at) ? at : null;
}

// Apply `next` to the current value until the write lands, and report both
// sides of it along with whether that change reached the goal.
//
// Reaching the goal is announced as `goal.reached` only for the change that
// crosses the target, so a goal that keeps climbing past it announces once.
// Crossing it again after dropping below announces again only when the goal
// says to; `firstReachedAt` doubles as the record that it has already been
// announced, which is why it is written in the same compare-and-set as the
// value it describes.
function update(ctx, goal, next, { forget = false } = {}) {
  let stored = ctx.storage.get(goal.key);
  for (let attempt = 0; attempt < MAX_ATTEMPTS; attempt++) {
    const previous = readValue(goal, stored);
    const value = next(previous);
    const reachedBefore = forget ? null : readFirstReachedAt(stored);
    const crossed = previous < goal.goal && value >= goal.goal;
    const first = crossed && reachedBefore === null;
    const firstReachedAt = crossed && reachedBefore === null ? Date.now() : reachedBefore;
    const written = { value, firstReachedAt };
    const result = ctx.storage.compareAndSet(goal.key, stored === undefined ? null : stored, written, goal.options);
    if (result.swapped) {
      const outcome = {
        target: goal.target,
        previous,
        next: value,
        goal: goal.goal,
        reached: crossed,
        first,
        firstReachedAt,
      };
      const announce = crossed && (goal.announceEveryTime || first);
      return ctx.result(
        outcome,
        announce
          ? [
              {
                type: "goal.reached",
                data: {
                  target: goal.target,
                  previous,
                  next: value,
                  goal: goal.goal,
                  first,
                  firstReachedAt,
                },
              },
            ]
          : [],
      );
    }
    stored = result.current;
  }
  throw new Error(`goal: ${goal.target} changed ${MAX_ATTEMPTS} times while updating it`);
}

function numberOr(value, fallback) {
  const number = Number(value);
  return value === null || value === undefined || value === "" || !Number.isFinite(number) ? fallback : number;
}
