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
