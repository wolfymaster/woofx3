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
 * storage. A widget sees only its own settings, never the instance's, so a
 * `state:` key of a kind this knows is answered with the instance's reading
 * (see `resourceReading`) rather than with what is stored.
 */

/** The slice of DbClient this depends on (injectable for tests). */
export interface ModuleStateDb {
  getModuleStorageValue(applicationId: string, namespace: string, key: string): Promise<unknown>;
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
 * What a resource instance reads as, from what it stores and its settings, or
 * the stored value unchanged for a kind this does not know.
 *
 * Owned by the module that declares the kind, not by the engine, which never
 * learns what a kind means. Repeated here because a widget cannot read the
 * instance's settings, and the rules must match the module's own: `readState`
 * and `parseGoals` in modules/woofx3/functions/counter.js.
 */
export function resourceReading(
  moduleId: string,
  kind: string,
  settings: Record<string, unknown>,
  stored: unknown
): unknown {
  if (moduleId === "woofx3" && kind === "counter") {
    return counterReading(settings, stored);
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

export class ModuleStateWatch {
  /** sceneId -> moduleId -> keys some page of that scene has asked for. */
  private readonly watched = new Map<string, Map<string, Set<string>>>();
  /** sceneId -> the application its session belongs to, for reading storage again on its behalf. */
  private readonly applications = new Map<string, string>();

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
  async read(sceneId: string, applicationId: string, moduleId: string, key: string): Promise<unknown> {
    let byModule = this.watched.get(sceneId);
    if (!byModule) {
      byModule = new Map();
      this.watched.set(sceneId, byModule);
    }
    let keys = byModule.get(moduleId);
    if (!keys) {
      keys = new Set();
      byModule.set(moduleId, keys);
    }
    keys.add(key);
    this.applications.set(sceneId, applicationId);

    const stored = await this.db.getModuleStorageValue(applicationId, moduleId, key);
    return this.reading(moduleId, key, stored);
  }

  /** A change announced on the bus, pushed to every connected scene watching it. */
  async publish(moduleId: string, key: string, value: unknown): Promise<void> {
    const sceneIds = this.watchingScenes(moduleId, key);
    if (sceneIds.length === 0) {
      return;
    }
    const frame: ModuleStateFrame = { moduleId, key, value: await this.reading(moduleId, key, value) };
    for (const sceneId of sceneIds) {
      this.scenes.broadcast(sceneId, MODULE_STATE_EVENT, frame);
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
    for (const sceneId of this.watchingScenes(moduleId, key)) {
      const applicationId = this.applications.get(sceneId);
      if (applicationId === undefined) {
        continue;
      }
      let stored: unknown;
      try {
        stored = await this.db.getModuleStorageValue(applicationId, moduleId, key);
      } catch (err) {
        this.logger.warn("module state: re-read after a settings change failed", {
          sceneId,
          canonicalId,
          error: err instanceof Error ? err.message : String(err),
        });
        continue;
      }
      const frame: ModuleStateFrame = { moduleId, key, value: await this.reading(moduleId, key, stored) };
      this.scenes.broadcast(sceneId, MODULE_STATE_EVENT, frame);
    }
  }

  private watchingScenes(moduleId: string, key: string): string[] {
    return this.scenes.connectedSceneIds().filter((sceneId) => {
      return this.watched.get(sceneId)?.get(moduleId)?.has(key) ?? false;
    });
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
