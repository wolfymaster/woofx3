import TwitchEvents from './Twitch';
import TwitchApiEvents from './Twitch/commands';
import SlobsEvents from './Slobs';
import ChatEvents from './Chat';

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

    TwitchApi() {
        return new TwitchApiEvents();
    }

    Slobs() {
        return new SlobsEvents(this.source);
    }

    Chat() {
        return new ChatEvents(this.source);
    }
}