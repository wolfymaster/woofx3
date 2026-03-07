
import * as SlobEvent from './events';
import { encode } from '../utils';
import Event from '../BaseEvent';

type EventTuple = [string, Uint8Array];


export default class SlobsEvents {
    constructor(private source: string) {}

    notifyWidget(event: SlobEvent.NotifyWidget): EventTuple {
        return this.encodeEvent(SlobEvent.EventType.NotifyWidget, event);
    }   

    private encodeEvent(type: SlobEvent.EventType, event: any): EventTuple {
        return [type, encode(Event({ type, source: this.source }, event))];
    }
}