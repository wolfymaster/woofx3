import Event, { type BaseEvent } from "../BaseEvent";
import { commandNameToSubjectSegment } from "../slug";
import type { SchemaChatCommand } from "../Twitch/stream.gen";
import { validateChatCommandEvent } from "../Twitch/stream.validate.gen";
import { encode } from "../utils";

/** The payload of one invocation, as the stream contract (shared/contracts/stream/openapi.yaml) defines it. */
export type ChatCommandEventData = SchemaChatCommand;

type EventTuple = [string, Uint8Array];

/** One invocation of a chat command, as announced on `chat.command.<slug>`. */
export type ChatCommandEvent = BaseEvent<ChatCommandEventData>;

/** Who the invocation came from, carried as CloudEvents extension attributes. */
export interface ChatCommandAttributes {
  platform?: ChatCommandEventData["platform"] & string;
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
    const event = Event<ChatCommandEventData>({ type, source: this.source, ...attributes }, { ...data, command: slug });
    // Checked where it is built, before the command's steps run, so an event that does not fit the
    // contract stops the invocation rather than failing after the steps ran.
    if (!validateChatCommandEvent(JSON.parse(JSON.stringify(event)))) {
      const problem = validateChatCommandEvent.errors?.[0];
      throw new Error(
        `${type} event does not match its contract: ${problem?.instancePath ?? ""} ${problem?.message ?? ""}`.trim()
      );
    }
    return event;
  }

  /** The (subject, encoded-payload) tuple announcing `event`. */
  encode(event: ChatCommandEvent): EventTuple {
    return [event.type, encode(event)];
  }

  command(commandName: string, data: Omit<ChatCommandEventData, "command">): EventTuple {
    return this.encode(this.event(commandName, data));
  }
}
