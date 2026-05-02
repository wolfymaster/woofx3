import * as CommandEvent from './events';
import { encode } from '../utils';
import Event from '../BaseEvent';

export * from './events';
export * from './messages';

type EventTuple = [string, Uint8Array];

export default class CommandEvents {
    constructor(private source: string) { }

    created(event: CommandEvent.CommandCreated): EventTuple {
        return this.encodeEvent(CommandEvent.EventType.Created, event);
    }

    updated(event: CommandEvent.CommandUpdated): EventTuple {
        return this.encodeEvent(CommandEvent.EventType.Updated, event);
    }

    deleted(event: CommandEvent.CommandDeleted): EventTuple {
        return this.encodeEvent(CommandEvent.EventType.Deleted, event);
    }

    private encodeEvent(type: CommandEvent.EventType, event: any): EventTuple {
        return [type, encode(Event({ type, source: this.source }, event))];
    }
}
