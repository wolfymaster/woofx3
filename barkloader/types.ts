export interface ChatMessage {
    message: string;
    user: string;
}

export interface Command {
    command: string;
    args: any;
}

export interface ChatMessageResponse {
    type: string;
    value: string | Command; 
}

export interface InvokeRequest {
    func: string;
    args: any[];
}

export interface WebSocketMessage {
    type: string;
    data?: InvokeRequest
}

export interface StreamAlertArgs {
    audioUrl?: string;
}

export interface TwitchArgs {
    time?: string;
}

export interface TimerArgs {
    id: string;
    valueInSeconds: string;
}
