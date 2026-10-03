import type { Logger } from "@woofx3/common/runtime";

/**
 * Module storage as a scene's widgets see it through `host.storage`.
 *
 * A widget reads its own module's storage: the page asks for a key once, and
 * every later change to it arrives on the scene's event stream. Only the keys
 * some page of a scene has asked for are pushed to that scene, so opening a
 * scene does not stream every module's storage to it.
 *
 * A resource instance keeps its value at `state:<canonicalId>`, but what it
 * stores is not all a widget showing it needs. A counter nothing has written
 * yet, or whose session-scoped value was cleared, stores nothing and still
 * reads as its starting value; and its goals live in its settings, not in
 * storage. A timer nothing has started stores nothing either, and how long it
 * runs is also a setting. A widget sees only its own settings, never the
 * instance's, so a `state:` key of a kind this knows is answered with the
 * instance's reading (see `resourceReading`) rather than with what is stored.
 */

/** The slice of DbClient this depends on (injectable for tests). */
export interface ModuleStateDb {
  getModuleStorageValue(namespace: string, key: string): Promise<unknown>;
  getResourceInstance(canonicalId: string): Promise<{ kind: string; settingsJson: string } | null>;
}

/** Where changes are pushed: the scenes with an open event stream. `DeliveryStore` implements it. */
export interface ModuleStateScenes {
  connectedSceneIds(): string[];
  broadcast(sceneId: string, event: string, data: unknown): void;
}

/** SSE event name of a pushed change. Must match `parseSseChunk` in public/scene-manager/event-source.ts. */
export const MODULE_STATE_EVENT = "module-state";

export interface ModuleStateFrame {
  moduleId: string;
  key: string;
  value: unknown;
}

const RESOURCE_STATE_PREFIX = "state:";

export interface CounterGoal {
  value: number;
  /** "" when the goal has no name. */
  name: string;
}

/** A woofx3 counter as a widget reads it. */
export interface CounterReading {
  value: number;
  /** Goal number -> when the counter first reached it, in epoch ms. */
  reached: Record<string, number>;
  /** Smallest first, one per number. */
  goals: CounterGoal[];
}

/**
 * A woofx3 timer as a widget reads it: a point to sync to, sent only when the
 * timer changes. A running one's time left is measured as it is sent, so the
 * widget counts down from when it arrives on its own clock and never needs to
 * agree with this one.
 */
export interface TimerReading {
  running: boolean;
  /** Time left as of this reading. */
  remainingMs: number;
  /** What it counts down from, and what Reset goes back to. */
  durationMs: number;
}

/**
 * What a resource instance reads as, from what it stores and its settings, or
 * the stored value unchanged for a kind this does not know.
 *
 * Owned by the module that declares the kind, not by the engine, which never
 * learns what a kind means. Repeated here because a widget cannot read the
 * instance's settings, and the rules must match the module's own: `readState`
 * and `parseGoals` in modules/woofx3/functions/counter.js, and `readTimer` and
 * `timerFromInstance` in modules/woofx3/functions/timer.js.
 */
export function resourceReading(
  moduleId: string,
  kind: string,
  settings: Record<string, unknown>,
  stored: unknown,
  now: number = Date.now()
): unknown {
  if (moduleId === "woofx3" && kind === "counter") {
    return counterReading(settings, stored);
  }
  if (moduleId === "woofx3" && kind === "timer") {
    return timerReading(settings, stored, now);
  }
  return stored ?? null;
}

function counterReading(settings: Record<string, unknown>, stored: unknown): CounterReading {
  const initial = numberOr(settings.initialValue, 0);
  const goals = parseGoals(settings.goals);
  if (stored === null || stored === undefined) {
    return { value: initial, reached: {}, goals };
  }
  if (typeof stored === "object" && !Array.isArray(stored)) {
    const state = stored as { value?: unknown; reached?: unknown };
    const reached =
      state.reached !== null && typeof state.reached === "object" && !Array.isArray(state.reached)
        ? (state.reached as Record<string, number>)
        : {};
    return { value: numberOr(state.value, initial), reached, goals };
  }
  // Written before counters carried goals.
  return { value: numberOr(stored, initial), reached: {}, goals };
}

// The latest moment a Date can hold: a timer has no limit of its own, this
// only keeps a corrupt value from reading as an impossible time.
const MAX_DATE_MS = 8.64e15;

