export enum EventType {
    SendMessage = 'message.send',
}

export interface SendMessage {
    platform: string;
    message: string;
}
