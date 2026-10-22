import {
  type IntegrationEnabled,
  type IntegrationId,
  integrationEnabledSettingKey,
  parseIntegrationEnabled,
  resolveEnabled,
} from "@woofx3/common/integrations/integration-settings";
import { ADAPTER_IDS, type AdapterId } from "./adapter-ids";

/** What an adapter's `desired` decides from. */
export interface LinkState {
  /** Its credential or target is in place. */
  connected: boolean;
  /** It should run when connected. */
  enabled: boolean;
}

/** A link state plus how its enabled flag was read, so the watcher can report a missing or bad flag. */
export interface LinkReading extends LinkState {
  flag: IntegrationEnabled;
}

/** Engine settings, read through db-proxy. A missing setting reads as null. */
export interface SettingsReader {
  getSetting(key: string): Promise<string | null>;
}

export interface LinkReader {
  /** Integrations whose settings events mean this link should be read again. */
  watches: readonly IntegrationId[];
  read(db: SettingsReader): Promise<LinkReading>;
}

/** Must match TWITCH_TOKEN_SETTING in api/src/twitch-token-source.ts, which writes it. */
export const TWITCH_TOKEN_SETTING = "twitch_token";

/** Twitch is connected while `twitch_token` holds a value; unlinking stores an empty one. */
export const twitchLinkReader: LinkReader = {
  watches: ["twitch"],
  async read(db) {
    const [token, flag] = await Promise.all([
      db.getSetting(TWITCH_TOKEN_SETTING),
      db.getSetting(integrationEnabledSettingKey("twitch")),
    ]);
    const connected = token !== null && token.trim() !== "";
    const parsed = parseIntegrationEnabled(flag);
    return { connected, enabled: resolveEnabled(parsed, connected), flag: parsed };
  },
};

export type LinkReaderRegistry = Record<AdapterId, LinkReader>;

export const LINK_READERS: LinkReaderRegistry = {
  twitch: twitchLinkReader,
};

/**
 * Checks at startup that every adapter id has a reader. The registry type
 * already demands one; this catches a registry assembled at runtime.
 */
export function assertLinkReaders(registry: Partial<Record<string, LinkReader>>): LinkReaderRegistry {
  const missing = ADAPTER_IDS.filter((id) => registry[id] === undefined);
  if (missing.length > 0) {
    throw new Error(`no link reader for adapter(s): ${missing.join(", ")}`);
  }
  return registry as LinkReaderRegistry;
}
