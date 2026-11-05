import {
  DEFAULT_MODERATION_CONFIG,
  MODERATION_CONFIG_SETTING_KEY,
  MODERATION_SUBJECTS,
  type ModerationConfig,
  parseModerationConfig,
} from "@woofx3/api/moderation-config";
import { errorMessage, type Logger } from "../host/deps";
import type { LinkStore } from "../host/link-readers";
import type { ScopedBus } from "../host/scoped-bus";

export interface ModerationConfigStoreDeps {
  settings: Pick<LinkStore, "getSetting">;
  bus: Pick<ScopedBus, "subscribe">;
  logger: Logger;
}

/**
 * The moderation config the engine runs, read from the setting
 * `moderation.config` at start and again on each `moderation.config.updated`.
 * A stored config that does not parse is logged and runs as the default,
 * moderation off, rather than half-applied. A failed read keeps the config
 * already held.
 */
export class ModerationConfigStore {
  private config: ModerationConfig = DEFAULT_MODERATION_CONFIG;
  /** Bumped per reload, so a slow read that finishes after a newer one is dropped. */
  private generation = 0;

  constructor(private readonly deps: ModerationConfigStoreDeps) {}

  /** The config now. Never mutated: a reload replaces it, so a caller's snapshot stays whole. */
  current(): ModerationConfig {
    return this.config;
  }

  /** Reads the config, then follows updates. Throws when the first read fails. */
  async start(): Promise<void> {
    await this.load();
    await this.deps.bus.subscribe(MODERATION_SUBJECTS.configUpdated, async () => {
      try {
        await this.load();
      } catch (error) {
        this.deps.logger.error("could not reload the moderation config; keeping the one held", {
          error: errorMessage(error),
        });
      }
    });
  }

  async load(): Promise<void> {
    const generation = ++this.generation;
    const stored = await this.deps.settings.getSetting(MODERATION_CONFIG_SETTING_KEY);
    if (generation !== this.generation) {
      return;
    }
    this.config = this.read(stored);
  }

  private read(stored: string | null): ModerationConfig {
    if (stored === null || stored === "") {
      return DEFAULT_MODERATION_CONFIG;
    }
    let raw: unknown;
    try {
      raw = JSON.parse(stored);
    } catch {
      this.deps.logger.error("the stored moderation config is not JSON; moderation is off until it is saved again");
      return DEFAULT_MODERATION_CONFIG;
    }
    const parsed = parseModerationConfig(raw);
    if (!parsed.ok) {
      this.deps.logger.error("the stored moderation config is invalid; moderation is off until it is saved again", {
        problem: parsed.error,
      });
      return DEFAULT_MODERATION_CONFIG;
    }
    return Object.freeze(parsed.value);
  }
}
