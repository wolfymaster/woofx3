// How far ahead of an ad `channel.ad_break.upcoming` is published. The Twitch
// module declares it as a setting, so a streamer changes it on the module's
// page rather than in the engine's deployment configuration.

import { errorMessage, type Logger } from "../../../host/deps";

/** The Twitch module's manifest id. Must match `id` in woofx3-modules' modules/platform/twitch/manifest.json. */
export const TWITCH_MODULE_ID = "woofx3_twitch";

/** Must match the setting's `id` and `defaultValue` in that manifest's `settings`. */
const AD_BREAK_LEAD_SETTING = "adBreakLeadSeconds";
export const DEFAULT_AD_BREAK_LEAD_SECONDS = 60;

export interface ModuleSettingsReader {
  listModuleSettings(moduleId: string): Promise<{ key: string; value: string }[]>;
}

/** The lead time a stored value asks for, or null when it is not positive whole seconds. */
export function parseAdBreakLeadSeconds(value: string): number | null {
  const trimmed = value.trim();
  if (!/^\d+$/.test(trimmed)) {
    return null;
  }
  const seconds = Number(trimmed);
  return seconds > 0 ? seconds : null;
}

/**
 * Reads the lead time from the Twitch module's settings. The default applies
 * when the module is not installed, the setting is empty or not positive
 * whole seconds, or db-proxy cannot be read: a heads-up at the default beats
 * none. It is read on every poll, so a rejected value or a read failure is
 * logged when it first appears rather than on every poll.
 */
export class AdBreakLeadSetting {
  private lastRejected: string | null = null;
  /** Set while the settings cannot be read, so the failure is warned once per outage, not every poll. */
  private unreadable = false;

  constructor(
    private readonly db: ModuleSettingsReader,
    private readonly logger: Logger
  ) {}

  async read(): Promise<number> {
    let settings: { key: string; value: string }[];
    try {
      settings = await this.db.listModuleSettings(TWITCH_MODULE_ID);
    } catch (err) {
      if (!this.unreadable) {
        this.logger.warn("Twitch module settings unreadable; using the default ad-break lead time", {
          error: errorMessage(err),
          defaultSeconds: DEFAULT_AD_BREAK_LEAD_SECONDS,
        });
      }
      this.unreadable = true;
      return DEFAULT_AD_BREAK_LEAD_SECONDS;
    }
    if (this.unreadable) {
      this.logger.info("Twitch module settings readable again");
    }
    this.unreadable = false;

    const raw = settings.find((setting) => setting.key === AD_BREAK_LEAD_SETTING)?.value.trim() ?? "";
    if (raw === "") {
      return DEFAULT_AD_BREAK_LEAD_SECONDS;
    }
    const seconds = parseAdBreakLeadSeconds(raw);
    if (seconds === null) {
      if (raw !== this.lastRejected) {
        this.logger.warn("Twitch module setting adBreakLeadSeconds is not positive whole seconds; using the default", {
          value: raw,
          defaultSeconds: DEFAULT_AD_BREAK_LEAD_SECONDS,
        });
      }
      this.lastRejected = raw;
      return DEFAULT_AD_BREAK_LEAD_SECONDS;
    }
    this.lastRejected = null;
    return seconds;
  }
}