function timerReading(settings: Record<string, unknown>, stored: unknown, now: number): TimerReading {
  const durationMs = clampTimerMs(numberOr(settings.duration, 300) * 1000);
  if (stored === null || typeof stored !== "object" || Array.isArray(stored)) {
    return { running: false, remainingMs: durationMs, durationMs };
  }
  const state = stored as { running?: unknown; endsAt?: unknown; remainingMs?: unknown };
  if (state.running === true) {
    return { running: true, remainingMs: clampTimerMs(numberOr(state.endsAt, 0) - now), durationMs };
  }
  return { running: false, remainingMs: clampTimerMs(numberOr(state.remainingMs, 0)), durationMs };
}

function clampTimerMs(ms: number): number {
  return Math.min(MAX_DATE_MS, Math.max(0, Math.round(ms)));
}

function parseGoals(raw: unknown): CounterGoal[] {
  const rows: unknown = typeof raw === "string" ? raw.split(",").map((part) => ({ value: part })) : raw;
  if (!Array.isArray(rows)) {
    return [];
  }
  const goals: CounterGoal[] = [];
  for (const row of rows) {
    if (row === null || typeof row !== "object") {
      continue;
    }
    const { value: rawValue, name: rawName } = row as { value?: unknown; name?: unknown };
    const text = typeof rawValue === "string" ? rawValue.trim() : rawValue;
    const value = Number(text);
    if (text === "" || text === null || text === undefined || !Number.isFinite(value)) {
      continue;
    }
    const name = typeof rawName === "string" ? rawName.trim() : "";
    const existing = goals.find((goal) => goal.value === value);
    if (!existing) {
      goals.push({ value, name });
    } else if (existing.name === "") {
      existing.name = name;
    }
  }
  return goals.sort((a, b) => a.value - b.value);
}

function numberOr(value: unknown, fallback: number): number {
  const number = Number(value);
  return value === null || value === undefined || value === "" || !Number.isFinite(number) ? fallback : number;
}

function parseSettings(settingsJson: string): Record<string, unknown> {
  try {
    const parsed = JSON.parse(settingsJson || "{}");
    return parsed && typeof parsed === "object" && !Array.isArray(parsed) ? (parsed as Record<string, unknown>) : {};
  } catch {
    return {};
  }
}

/** The slice of DbClient `storageModuleFor` needs (injectable for tests). */
export interface LinkedResourcesDb {
  listModuleSettings(moduleId: string): Promise<{ key: string; value: string; valueType: string }[]>;
}

/** The setting type whose value is a linked resource instance's canonical id. */
const RESOURCE_REF_SETTING = "resource_ref";

/**
 * The canonical ids a module's settings link: the values of its
 * `resource_ref` settings, keyed by setting id. What a widget of the module
 * may read beyond its own module's storage, and what its boot payload hands
 * it so it knows which keys to ask for.
 */
export async function linkedResources(db: LinkedResourcesDb, moduleId: string): Promise<Record<string, string>> {
  const linked: Record<string, string> = {};
  for (const setting of await db.listModuleSettings(moduleId)) {
    const value = setting.value.trim();
    if (setting.valueType === RESOURCE_REF_SETTING && value !== "") {
      linked[setting.key] = value;
    }
  }
  return linked;
}

/**
 * Whose storage a widget of `moduleId` reads `key` from: its own module's,
 * unless the key is the value of a resource instance the module's settings
 * link, which lives in the instance owner's storage.
 *
 * Checked against the settings at every read, so a widget can never name its
 * way into another module's storage: an instance its module does not link
 * reads from its own storage, where nothing is.
 */
export async function storageModuleFor(db: LinkedResourcesDb, moduleId: string, key: string): Promise<string> {
  if (!key.startsWith(RESOURCE_STATE_PREFIX)) {
    return moduleId;
  }
  const canonicalId = key.slice(RESOURCE_STATE_PREFIX.length);
  const owner = canonicalId.split(":")[0] ?? "";
  if (owner === "" || owner === moduleId) {
    return moduleId;
  }
  const linked = await linkedResources(db, moduleId);
  return Object.values(linked).includes(canonicalId) ? owner : moduleId;
}

export class ModuleStateWatch {
  /**
   * sceneId -> the module whose storage is read -> key -> the modules the
   * scene's widgets read it as. A widget reads its own module's storage, so
   * the two are the same, except for an instance its module links (see
   * `storageModuleFor`): that is read from the instance's owner and pushed
   * to the page as the widget's module, which is all the page knows it by.
   */
  private readonly watched = new Map<string, Map<string, Map<string, Set<string>>>>();

