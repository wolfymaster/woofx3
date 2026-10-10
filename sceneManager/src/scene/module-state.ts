import type { Logger } from "@woofx3/common/runtime";

/**
 * Module storage as a scene's widgets see it through `host.storage`.
 *
 * A widget reads its own module's storage: the page asks for a key once, and
 * every later change to it arrives on the scene's event stream. Only the keys
 * some page of a scene has asked for are pushed to that scene, so opening a
 * scene does not stream every module's storage to it.
 *
 * A resource instance keeps its value at `state:<canonicalId>` in its owning
 * module's storage, and that key reads as exactly what is stored, for every
 * kind. What a value means can also depend on the instance's settings (a
 * counter's starting value and goals, how long a timer runs), and a widget
 * sees only its own settings, never the instance's. So the instance as a
 * whole reads at `resource:<canonicalId>`, as a `ResourceReading`: what it
 * stores, its settings, and when it was read. Making sense of that is the
 * widget's own business, as it is the module's functions': the engine never
 * learns what a kind means.
 *
 * A module's `list` settings are its own widgets' to read too, at
 * `setting:<settingId>`: the rows a streamer keeps in the module's settings,
 * like the entries on a wheel, which the module's functions read and change
 * and its widget shows. They are answered from the settings, never from
 * storage, and pushed again whenever db-proxy announces the setting written.
 * Only `list` settings are served; any other reads as nothing, so a secret or
 * a url setting never reaches a page.
 */

/** The slice of DbClient this depends on (injectable for tests). */
export interface ModuleStateDb {
  getModuleStorageValue(namespace: string, key: string): Promise<unknown>;
  getResourceInstance(canonicalId: string): Promise<{ settingsJson: string } | null>;
  listModuleSettings(moduleId: string): Promise<{ key: string; value: string; valueType: string }[]>;
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
const RESOURCE_PREFIX = "resource:";
const MODULE_SETTING_PREFIX = "setting:";
/** The only setting type served to widgets (see the note at the top). */
const LIST_SETTING = "list";

/**
 * A `list` setting's rows as its widget reads them: the stored JSON array,
 * keeping only rows that are objects. `null` when the module has no such
 * list setting.
 */
export function listSettingRows(
  settings: { key: string; value: string; valueType: string }[],
  settingId: string
): Record<string, unknown>[] | null {
  const setting = settings.find((s) => s.key === settingId);
  if (!setting || setting.valueType !== LIST_SETTING) {
    return null;
  }
  let parsed: unknown;
  try {
    parsed = JSON.parse(setting.value || "[]");
  } catch {
    return [];
  }
  if (!Array.isArray(parsed)) {
    return [];
  }
  return parsed.filter(
    (row): row is Record<string, unknown> => row !== null && typeof row === "object" && !Array.isArray(row)
  );
}

/**
 * A resource instance as a widget reads it at `resource:<canonicalId>`.
 * `readAt` is this host's clock at the moment of reading, so a widget can
 * measure a stored time (a timer's end) against it and count on from its own
 * clock, without the two clocks having to agree.
 */
export interface ResourceReading {
  value: unknown;
  settings: Record<string, unknown>;
  readAt: number;
}

function parseSettings(settingsJson: string): Record<string, unknown> {
  try {
    const parsed = JSON.parse(settingsJson || "{}");
    return parsed && typeof parsed === "object" && !Array.isArray(parsed) ? (parsed as Record<string, unknown>) : {};
  } catch {
    return {};
  }
}

/** The canonical id a resource key names, or null for a key that names none. */
export function resourceKeyInstance(key: string): string | null {
  for (const prefix of [RESOURCE_STATE_PREFIX, RESOURCE_PREFIX]) {
    if (key.startsWith(prefix)) {
      return key.slice(prefix.length);
    }
  }
  return null;
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
 * unless the key is a resource instance the module's settings link (its
 * `state:` or `resource:` key), which lives in the instance owner's storage.
 *
 * Checked against the settings at every read, so a widget can never name its
 * way into another module's storage: an instance its module does not link
 * reads from its own storage, where nothing is.
 */
export async function storageModuleFor(db: LinkedResourcesDb, moduleId: string, key: string): Promise<string> {
  const canonicalId = resourceKeyInstance(key);
  if (canonicalId === null) {
    return moduleId;
  }
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
    private readonly logger: Logger,
    private readonly now: () => number = Date.now
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

    if (key.startsWith(MODULE_SETTING_PREFIX)) {
      return this.settingReading(moduleId, key);
    }
    if (key.startsWith(RESOURCE_PREFIX)) {
      return this.resourceReading(moduleId, key.slice(RESOURCE_PREFIX.length));
    }
    return (await this.db.getModuleStorageValue(moduleId, key)) ?? null;
  }

