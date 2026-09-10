export interface BaseEvent<T> {
    specversion: string;
    type: string;
    source: string;
    id: string;
    time: Date,
    /**
     * CloudEvents extension attribute naming the platform an event came from
     * ("twitch", ...). Provenance, not payload: `type` says what happened,
     * `platform` says where, so a subscriber can take `channel.follow` from
     * every platform and narrow only when it cares.
     *
     * Absent on events that have no originating platform (module lifecycle,
     * db outbox, scheduler).
     */
    platform?: string;
    data: T
}

export default function Event<T>(opts: Partial<BaseEvent<T>>, data: T): BaseEvent<T> {
    return {
        specversion: '1.0.0',
        type: 'unknown',
        source: 'unknown',
        id: 'unknown',
        time: new Date(),
        data,
        ...opts
    }
}
