import type { PlatformId } from "@woofx3/api/platform-gateway";
import Event, { type BaseEvent } from "../BaseEvent";
import { commandNameToSubjectSegment } from "../slug";
import { encode } from "../utils";

export interface ChatCommandEventData {
  command: string;
  args: string[];
  rawMessage: string;
  /** rawMessage with the matched command token stripped, e.g. "!sr bad angel" -> "bad angel". */
  text: string;
  /** Named argument_pattern captures (e.g. "{songTitle}" -> { songTitle: "..." }).
   *  Empty object when the command declares no `{variable}` placeholders. Dotted
   *  variable names (e.g. "user.name") build nested objects. */
  variables: Record<string, unknown>;
  chatter: string;
  /** The platform the invoking line was said on. */
  platform: PlatformId;
  channelId?: string;
}

type EventTuple = [string, Uint8Array];

/** One invocation of a chat command, as announced on `chat.command.<slug>`. */
export type ChatCommandEvent = BaseEvent<ChatCommandEventData>;

/** Who the invocation came from, carried as CloudEvents extension attributes. */
export interface ChatCommandAttributes {
  platform?: PlatformId;
  triggeredBy?: string;
}

/**
 * Build the (subject, encoded-payload) tuple for a chat-command CloudEvent.
 * Subject shape: `chat.command.<slug>` where slug is the normalized command
 * name (see {@link commandNameToSubjectSegment}). Unlike the static-subject
 * factories in this package, the subject is derived per-call from the
 * command name — the workflow engine subscribes to concrete subjects via
 * the reactive registrar at workflow-creation time, so every command gets
 * its own NATS subject rather than a shared one discriminated by payload.
 */
export default class ChatCommandEvents {
  constructor(private source: string) {}

  /**
   * The `chat.command.<slug>` event of one invocation. Built once per
   * invocation: the same object is announced (`encode`) and handed to the
   * command's own workflow run, so both read the same id, time, session and
   * `data.command` slug.
   */
  event(
    commandName: string,
    data: Omit<ChatCommandEventData, "command">,
    attributes: ChatCommandAttributes = {}
  ): ChatCommandEvent {
    const slug = commandNameToSubjectSegment(commandName);
    const type = `chat.command.${slug}`;
    return Event<ChatCommandEventData>({ type, source: this.source, ...attributes }, { ...data, command: slug });
  }

  /** The (subject, encoded-payload) tuple announcing `event`. */
  encode(event: ChatCommandEvent): EventTuple {
    return [event.type, encode(event)];
  }

  command(commandName: string, data: Omit<ChatCommandEventData, "command">): EventTuple {
    return this.encode(this.event(commandName, data));
  }
}
