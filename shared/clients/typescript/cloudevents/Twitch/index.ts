import * as TwitchEvent from './events';
import { encode } from '../utils';
import Event from '../BaseEvent';

type EventTuple = [string, Uint8Array];

export default class TwitchEvents {
    constructor(private source: string) { }

    chatMessage(event: TwitchEvent.ChatMessage): EventTuple {
        return this.encodeEvent(TwitchEvent.EventType.ChatMessage, event);
    }

    cheer(event: TwitchEvent.Cheer): EventTuple {
        return this.encodeEvent(TwitchEvent.EventType.Cheer, event);
    }

    follow(event: TwitchEvent.Follow): EventTuple {
        return this.encodeEvent(TwitchEvent.EventType.Follow, event);
    }

    hypeTrainBegin(event: TwitchEvent.HypeTrainBegin): EventTuple {
        return this.encodeEvent(TwitchEvent.EventType.HypeTrainBegin, event);
    }

    streamOnline(event: TwitchEvent.StreamOnline): EventTuple {
        return this.encodeEvent(TwitchEvent.EventType.StreamOnline, event);
    }

    subscribe(event: TwitchEvent.Subscribe): EventTuple {
        return this.encodeEvent(TwitchEvent.EventType.Subscribe, event);
    }

    subscriptionGift(event: TwitchEvent.SubscriptionGift): EventTuple {
        return this.encodeEvent(TwitchEvent.EventType.SubscriptionGift, event);
    }

    private encodeEvent(type: TwitchEvent.EventType, event: any): EventTuple {
        return [type, encode(Event({ type, source: this.source }, event))];
    }
}
