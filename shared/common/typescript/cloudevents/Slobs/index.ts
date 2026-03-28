import * as SlobEvent from './events';
import { encode, encodeCommand } from '../utils';
import Event from '../BaseEvent';

const SLOBS_SUBJECT = 'slobs';
type EventTuple = [string, Uint8Array];

export default class SlobsEvents {
    constructor(private source: string) {}

    notifyWidget(event: SlobEvent.NotifyWidget): EventTuple {
        return this.encodeEvent(SlobEvent.EventType.NotifyWidget, event);
    }

    follow(args: SlobEvent.FollowArgs): EventTuple {
        return [SLOBS_SUBJECT, encodeCommand({ command: 'follow', args })];
    }

    sceneChange(args: SlobEvent.SceneChangeArgs): EventTuple {
        return [SLOBS_SUBJECT, encodeCommand({ command: 'scene_change', args })];
    }

    sourceChange(args: SlobEvent.SourceChangeArgs): EventTuple {
        return [SLOBS_SUBJECT, encodeCommand({ command: 'source_change', args })];
    }

    private encodeEvent(type: SlobEvent.EventType, event: any): EventTuple {
        return [type, encode(Event({ type, source: this.source }, event))];
    }
}