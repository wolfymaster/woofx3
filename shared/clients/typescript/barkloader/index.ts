export type MessageHandler = (msg: BarkloaderMessageResponse) => void;
export type ReconnectAttemptHandler = (attempt: number, maxRetries: number | typeof Infinity) => void;

export interface BarkloaderClientConfig {
    wsUrl: string;
    onOpen: EventListener;
    onClose: EventListener;
    onError: EventListener;
    reconnectTimeout?: number;
    maxRetries?: number | typeof Infinity;
    onReconnectAttempt?: ReconnectAttemptHandler;
}

export interface BarkloaderMessageResponse {
    args: Record<string, any>;
    command: string;
    error: string;
    message: string;
}

export default class BarkloaderClient {
    private socket: WebSocket | null = null;
    private onMessage: MessageHandler;
    private reconnectTimeout: number;
    private maxRetries: number | typeof Infinity;
    private onReconnectAttempt?: ReconnectAttemptHandler;
    
    private currentRetryCount: number = 0;
    private reconnectTimer: ReturnType<typeof setTimeout> | null = null;
    private isConnecting: boolean = false;
    private shouldReconnect: boolean = true;
    private isManualClose: boolean = false;

    constructor(private config: BarkloaderClientConfig) {
        this.onMessage = () => {};
        this.reconnectTimeout = config.reconnectTimeout ?? 5000;
        this.maxRetries = config.maxRetries ?? Infinity;
        this.onReconnectAttempt = config.onReconnectAttempt;
    }

    public connect(): void {
        if (this.isConnecting || (this.socket && this.socket.readyState === WebSocket.OPEN)) {
            return;
        }

        this.isConnecting = true;
        this.isManualClose = false;
        this.shouldReconnect = true;

        try {
            this.socket = new WebSocket(this.config.wsUrl);
            this.attachEventListeners();
        } catch (error) {
            this.isConnecting = false;
            this.handleConnectionFailure();
        }
    }

    public disconnect(): void {
        this.isManualClose = true;
        this.shouldReconnect = false;
        this.clearReconnectTimer();
        
        if (this.socket) {
            this.removeEventListeners();
            
            if (this.socket.readyState === WebSocket.OPEN || 
                this.socket.readyState === WebSocket.CONNECTING) {
                this.socket.close(1000, 'Manual disconnect');
            }
            this.socket = null;
        }
        
        this.currentRetryCount = 0;
        this.isConnecting = false;
    }

    public isConnected(): boolean {
        return this.socket?.readyState === WebSocket.OPEN;
    }

    public send(data: string | ArrayBufferLike | Blob | ArrayBufferView): void {
        if (this.socket && this.socket.readyState === WebSocket.OPEN) {
            this.socket.send(data);
        } else {
            throw new Error('WebSocket is not connected');
        }
    }

    public registerHandler(event: string, cb: MessageHandler) {
        switch(event) {
            case 'onMessage': {
                this.onMessage = cb;
                break;
            }
        }
    }

    private attachEventListeners(): void {
        if (!this.socket) return;

        this.socket.addEventListener("open", this.handleOpen);
        this.socket.addEventListener("close", this.handleClose);
        this.socket.addEventListener("message", this.messageHandler);
        this.socket.addEventListener("error", this.handleError);
    }

    private removeEventListeners(): void {
        if (!this.socket) return;

        this.socket.removeEventListener("open", this.handleOpen);
        this.socket.removeEventListener("close", this.handleClose);
        this.socket.removeEventListener("message", this.messageHandler);
        this.socket.removeEventListener("error", this.handleError);
    }

    private handleOpen = (event: Event): void => {
        this.isConnecting = false;
        this.currentRetryCount = 0;
        this.clearReconnectTimer();
        
        this.config.onOpen(event);
    };

    private handleClose = (event: CloseEvent): void => {
        this.isConnecting = false;
        
        this.config.onClose(event);
        
        if (this.socket) {
            this.removeEventListeners();
            this.socket = null;
        }

        if (!this.isManualClose && this.shouldReconnect) {
            this.handleConnectionFailure();
        }
    };

    private handleError = (event: Event): void => {
        this.config.onError(event);
        this.isConnecting = false;
    };

    private messageHandler = (event: MessageEvent): void => {
        try {
            const message = JSON.parse(event.data) as BarkloaderMessageResponse;
            this.onMessage(message);
        } catch (err) {
            this.onMessage(event.data);
        }
    };

    private handleConnectionFailure(): void {
        if (!this.shouldReconnect || this.isManualClose) {
            return;
        }

        if (this.currentRetryCount >= this.maxRetries) {
            console.warn(`BarkloaderClient: Maximum reconnection attempts (${this.maxRetries}) reached`);
            this.shouldReconnect = false;
            return;
        }

        this.currentRetryCount++;

        if (this.onReconnectAttempt) {
            this.onReconnectAttempt(this.currentRetryCount, this.maxRetries);
        }

        this.reconnectTimer = setTimeout(() => {
            console.log(`BarkloaderClient: Attempting to reconnect (${this.currentRetryCount}/${this.maxRetries === Infinity ? '∞' : this.maxRetries})`);
            this.connect();
        }, this.reconnectTimeout);
    }

    private clearReconnectTimer(): void {
        if (this.reconnectTimer) {
            clearTimeout(this.reconnectTimer);
            this.reconnectTimer = null;
        }
    }

    public destroy(): void {
        this.disconnect();
        this.clearReconnectTimer();
        this.shouldReconnect = false;
    }
}