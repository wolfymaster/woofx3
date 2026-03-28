import { encodeCommand } from "../utils";

const TWITCHAPI_SUBJECT = "twitchapi";

export interface TimeoutArgs {
  user?: string;
  duration: number;
}

export interface UpdateStreamArgs {
  category?: string;
  title?: string;
}

type EventTuple = [string, Uint8Array];

export default class TwitchApiEvents {
  timeout(args: TimeoutArgs): EventTuple {
    return [TWITCHAPI_SUBJECT, encodeCommand({ command: "timeout", args })];
  }

  updateStream(args: UpdateStreamArgs): EventTuple {
    return [TWITCHAPI_SUBJECT, encodeCommand({ command: "update_stream", args })];
  }
}
