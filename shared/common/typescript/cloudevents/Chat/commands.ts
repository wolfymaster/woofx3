import { commandNameToSubjectSegment } from "../slug";
import { encode } from "../utils";
import Event from "../BaseEvent";

export interface ChatCommandEventData {
    command: string;
    args: string[];
    rawMessage: string;
    chatter: string;
    platform: "twitch";
    channelId?: string;
}

type EventTuple = [string, Uint8Array];

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
    constructor(private source: string) { }

    command(commandName: string, data: Omit<ChatCommandEventData, "command">): EventTuple {
        const slug = commandNameToSubjectSegment(commandName);
        const subject = `chat.command.${slug}`;
        const payload: ChatCommandEventData = { ...data, command: slug };
        return [subject, encode(Event({ type: subject, source: this.source }, payload))];
    }
}
