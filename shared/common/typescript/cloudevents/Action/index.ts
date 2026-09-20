import Event from "../BaseEvent";
import { encode } from "../utils";
import * as ActionEvent from "./events";

export * from "./events";

type EventTuple = [string, Uint8Array];

export default class ActionEvents {
  constructor(private source: string) {}

  execute(event: ActionEvent.ActionExecute): EventTuple {
    return this.encodeEvent(ActionEvent.EventType.Execute, event);
  }

  private encodeEvent(type: ActionEvent.EventType, event: unknown): EventTuple {
    return [type, encode(Event({ type, source: this.source }, event))];
  }
}
