// Queues: one ordered list of text entries per `queue` resource instance — a
// viewer queue, a song list — kept in this module's storage at
// `state:<canonicalId>` as an array, first in line first. That is the key every
// resource kind keeps its value under, and the one the dashboard and widgets
// read. A queue with no stored value is empty.
//
// How many entries a queue holds, whether an entry may be in it twice and how
// long its value lives are the instance's own settings, read back through
// `ctx.resources.get`. Every change goes through `compareAndSet`, because two
// viewers joining at the same moment must both end up in line.
//
// A full queue, a duplicate or an empty queue is not an error: the result says
// what happened, so a workflow can answer the viewer instead of failing. An entry
// joining and an entry taken from the front are announced as `queue.added` and
// `queue.next`, so workflows can act on them whatever made the change.

// Enough to ride out a burst of simultaneous updates; running out means
// something is writing this key continuously, which is worth failing loudly.
const MAX_ATTEMPTS = 25;

// Every queue is bounded, whatever its settings say: its whole value is read
// and rewritten on each change.
const MAX_ENTRIES = 1000;

// Twitch's chat message limit, so any entry can be read back into chat.
const MAX_ENTRY_LENGTH = 500;

function queueAdd(ctx) {
  const queue = loadQueue(ctx);
  const entry = entryParameter(ctx, queue);
  return update(ctx, queue, (entries) => {
    const existing = entries.indexOf(entry);
    if (!queue.allowDuplicates && existing !== -1) {
      return { entries, result: { entry, added: false, reason: "duplicate", position: existing + 1 } };
    }
    if (entries.length >= queue.capacity) {
      return { entries, result: { entry, added: false, reason: "full", position: 0 } };
    }
    const next = entries.concat([entry]);
    return {
      entries: next,
      result: { entry, added: true, reason: "", position: next.length },
      announce: "queue.added",
    };
  });
}

// Takes the first entry out of the queue.
function queueNext(ctx) {
  const queue = loadQueue(ctx);
  return update(ctx, queue, (entries) => {
    if (entries.length === 0) {
      return { entries, result: { entry: "", taken: false } };
    }
    return { entries: entries.slice(1), result: { entry: entries[0], taken: true }, announce: "queue.next" };
  });
}

// Takes the first entry equal to `entry` out of the queue, wherever it is.
function queueRemove(ctx) {
  const queue = loadQueue(ctx);
  const entry = entryParameter(ctx, queue);
  return update(ctx, queue, (entries) => {
    const index = entries.indexOf(entry);
    if (index === -1) {
      return { entries, result: { entry, removed: false, position: 0 } };
    }
    const next = entries.slice(0, index).concat(entries.slice(index + 1));
    return { entries: next, result: { entry, removed: true, position: index + 1 } };
  });
}

function queueClear(ctx) {
  const queue = loadQueue(ctx);
  return update(ctx, queue, (entries) => ({ entries: [], result: { removed: entries.length } }));
}

function parameters(ctx) {
  return (ctx.event && ctx.event.parameters) || {};
}

function entryParameter(ctx, queue) {
  const raw = parameters(ctx).entry;
  const entry = raw === null || raw === undefined ? "" : String(raw).trim();
  if (entry === "") {
    throw new Error(`queue: no entry given for ${queue.target}`);
  }
  if (entry.length > MAX_ENTRY_LENGTH) {
    throw new Error(`queue: an entry for ${queue.target} is ${entry.length} characters, over the ${MAX_ENTRY_LENGTH} allowed`);
  }
  return entry;
}

// The chosen queue and its settings. Refuses a target that is not a queue,
// since writing a list over another kind's value would corrupt it silently.
function loadQueue(ctx) {
  const target = parameters(ctx).target;
  if (typeof target !== "string" || target === "") {
    throw new Error("queue: no queue chosen");
  }
  const instance = ctx.resources.get(target);
  if (!instance) {
    throw new Error(`queue: ${target} does not exist — it may have been deleted`);
  }
  if (instance.kind !== "queue") {
    throw new Error(`queue: ${target} is a ${instance.kind}, not a queue`);
  }
  const settings = instance.settings || {};
  const capacity = numberOr(settings.capacity, 0);
  return {
    target,
    key: `state:${target}`,
    capacity: capacity >= 1 ? Math.min(MAX_ENTRIES, Math.floor(capacity)) : MAX_ENTRIES,
    allowDuplicates: settings.allowDuplicates === true,
    options: { clearOnSessionEnd: settings.lifetime === "session" },
  };
}

// Apply `change` to the entries until the write lands. `change` returns the new
// entries, what to report about them and, when the change is one workflows act
// on, the event to announce it as. The report gains the queue and its size after
// the change, which is what later workflow steps read, and is the event's data.
function update(ctx, queue, change) {
  let stored = ctx.storage.get(queue.key);
  for (let attempt = 0; attempt < MAX_ATTEMPTS; attempt++) {
    const entries = Array.isArray(stored) ? stored.map(String) : [];
    const changed = change(entries);
    const result = Object.assign({ target: queue.target }, changed.result, { size: changed.entries.length });
    if (changed.entries === entries) {
      return ctx.result(result, []);
    }
    const written = ctx.storage.compareAndSet(queue.key, stored === undefined ? null : stored, changed.entries, queue.options);
    if (written.swapped) {
      return ctx.result(result, changed.announce ? [{ type: changed.announce, data: result }] : []);
    }
    stored = written.current;
  }
  throw new Error(`queue: ${queue.target} changed ${MAX_ATTEMPTS} times while updating it`);
}

function numberOr(value, fallback) {
  const number = Number(value);
  return value === null || value === undefined || value === "" || !Number.isFinite(number) ? fallback : number;
}
