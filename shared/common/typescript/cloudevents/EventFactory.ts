import ActionEvents from "./Action";
import AlertEvents from "./Alert";
import ChatCommandEvents from "./Chat/commands";
import CommandEvents from "./Command";
import ObsEvents from "./Obs";
import PlatformEvents, { type StreamPlatform } from "./Twitch";
import TwitchApiEvents from "./Twitch/commands";

export interface EventFactoryOpts {
  source: string;
}

export default class EventFactory {
  private source: string;

  constructor(opts?: EventFactoryOpts) {
    this.source = opts?.source ?? "unkown";
  }

  /** See PlatformEvents for what `eventId` is for. */
  Platform(platform: StreamPlatform, eventId?: () => string) {
    return new PlatformEvents(this.source, platform, eventId);
  }

  Action() {
    return new ActionEvents(this.source);
  }

  TwitchApi() {
    return new TwitchApiEvents();
  }

  ChatCommand() {
    return new ChatCommandEvents(this.source);
  }

  Command() {
    return new CommandEvents(this.source);
  }

  Alert() {
    return new AlertEvents(this.source);
  }

  Obs() {
    return new ObsEvents(this.source);
  }
}
