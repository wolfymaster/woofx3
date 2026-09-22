// Counters: one number per `counter` resource instance, kept in this module's
// storage at `state:<canonicalId>` — the key every resource kind keeps its value
// under, and the one the dashboard reads.
//
// What a counter starts at, how far it steps and how long its value lives are
// the instance's own settings, chosen when it was created and read back through
// `ctx.resources.get`. A counter scoped to the stream session is written with
// `clearOnSessionEnd`, so the engine drops it when the session ends; a counter
// with no stored value reads as its initial value either way.
//
// Every change goes through `compareAndSet`, because a chat command and a
// workflow can change the same counter at the same moment, and a read followed
// by a write would lose one of the two.

// Enough to ride out a burst of simultaneous updates; running out means
// something is writing this key continuously, which is worth failing loudly.
const MAX_ATTEMPTS = 25;

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

function counterReset(ctx) {
  const counter = loadCounter(ctx);
  return update(ctx, counter, () => counter.initial);
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
    options: { clearOnSessionEnd: settings.lifetime === "session" },
  };
}

// Apply `next` to the current value until the write lands, and report both
// sides of it — `previous` and `next` are what later workflow steps read. A
// change that moved the number is announced as `counter.changed`, so workflows
// can act on it whichever action, command or page made it.
function update(ctx, counter, next) {
  let stored = ctx.storage.get(counter.key);
  for (let attempt = 0; attempt < MAX_ATTEMPTS; attempt++) {
    const previous = stored === null || stored === undefined ? counter.initial : Number(stored);
    const value = next(previous);
    const result = ctx.storage.compareAndSet(counter.key, stored === undefined ? null : stored, value, counter.options);
    if (result.swapped) {
      const outcome = { target: counter.target, previous, next: value };
      return ctx.result(outcome, previous === value ? [] : [{ type: "counter.changed", data: outcome }]);
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
