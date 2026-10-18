import { encodeCommand } from "../utils";

const TWITCHAPI_SUBJECT = "twitchapi";

/**
 * Argument shapes of the `twitchapi` commands. The twitch service
 * (twitch/src/lib/twitch.ts) is the authority on them and validates each.
 */
export interface TimeoutArgs {
  userId?: string;
  userName?: string;
  durationSeconds: number;
  reason?: string;
}

export interface UpdateStreamArgs {
  title?: string;
  /** Free text, resolved through Twitch's category search. */
  category?: string;
  categoryId?: string;
  tags?: string[];
}

export interface CreateMarkerArgs {
  description?: string;
}

/**
 * The `twitchapi` command that performs one declared Helix operation and
 * answers with Helix's own result, for a caller that interprets Helix
 * responses itself.
 */
export const HELIX_COMMAND = "helix";

/**
 * The Helix operations `helix` performs. twitch/src/lib/helix.ts declares
 * each one's endpoint and the parameters a caller may set.
 */
export type HelixOperationName =
  | "getChannelInformation"
  | "getGames"
  | "searchCategories"
  | "modifyChannelInformation"
  | "createStreamMarker"
  | "getAdSchedule"
  | "snoozeNextAd"
  | "getUsers"
  | "getBlockedTerms"
  | "addBlockedTerm"
  | "removeBlockedTerm"
  | "banUser"
  | "unbanUser"
  | "getChatSettings"
  | "updateChatSettings"
  | "sendChatMessage"
  | "sendChatAnnouncement"
  | "sendShoutout"
  | "getChatters";

export interface HelixCommandArgs {
  operation: HelixOperationName;
  /** By Helix's own names. The linked broadcaster's ids are filled in by the twitch service. */
  params?: Record<string, unknown>;
}

/**
 * What `helix` answers when Twitch answered. `body` is Helix's JSON body
 * unchanged, null when it sent none (204). A non-2xx answer is a result, not
 * a refusal: `body` is then Twitch's error body as text, for the caller to
 * read Twitch's reason from.
 */
export type HelixCommandResult = { ok: true; body: unknown } | { ok: false; status: number; body: string };

type EventTuple = [string, Uint8Array];

export default class TwitchApiEvents {
  timeout(args: TimeoutArgs): EventTuple {
    return [TWITCHAPI_SUBJECT, encodeCommand({ command: "timeout", args })];
  }

  updateStream(args: UpdateStreamArgs): EventTuple {
    return [TWITCHAPI_SUBJECT, encodeCommand({ command: "updateStream", args })];
  }

  createMarker(args: CreateMarkerArgs): EventTuple {
    return [TWITCHAPI_SUBJECT, encodeCommand({ command: "createMarker", args })];
  }
}
