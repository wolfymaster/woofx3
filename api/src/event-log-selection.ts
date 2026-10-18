import type { EventLogSelection, EventLogSettings } from "@woofx3/api";
import type { SharedLogger } from "@woofx3/common/logging";
import type { DbClient } from "./db-client";
import type { EventCatalog, LoggedEvent } from "./event-catalog";

/** The engine setting that holds the streamer's `EventLogSelection`, as JSON. */
export const EVENT_LOG_SELECTION_SETTING = "eventLog.selection";

/**
 * Bounds on a stored selection. A streamer toggles types one at a time from a
 * list of installed events, so a list longer than this is not a selection.
 */
const MAX_SELECTION_TYPES = 500;
const MAX_EVENT_TYPE_LENGTH = 200;

const EMPTY_SELECTION: EventLogSelection = { shown: [], hidden: [] };

export type EventLogSettingsListener = (settings: EventLogSettings) => Promise<void> | void;

/**
 * The effective settings for one catalog and one selection. Exported for tests.
 *
 * The selection is applied within `offered` but kept whole, so a type naming an
 * uninstalled module's event has no effect until the module is back, and then
 * the streamer's choice for it holds again.
 */
export function computeEventLogSettings(
  catalog: ReadonlyMap<string, LoggedEvent>,
  selection: EventLogSelection
): EventLogSettings {
  const offered = [...catalog.keys()].sort();
  const defaults = offered.filter((subject) => catalog.get(subject)?.onByDefault === true);
  const shown = new Set(selection.shown);
  const hidden = new Set(selection.hidden);
  const enabled = offered.filter(
    (subject) => (catalog.get(subject)?.onByDefault === true || shown.has(subject)) && !hidden.has(subject)
  );
  return {
    selection: { shown: [...selection.shown], hidden: [...selection.hidden] },
    defaults,
    offered,
    enabled,
  };
}

/**
 * A selection as a client sent it, checked and with duplicates dropped, in the
 * order given. Throws on anything that is not a selection; types outside
 * `offered` are not an error. Exported for tests.
 */
export function readEventLogSelection(input: unknown): EventLogSelection {
  if (typeof input !== "object" || input === null || Array.isArray(input)) {
    throw new Error("selection must be an object with shown and hidden lists");
  }
  const { shown, hidden } = input as Record<string, unknown>;
  return { shown: readTypes("shown", shown), hidden: readTypes("hidden", hidden) };
}

function readTypes(name: string, value: unknown): string[] {
  if (!Array.isArray(value)) {
    throw new Error(`selection.${name} must be a list of event types`);
  }
  const types = [...new Set(value)];
  if (types.length > MAX_SELECTION_TYPES) {
    throw new Error(`selection.${name} names more than ${MAX_SELECTION_TYPES} event types`);
  }
  for (const type of types) {
    if (typeof type !== "string" || type.length === 0 || type.length > MAX_EVENT_TYPE_LENGTH) {
      throw new Error(`selection.${name} must hold event types of 1 to ${MAX_EVENT_TYPE_LENGTH} characters`);
    }
  }
  return types as string[];
}

export interface EventLogSelectionSourceOptions {
  minBackoffMs?: number;
  maxBackoffMs?: number;
}

/**
 * The streamer's event-type selection, kept in the engine's settings, applied
 * to the current `EventCatalog`: which types the event log records and the
 * Events widget shows.
 *
 * Listeners hear the new settings whenever either side changes: a module
 * installed or removed, or a new selection saved. Until the stored selection
 * has been read the selection is empty, so the defaults apply; a failed read
 * is retried with backoff, as the catalog's is.
 */
