import { CALLER_TIMEOUT_MS } from "@woofx3/api/platform-gateway";
import { TWITCHAPI_SERVED_BUDGET_MS } from "@woofx3/common/cloudevents/Twitch/commands";
import { z } from "zod";

/** Defaults for the chat command dispatcher's tunables. */
export const CHAT_DEFAULTS = {
  /** Permission decisions remembered per viewer and command. */
  authCacheCapacity: 2_048,
  /** How stale a remembered permission decision may be after a grant changes. */
  authCacheTtlMs: 5_000,
  /** Viewers whose last written group membership is remembered. */
  groupLastSeenCapacity: 4_096,
  /** How long the built-in group catalog is used before it is read again. */
  groupCatalogTtlMs: 300_000,
  /** How long a command event waits for more before the command table reloads. */
  reloadDebounceMs: 250,
  /** How often the command table reloads with no event, healing a missed or failed reload. */
  reloadBackstopMs: 300_000,
  /** How long a built-in command waits on the twitchapi subject for Twitch's answer; must exceed the adapter's served budget. */
  twitchApiTimeoutMs: 10_000,
  /** How long shutdown waits for chat lines still being handled before abandoning them. */
  drainMs: 2_000,
} as const;

// loadRuntimeEnv coerces all-digit values to numbers before the schema sees them.
export const ChatEnvSchema = z.object({
  woofx3ConnectorsDispatcherAuthCacheCapacity: z.number().int().positive().default(CHAT_DEFAULTS.authCacheCapacity),
  woofx3ConnectorsDispatcherAuthCacheTtlMs: z.number().int().positive().default(CHAT_DEFAULTS.authCacheTtlMs),
  woofx3ConnectorsDispatcherGroupLastSeenCapacity: z
    .number()
    .int()
    .positive()
    .default(CHAT_DEFAULTS.groupLastSeenCapacity),
  woofx3ConnectorsDispatcherGroupCatalogTtlMs: z.number().int().positive().default(CHAT_DEFAULTS.groupCatalogTtlMs),
  woofx3ConnectorsDispatcherReloadDebounceMs: z.number().int().positive().default(CHAT_DEFAULTS.reloadDebounceMs),
  woofx3ConnectorsDispatcherReloadBackstopMs: z.number().int().positive().default(CHAT_DEFAULTS.reloadBackstopMs),
  woofx3ConnectorsDispatcherTwitchApiTimeoutMs: z
    .number()
    .int()
    .min(TWITCHAPI_SERVED_BUDGET_MS + 1, `must exceed the twitchapi served budget of ${TWITCHAPI_SERVED_BUDGET_MS} ms`)
    .default(CHAT_DEFAULTS.twitchApiTimeoutMs),
  woofx3ConnectorsDispatcherDrainMs: z.number().int().positive().default(CHAT_DEFAULTS.drainMs),
});

export type ChatEnv = z.infer<typeof ChatEnvSchema>;

export interface ChatConfig {
  authCache: { capacity: number; ttlMs: number };
  groups: { lastSeenCapacity: number; catalogTtlMs: number };
  store: { reloadDebounceMs: number; reloadBackstopMs: number };
  twitchApi: { timeoutMs: number };
  drainMs: number;
  /** How long a reply waits for the platform gateway: the gateway callers' timeout, which its own deadline stays below. */
  replyTimeoutMs: number;
}

export function chatConfig(env: ChatEnv): ChatConfig {
  return {
    authCache: {
      capacity: env.woofx3ConnectorsDispatcherAuthCacheCapacity,
      ttlMs: env.woofx3ConnectorsDispatcherAuthCacheTtlMs,
    },
    groups: {
      lastSeenCapacity: env.woofx3ConnectorsDispatcherGroupLastSeenCapacity,
      catalogTtlMs: env.woofx3ConnectorsDispatcherGroupCatalogTtlMs,
    },
    store: {
      reloadDebounceMs: env.woofx3ConnectorsDispatcherReloadDebounceMs,
      reloadBackstopMs: env.woofx3ConnectorsDispatcherReloadBackstopMs,
    },
    twitchApi: { timeoutMs: env.woofx3ConnectorsDispatcherTwitchApiTimeoutMs },
    drainMs: env.woofx3ConnectorsDispatcherDrainMs,
    replyTimeoutMs: CALLER_TIMEOUT_MS,
  };
}
