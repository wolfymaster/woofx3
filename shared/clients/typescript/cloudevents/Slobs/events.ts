export enum EventType {
    NotifyWidget = 'slobs',
}

export interface NotifyWidget<T extends Object = {}> {
    widgetId: string;
    message: string;
    data: T;
}