export class EventLogSelectionSource {
  private selection: EventLogSelection = EMPTY_SELECTION;
  private current: EventLogSettings;
  private listeners: EventLogSettingsListener[] = [];
  /** Set once a selection is known, read or saved; a late read must not undo a save. */
  private settled = false;
  private retryTimer: ReturnType<typeof setTimeout> | null = null;
  private saving: Promise<unknown> = Promise.resolve();
  private backoffMs: number;
  private readonly minBackoffMs: number;
  private readonly maxBackoffMs: number;

  constructor(
    private catalog: EventCatalog,
    private db: Pick<DbClient, "getSetting" | "setSetting">,
    private logger: SharedLogger,
    options: EventLogSelectionSourceOptions = {}
  ) {
    this.minBackoffMs = options.minBackoffMs ?? 1_000;
    this.maxBackoffMs = options.maxBackoffMs ?? 30_000;
    this.backoffMs = this.minBackoffMs;
    this.current = computeEventLogSettings(catalog.events, this.selection);
    catalog.onChange(() => this.publish());
  }

  get settings(): EventLogSettings {
    return this.current;
  }

  /** Called with the new settings each time they are recomputed. A listener that throws is logged and skipped. */
  onChange(listener: EventLogSettingsListener): void {
    this.listeners.push(listener);
  }

  /** Reads the stored selection once, retrying in the background when that fails. */
  async start(): Promise<void> {
    await this.load();
  }

  stop(): void {
    if (this.retryTimer !== null) {
      clearTimeout(this.retryTimer);
    }
    this.retryTimer = null;
  }

  /**
   * Store a new selection and apply it before returning, so a type turned on
   * is recorded from the moment the call resolves. Throws when the selection
   * is malformed or the write fails; the previous selection then stays.
   */
  async setSelection(input: unknown): Promise<EventLogSettings> {
    const selection = readEventLogSelection(input);
    // One save at a time, so the selection applied is the one stored last.
    const saved = this.saving.then(async () => {
      await this.db.setSetting(EVENT_LOG_SELECTION_SETTING, JSON.stringify(selection));
      this.settled = true;
      this.stop();
      this.selection = selection;
      await this.publish();
      return this.current;
    });
    this.saving = saved.catch(() => {});
    return saved;
  }

  private async load(): Promise<void> {
    let raw: string | null;
    try {
      raw = await this.db.getSetting(EVENT_LOG_SELECTION_SETTING);
    } catch (err) {
      this.logger.warn("EventLogSelectionSource: reading the selection failed; retrying", {
        retryInMs: this.backoffMs,
        error: err instanceof Error ? err.message : String(err),
      });
      this.scheduleRetry();
      return;
    }
    if (this.settled) {
      return;
    }
    this.settled = true;
    this.selection = this.parseStored(raw);
    await this.publish();
  }

  /**
   * A stored selection that no longer parses is logged and read as empty, so
   * the defaults apply rather than nothing being logged at all.
   */
  private parseStored(raw: string | null): EventLogSelection {
    if (raw === null || raw === "") {
      return EMPTY_SELECTION;
    }
    try {
      return readEventLogSelection(JSON.parse(raw));
    } catch (err) {
      this.logger.error("EventLogSelectionSource: stored selection is unreadable; using the defaults", {
        error: err instanceof Error ? err.message : String(err),
      });
      return EMPTY_SELECTION;
    }
  }

  private scheduleRetry(): void {
    if (this.retryTimer !== null) {
      return;
    }
    const delay = this.backoffMs;
    this.backoffMs = Math.min(this.backoffMs * 2, this.maxBackoffMs);
    this.retryTimer = setTimeout(() => {
      this.retryTimer = null;
      void this.load();
    }, delay);
    this.retryTimer.unref?.();
  }

  private async publish(): Promise<void> {
    this.current = computeEventLogSettings(this.catalog.events, this.selection);
    for (const listener of this.listeners) {
      try {
        await listener(this.current);
      } catch (err) {
        this.logger.error("EventLogSelectionSource: listener failed", {
          error: err instanceof Error ? err.message : String(err),
        });
      }
    }
  }
}
