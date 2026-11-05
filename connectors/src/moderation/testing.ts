import { PLATFORM_IDS } from "@woofx3/api/platform-gateway";
import type { ChatterMembership } from "@woofx3/common/cloudevents/Chat/events";
import { parsed } from "../host/host-requests";
import type { ChatterHistory, FilterEnv, FilterVerdict, ModerationFilter, ModerationLine, PermitStore } from "./types";

export const NOBODY: ChatterMembership = {
  isBroadcaster: false,
  isModerator: false,
  isSubscriber: false,
  isVip: false,
};

/** Any platform will do: filters never look at which one a line came from. */
const PLATFORM = PLATFORM_IDS[0];

/** A trusted line from an ordinary viewer, with `overrides` applied. */
export function moderationLine(overrides: Partial<ModerationLine> = {}): ModerationLine {
  return {
    platform: PLATFORM,
    viewer: { platform: PLATFORM, platformUserId: "v-1" },
    chatterLogin: "viewer_one",
    text: "hello chat",
    messageId: "m-1",
    membership: NOBODY,
    paid: false,
    ...overrides,
  };
}

/** History that never saw a line before. */
export const freshHistory: ChatterHistory = { repeats: () => 1 };

/** Permits granted to nobody. */
export const noPermits: PermitStore = { grant: () => {}, isPermitted: () => false };

export function filterEnv(overrides: Partial<FilterEnv> = {}): FilterEnv {
  return { clock: { now: () => 0 }, history: freshHistory, permits: noPermits, ...overrides };
}

/** A filter that takes any params and answers `verdict`, counting its calls. */
export function stubFilter(
  id: ModerationFilter["id"],
  verdict: (line: ModerationLine) => FilterVerdict | Promise<FilterVerdict> = () => ({ hit: false })
): ModerationFilter & { calls: number } {
  const filter = {
    id,
    calls: 0,
    parseParams: (raw: unknown) => parsed(raw),
    evaluate: (line: ModerationLine) => {
      filter.calls++;
      return verdict(line);
    },
  };
  return filter;
}
