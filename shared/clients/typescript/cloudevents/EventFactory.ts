import TwitchEvents from './Twitch';

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
}