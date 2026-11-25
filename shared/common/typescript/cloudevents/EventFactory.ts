import PlatformEvents, { type StreamPlatform } from "./Twitch";
import TwitchApiEvents from "./Twitch/commands";
import ChatCommandEvents from "./Chat/commands";
import CommandEvents from "./Command";
import ActionEvents from "./Action";
import AlertEvents from "./Alert";
import ObsEvents from "./Obs";

export interface EventFactoryOpts {
  source: string;
}

export default class EventFactory {
  private source: string;

  constructor(opts?: EventFactoryOpts) {
    this.source = opts?.source ?? "unkown";
  }

  Platform(platform: StreamPlatform) {
    return new PlatformEvents(this.source, platform);
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
