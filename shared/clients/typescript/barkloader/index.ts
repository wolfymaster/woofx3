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

// Wire shape barkloard's Rust WS server actually sends for `invoke`
// request/response pairs - distinct from BarkloaderMessageResponse's
// "module pushed a chat line" push-message shape above.
interface BarkloaderInvokeReply {
    type: "result" | "error";
    id?: string;
    data: unknown;
}

const INVOKE_TIMEOUT_MS = 5000;

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

    // Pending `invoke()` calls awaiting a correlated "result"/"error" reply.
    // A WS disconnect mid-flight would otherwise leak these forever, hence
    // the per-call timeout that also clears the entry.
    private pendingInvokes = new Map<string, { resolve: (v: unknown) => void; reject: (e: unknown) => void }>();

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

            try {
                if (this.socket.readyState === WebSocket.OPEN ||
                    this.socket.readyState === WebSocket.CONNECTING) {
                    this.socket.close(1000, 'Manual disconnect');
                }
            } catch {
                // Bun can throw when closing a socket mid-handshake
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

    // Sends an `invoke` request and awaits its correlated `result`/`error`
    // reply, rather than firing-and-forgetting like `send()`. Rejects after
    // INVOKE_TIMEOUT_MS if no reply arrives (e.g. the connection dropped
    // mid-flight), cleaning up the pending entry either way.
    //
    // `event` becomes `ctx.event` verbatim in the sandboxed function — same
    // `function`/`event` wire shape the Go client already uses
    // (shared/clients/golang/barkloader/client.go's Client.Invoke), so both
    // language clients speak the same modern protocol barkloader's
    // websocket.rs treats as canonical (`func`/`args` there is the legacy
    // fallback this replaces).
    public invoke(func: string, event: Record<string, unknown>): Promise<unknown> {
        const id = crypto.randomUUID();
        return new Promise((resolve, reject) => {
            const timer = setTimeout(() => {
                this.pendingInvokes.delete(id);
                reject(new Error(`Barkloader invoke timed out after ${INVOKE_TIMEOUT_MS}ms: ${func}`));
            }, INVOKE_TIMEOUT_MS);

            this.pendingInvokes.set(id, {
                resolve: (v) => {
                    clearTimeout(timer);
                    resolve(v);
                },
                reject: (e) => {
                    clearTimeout(timer);
                    reject(e);
                },
            });

            try {
                this.send(JSON.stringify({ type: "invoke", id, data: { function: func, event } }));
            } catch (err) {
                this.pendingInvokes.delete(id);
                clearTimeout(timer);
                reject(err);
            }
        });
    }

    public registerHandler(event: string, cb: (...args: any[]) => void) {
        switch(event) {
            case 'onMessage': {
                this.onMessage = cb as MessageHandler;
                break;
            }
            case 'onError': {
                this.config.onError = cb as EventListener;
                break;
            }
            case 'onClose': {
                this.config.onClose = cb as EventListener;
                break;
            }
            case 'onOpen': {
                this.config.onOpen = cb as EventListener;
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
            const message = JSON.parse(event.data) as Partial<BarkloaderInvokeReply> & BarkloaderMessageResponse;
            if (message.id && this.pendingInvokes.has(message.id)) {
                const pending = this.pendingInvokes.get(message.id)!;
                this.pendingInvokes.delete(message.id);
                if (message.type === "error") {
                    pending.reject(new Error(typeof message.data === "string" ? message.data : JSON.stringify(message.data)));
                } else {
                    const result =
                        message.data && typeof message.data === "object" && "result" in (message.data as object)
                            ? (message.data as { result: unknown }).result
                            : message.data;
                    pending.resolve(result);
                }
                return;
            }
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