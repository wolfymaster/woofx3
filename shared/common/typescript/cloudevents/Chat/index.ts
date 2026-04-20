import * as ChatEvent from './events';
import { encode } from '../utils';
import Event from '../BaseEvent';

export * from './events';
export * from './messages';

type EventTuple = [string, Uint8Array];

export default class ChatEvents {
    constructor(private source: string) { }

    sendMessage(event: ChatEvent.SendMessage): EventTuple {
        return this.encodeEvent(ChatEvent.EventType.SendMessage, event);
    }

    private encodeEvent(type: ChatEvent.EventType, event: any): EventTuple {
        return [type, encode(Event({ type, source: this.source }, event))];
    }
}