  /**
   * A change announced on the bus, pushed to every connected scene watching
   * the key, and, for an instance's value, to every one watching the instance.
   */
  async publish(moduleId: string, key: string, value: unknown): Promise<void> {
    // `setting:` and `resource:` keys are not storage: a storage write that
    // happens to use either prefix changes nothing a widget reads.
    if (key.startsWith(MODULE_SETTING_PREFIX) || key.startsWith(RESOURCE_PREFIX)) {
      return;
    }
    this.push(moduleId, key, this.watchingScenes(moduleId, key), value ?? null);
    if (!key.startsWith(RESOURCE_STATE_PREFIX)) {
      return;
    }
    const canonicalId = key.slice(RESOURCE_STATE_PREFIX.length);
    const instanceKey = `${RESOURCE_PREFIX}${canonicalId}`;
    const watching = this.watchingScenes(moduleId, instanceKey);
    if (watching.length === 0) {
      return;
    }
    let reading: ResourceReading | null;
    try {
      reading = await this.resourceReading(moduleId, canonicalId, value ?? null);
    } catch (err) {
      this.logger.warn("module state: instance lookup for a changed value failed", {
        canonicalId,
        error: err instanceof Error ? err.message : String(err),
      });
      return;
    }
    this.push(moduleId, instanceKey, watching, reading);
  }

  /**
   * A resource instance's settings changed. Its value is unchanged, so only
   * scenes watching the instance as a whole are sent it again.
   */
  async resourceUpdated(canonicalId: string): Promise<void> {
    const moduleId = canonicalId.split(":")[0] ?? "";
    const key = `${RESOURCE_PREFIX}${canonicalId}`;
    const watching = this.watchingScenes(moduleId, key);
    if (watching.length === 0) {
      return;
    }
    let reading: ResourceReading | null;
    try {
      reading = await this.resourceReading(moduleId, canonicalId);
    } catch (err) {
      this.logger.warn("module state: re-read after a settings change failed", {
        canonicalId,
        error: err instanceof Error ? err.message : String(err),
      });
      return;
    }
    this.push(moduleId, key, watching, reading);
  }

  /**
   * One of a module's settings was written. Read it again for each connected
   * scene watching it and push it. Only a widget of the module itself reads
   * its settings, so there is no other module to push it as.
   */
  async settingUpdated(moduleId: string, settingId: string): Promise<void> {
    const key = `${MODULE_SETTING_PREFIX}${settingId}`;
    const watching = this.watchingScenes(moduleId, key);
    if (watching.length === 0) {
      return;
    }
    let reading: unknown;
    try {
      reading = await this.settingReading(moduleId, key);
    } catch (err) {
      this.logger.warn("module state: re-read of a changed setting failed", {
        moduleId,
        settingId,
        error: err instanceof Error ? err.message : String(err),
      });
      return;
    }
    for (const { sceneId } of watching) {
      const frame: ModuleStateFrame = { moduleId, key, value: reading };
      this.scenes.broadcast(sceneId, MODULE_STATE_EVENT, frame);
    }
  }

  private async settingReading(moduleId: string, key: string): Promise<unknown> {
    const settings = await this.db.listModuleSettings(moduleId);
    return listSettingRows(settings, key.slice(MODULE_SETTING_PREFIX.length));
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

  private push(
    moduleId: string,
    key: string,
    watching: { sceneId: string; readAs: Set<string> }[],
    value: unknown
  ): void {
    for (const { sceneId, readAs } of watching) {
      for (const as of readAs) {
        const frame: ModuleStateFrame = { moduleId: as, key, value };
        this.scenes.broadcast(sceneId, MODULE_STATE_EVENT, frame);
      }
    }
  }

  /**
   * An instance as a whole, read from `moduleId`'s storage, or null when that
   * module does not own it or it does not exist. `stored` is its value when
   * the caller already has it, as a change announced on the bus carries it.
   */
  private async resourceReading(
    moduleId: string,
    canonicalId: string,
    stored?: unknown
  ): Promise<ResourceReading | null> {
    // A module's storage holds only its own instances' values; the owning
    // module is the canonical id's first segment.
    if (canonicalId.split(":")[0] !== moduleId) {
      return null;
    }
    const instance = await this.db.getResourceInstance(canonicalId);
    if (!instance) {
      return null;
    }
    const value =
      stored === undefined
        ? await this.db.getModuleStorageValue(moduleId, `${RESOURCE_STATE_PREFIX}${canonicalId}`)
        : stored;
    return { value: value ?? null, settings: parseSettings(instance.settingsJson), readAt: this.now() };
  }
}
