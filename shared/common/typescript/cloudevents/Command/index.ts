import * as CommandEvent from "./events";
import { encode } from "../utils";
import Event from "../BaseEvent";

export * from "./events";
export * from "./messages";

type EventTuple = [string, Uint8Array];

type CommandEventPayload =
  | CommandEvent.CommandCreated
  | CommandEvent.CommandUpdated
  | CommandEvent.CommandDeleted
  | CommandEvent.CommandWorkflowExecution;

export default class CommandEvents {
  constructor(private source: string) {}

  created(event: CommandEvent.CommandCreated): EventTuple {
    return this.encodeEvent(CommandEvent.EventType.Created, event);
  }

  updated(event: CommandEvent.CommandUpdated): EventTuple {
    return this.encodeEvent(CommandEvent.EventType.Updated, event);
  }

  deleted(event: CommandEvent.CommandDeleted): EventTuple {
    return this.encodeEvent(CommandEvent.EventType.Deleted, event);
  }

  executeWorkflow(event: CommandEvent.CommandWorkflowExecution): EventTuple {
    return this.encodeEvent(CommandEvent.EventType.ExecuteWorkflow, event);
  }

  private encodeEvent(type: CommandEvent.EventType, event: CommandEventPayload): EventTuple {
    return [type, encode(Event({ type, source: this.source }, event))];
  }
}
