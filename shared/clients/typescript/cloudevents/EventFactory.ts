import TwitchEvents from './Twitch';
import SlobsEvents from './Slobs';

export interface EventFactoryOpts {
    source: string;
}

export default class EventFactory {
    private source: string;

    constructor(opts?: EventFactoryOpts) {
        this.source = opts?.source ?? 'unkown';
    }

    Twitch() {
        return new TwitchEvents(this.source);
    }

    Slobs() {
        return new SlobsEvents(this.source);
    }
}