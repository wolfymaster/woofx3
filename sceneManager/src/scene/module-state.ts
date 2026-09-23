import type { Logger } from "@woofx3/common/runtime";

/**
 * Module storage as a scene's widgets see it through `host.storage`.
 *
 * A widget reads its own module's storage: the page asks for a key once, and
 * every later change to it arrives on the scene's event stream. Only the keys
 * some page of a scene has asked for are pushed to that scene, so opening a
 * scene does not stream every module's storage to it.
 *
 * A resource instance keeps its value at `state:<canonicalId>`, and one that
 * nothing has written yet, or whose session-scoped value was cleared, holds
 * nothing. It still has a value, the one its owning module reads it as, and a
 * widget showing it has no way to know that value. So an empty `state:` key is
 * answered with the instance's empty reading (see `emptyResourceState`) rather
 * than with `null`.
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

/**
 * What a resource instance holds before anything writes it, or `null` for a
 * kind this does not know.
 *
 * Owned by the module that declares the kind, not by the engine, which never
 * learns what a kind means. Repeated here because a widget cannot read the
 * instance's settings, and the rule must match the module's own:
 * `readState` in modules/woofx3/functions/counter.js.
 */
export function emptyResourceState(moduleId: string, kind: string, settings: Record<string, unknown>): unknown {
  if (moduleId === "woofx3" && kind === "counter") {
    return { value: numberOr(settings.initialValue, 0), reached: {} };
  }
  return null;
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

    const stored = await this.db.getModuleStorageValue(applicationId, moduleId, key);
    return this.orEmptyReading(moduleId, key, stored);
  }

  /** A change announced on the bus, pushed to every connected scene watching it. */
  async publish(moduleId: string, key: string, value: unknown): Promise<void> {
    const sceneIds = this.scenes.connectedSceneIds().filter((sceneId) => {
      return this.watched.get(sceneId)?.get(moduleId)?.has(key) ?? false;
    });
    if (sceneIds.length === 0) {
      return;
    }
    const frame: ModuleStateFrame = { moduleId, key, value: await this.orEmptyReading(moduleId, key, value) };
    for (const sceneId of sceneIds) {
      this.scenes.broadcast(sceneId, MODULE_STATE_EVENT, frame);
    }
  }

  private async orEmptyReading(moduleId: string, key: string, value: unknown): Promise<unknown> {
    if (value !== null && value !== undefined) {
      return value;
    }
    if (!key.startsWith(RESOURCE_STATE_PREFIX)) {
      return null;
    }
    const canonicalId = key.slice(RESOURCE_STATE_PREFIX.length);
    // A module's storage holds only its own instances' values; the owning
    // module is the canonical id's first segment.
    if (canonicalId.split(":")[0] !== moduleId) {
      return null;
    }
    let instance: Awaited<ReturnType<ModuleStateDb["getResourceInstance"]>>;
    try {
      instance = await this.db.getResourceInstance(canonicalId);
    } catch (err) {
      this.logger.warn("module state: resource instance lookup failed; reading it as empty", {
        canonicalId,
        error: err instanceof Error ? err.message : String(err),
      });
      return null;
    }
    if (!instance) {
      return null;
    }
    return emptyResourceState(moduleId, instance.kind, parseSettings(instance.settingsJson));
  }
}
