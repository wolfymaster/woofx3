import * as AlertEvent from './events';
import { encode } from '../utils';
import Event from '../BaseEvent';

export * from './events';

type EventTuple = [string, Uint8Array];

export default class AlertEvents {
    constructor(private source: string) {}

    fire(event: AlertEvent.AlertFire): EventTuple {
        return this.encodeEvent(AlertEvent.EventType.AlertFire, event);
    }

    private encodeEvent(type: AlertEvent.EventType, event: any): EventTuple {
        return [type, encode(Event({ type, source: this.source }, event))];
    }
}
