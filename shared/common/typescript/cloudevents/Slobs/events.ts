export enum EventType {
    NotifyWidget = 'slobs',
}

export interface NotifyWidget<T extends Object = {}> {
    widgetId: string;
    message: string;
    data: T;
}

export interface FollowArgs {
    username: string;
}

export interface SceneChangeArgs {
    sceneName: string;
}

export interface SourceChangeArgs {
    sourceName: string;
    value: string;
}