  constructor(
    private readonly db: ModuleStateDb,
    private readonly scenes: ModuleStateScenes,
    private readonly logger: Logger
  ) {}

  /**
   * The current value of `key` in `moduleId`'s storage, pushing every later
   * change to `sceneId`.
   *
   * Watched before it is read, so a change landing between the two is pushed
   * rather than lost; the page settles which of the two answers is newer.
   *
   * What a scene watches is kept until the process exits. It is bounded by the
   * keys the scene's widgets ask for, and a page that reconnects asks again
   * anyway, to catch up on what changed while it was away.
   */
  async read(sceneId: string, moduleId: string, key: string, readAs: string = moduleId): Promise<unknown> {
    let byModule = this.watched.get(sceneId);
    if (!byModule) {
      byModule = new Map();
      this.watched.set(sceneId, byModule);
    }
    let keys = byModule.get(moduleId);
    if (!keys) {
      keys = new Map();
      byModule.set(moduleId, keys);
    }
    let as = keys.get(key);
    if (!as) {
      as = new Set();
      keys.set(key, as);
    }
    as.add(readAs);

    const stored = await this.db.getModuleStorageValue(moduleId, key);
    return this.reading(moduleId, key, stored);
  }

  /** A change announced on the bus, pushed to every connected scene watching it. */
  async publish(moduleId: string, key: string, value: unknown): Promise<void> {
    const watching = this.watchingScenes(moduleId, key);
    if (watching.length === 0) {
      return;
    }
    const reading = await this.reading(moduleId, key, value);
    for (const { sceneId, readAs } of watching) {
      for (const as of readAs) {
        const frame: ModuleStateFrame = { moduleId: as, key, value: reading };
        this.scenes.broadcast(sceneId, MODULE_STATE_EVENT, frame);
      }
    }
  }

  /**
   * A resource instance's settings changed, which can change what its value
   * reads as (a counter's goals, its starting value) without its storage
   * changing. Read it again for each connected scene watching it and push it.
   */
  async resourceUpdated(canonicalId: string): Promise<void> {
    const moduleId = canonicalId.split(":")[0] ?? "";
    const key = `${RESOURCE_STATE_PREFIX}${canonicalId}`;
    for (const { sceneId, readAs } of this.watchingScenes(moduleId, key)) {
      let stored: unknown;
      try {
        stored = await this.db.getModuleStorageValue(moduleId, key);
      } catch (err) {
        this.logger.warn("module state: re-read after a settings change failed", {
          sceneId,
          canonicalId,
          error: err instanceof Error ? err.message : String(err),
        });
        continue;
      }
      const reading = await this.reading(moduleId, key, stored);
      for (const as of readAs) {
        const frame: ModuleStateFrame = { moduleId: as, key, value: reading };
        this.scenes.broadcast(sceneId, MODULE_STATE_EVENT, frame);
      }
    }
  }

  private watchingScenes(moduleId: string, key: string): { sceneId: string; readAs: Set<string> }[] {
    const watching: { sceneId: string; readAs: Set<string> }[] = [];
    for (const sceneId of this.scenes.connectedSceneIds()) {
      const readAs = this.watched.get(sceneId)?.get(moduleId)?.get(key);
      if (readAs && readAs.size > 0) {
        watching.push({ sceneId, readAs });
      }
    }
    return watching;
  }

  private async reading(moduleId: string, key: string, stored: unknown): Promise<unknown> {
    const raw = stored ?? null;
    if (!key.startsWith(RESOURCE_STATE_PREFIX)) {
      return raw;
    }
    const canonicalId = key.slice(RESOURCE_STATE_PREFIX.length);
    // A module's storage holds only its own instances' values; the owning
    // module is the canonical id's first segment.
    if (canonicalId.split(":")[0] !== moduleId) {
      return raw;
    }
    let instance: Awaited<ReturnType<ModuleStateDb["getResourceInstance"]>>;
    try {
      instance = await this.db.getResourceInstance(canonicalId);
    } catch (err) {
      this.logger.warn("module state: resource instance lookup failed; serving the stored value as is", {
        canonicalId,
        error: err instanceof Error ? err.message : String(err),
      });
      return raw;
    }
    if (!instance) {
      return raw;
    }
    return resourceReading(moduleId, instance.kind, parseSettings(instance.settingsJson), raw);
  }
}
