import {
  type IntegrationEnabled,
  type IntegrationId,
  integrationEnabledSettingKey,
  parseIntegrationEnabled,
  resolveEnabled,
} from "@woofx3/common/integrations/integration-settings";
import { obsLinkReader } from "../adapters/obs/link";
import type { AdapterId } from "./adapter-ids";

/** What an adapter's `desired` decides from. */
export interface LinkState {
  /** Its credential or target is in place. */
  connected: boolean;
  /** It should run when connected. */
  enabled: boolean;
}

/** A link state plus how its enabled flag was read, so the watcher can report a missing or bad flag. */
export interface LinkReading extends LinkState {
  /** Null for an adapter that has no enabled setting to read. */
  flag: IntegrationEnabled | null;
  /**
   * Stored records the reader could not use and left out, in words for the
   * log. The watcher logs each once, and again only after it has gone away
   * and come back.
   */
  ignored: readonly string[];
}

/**
 * An installed module as a link reader sees it: its manifest-local id, its
 * stored manifest (barkloader's JSON, possibly empty), and whether it is
 * switched off.
 */
export interface InstalledModule {
  moduleId: string;
  manifest: string;
  /** The stored state is "disabled"; anything else runs, as barkloader reads it (registry_state_from_db). */
  disabled: boolean;
}

/** The stored records link readers decide from, read through db-proxy. */
export interface LinkStore {
  /** An engine setting; a missing one reads as null. */
  getSetting(key: string): Promise<string | null>;
  installedModules(): Promise<InstalledModule[]>;
}

export interface LinkReader {
  /** Integrations whose settings events mean this link should be read again. */
  watches: readonly IntegrationId[];
  /**
   * Other bus subjects (patterns allowed) whose events mean this link should be
   * read again. The host scope subscribes to every reader's subjects.
   */
  events: readonly string[];
  read(store: LinkStore): Promise<LinkReading>;
}

/** Must match TWITCH_TOKEN_SETTING in api/src/twitch-token-source.ts, which writes it. */
export const TWITCH_TOKEN_SETTING = "twitch_token";

/** Twitch is connected while `twitch_token` holds a value; unlinking stores an empty one. */
export const twitchLinkReader: LinkReader = {
  watches: ["twitch"],
  events: [],
  async read(db) {
    const [token, flag] = await Promise.all([
      db.getSetting(TWITCH_TOKEN_SETTING),
      db.getSetting(integrationEnabledSettingKey("twitch")),
    ]);
    const connected = token !== null && token.trim() !== "";
    const parsed = parseIntegrationEnabled(flag);
    return { connected, enabled: resolveEnabled(parsed, connected), flag: parsed, ignored: [] };
  },
};

export type LinkReaderRegistry = Record<AdapterId, LinkReader>;

export interface LinkReadersDeps {
  /** WOOFX3_OBS_HOST holds a value, so OBS runs without an OBS module (ObsConfig.hostExplicit). */
  obsHostExplicit: boolean;
}

/** The link reader of every adapter this build runs. */
export function linkReaders(deps: LinkReadersDeps): LinkReaderRegistry {
  return {
    twitch: twitchLinkReader,
    obs: obsLinkReader({ hostExplicit: deps.obsHostExplicit }),
  };
}
