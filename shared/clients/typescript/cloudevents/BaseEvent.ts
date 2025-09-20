interface BaseEvent<T> {
    specversion: string;
    type: string;
    source: string;
    id: string;
    time: Date,
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
