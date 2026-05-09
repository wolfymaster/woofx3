import * as ObsCommand from './commands';
import { encode } from '../utils';
import Event from '../BaseEvent';

export * from './commands';

type EventTuple = [string, Uint8Array];

export default class ObsEvents {
    constructor(private source: string) {}

    command(cmd: ObsCommand.OBSCommand): EventTuple {
        return this.encodeEvent(ObsCommand.EventType.ObsCommand, cmd);
    }

    private encodeEvent(type: ObsCommand.EventType, event: any): EventTuple {
        return [type, encode(Event({ type, source: this.source }, event))];
    }
}
