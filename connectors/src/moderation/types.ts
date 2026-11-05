import type { FilterId } from "@woofx3/api/moderation-config";
import type { PlatformId } from "@woofx3/api/platform-gateway";
import type { ChatterMembership } from "@woofx3/common/cloudevents/Chat/events";
import type { ViewerKey } from "../chat/viewer";
import type { Clock } from "../host/deps";
import type { ParseResult } from "../host/host-requests";

/**
 * The part of a chat line a filter may see. Only trusted lines with a
 * platform message id reach a filter, so `messageId` is always set.
 */
export interface ModerationLine {
  platform: PlatformId;
  viewer: ViewerKey;
  /** Lower-case. */
  chatterLogin: string;
  text: string;
  messageId: string;
  /** Undefined when the platform's report could not be read: then no role is assumed. */
  membership: ChatterMembership | undefined;
  /** The line carried a payment, such as cheered bits. */
  paid: boolean;
}

/** `score` is 0 to 1 and informational, for filters that grade rather than match. */
export type FilterVerdict = { hit: false } | { hit: true; reason: string; score?: number };

/** What a chatter recently said, bounded per chatter and in all. */
export interface ChatterHistory {
  /**
   * Records `text` for `viewer` and answers how many of their lines in the
   * last `windowMs`, this one included, were the same text.
   */
  repeats(viewer: ViewerKey, text: string, windowMs: number): number;
}

/** Viewers allowed to post a link for a while, granted with `!permit`. */
export interface PermitStore {
  grant(platform: PlatformId, login: string, seconds: number): void;
  isPermitted(platform: PlatformId, login: string): boolean;
}

export interface FilterEnv {
  clock: Clock;
  history: ChatterHistory;
  permits: PermitStore;
}

/**
 * One chat filter. `parseParams` validates its parameters when a config is
 * saved and loaded; `evaluate` only ever gets params that parser produced.
 * A filter may be async, such as one that asks an inference service.
 */
export interface ModerationFilter<P = unknown> {
  readonly id: FilterId;
  parseParams(raw: unknown): ParseResult<P>;
  evaluate(line: ModerationLine, params: P, env: FilterEnv): FilterVerdict | Promise<FilterVerdict>;
}
