import { MessageBus, Subscription, Handler, SubscribeOptions, HTTPConfig } from './types';
import { createMessage } from './msg';

/**
 * HTTP/WebSocket backend implementation that connects to Go message bus
 */
export class HTTPBackend implements MessageBus {
  private ws: WebSocket | null = null;
  private subscriptions = new Map<string, Set<Handler>>();
  private subscriptionCounter = 0;
  private reconnectTimer: ReturnType<typeof setTimeout> | null = null;
  private shouldReconnect = true;
  private currentRetryCount = 0;
  private isConnecting = false;
  private logger: Console;

  constructor(
    private config: HTTPConfig,
    logger?: Console
  ) {
    this.logger = logger || console;
  }

  private async connect(): Promise<void> {
    if (this.isConnecting || (this.ws && this.ws.readyState === WebSocket.OPEN)) {
      return;
    }

    this.isConnecting = true;
    const url = this.config.url || 'ws://localhost:8080/ws';

    try {
      this.ws = new WebSocket(url);
      this.setupWebSocketHandlers();
      
      // Wait for connection to open
      await new Promise<void>((resolve, reject) => {
        if (!this.ws) {
          reject(new Error('WebSocket creation failed'));
          return;
        }

        const onOpen = () => {
          this.isConnecting = false;
          this.currentRetryCount = 0;
          this.logger.log('Connected to HTTP message bus', { url });
          resolve();
        };

        const onError = (error: Event) => {
          this.isConnecting = false;
          reject(new Error('WebSocket connection failed'));
        };

        this.ws.addEventListener('open', onOpen, { once: true });
        this.ws.addEventListener('error', onError, { once: true });
      });

      // Re-establish subscriptions
      await this.reestablishSubscriptions();
      
    } catch (error) {
      this.isConnecting = false;
      this.logger.error('Failed to connect to HTTP message bus:', error);
      throw error;
    }
  }

  private setupWebSocketHandlers(): void {
    if (!this.ws) return;

    this.ws.addEventListener('message', (event) => {
      try {
        const message = JSON.parse(event.data);
        this.handleMessage(message);
      } catch (error) {
        this.logger.error('Failed to parse message:', error);
      }
    });

    this.ws.addEventListener('close', () => {
      this.logger.log('WebSocket connection closed');
      if (this.shouldReconnect) {
        this.scheduleReconnect();
      }
    });

    this.ws.addEventListener('error', (error) => {
      this.logger.error('WebSocket error:', error);
    });
  }

  private handleMessage(message: any): void {
    if (message.type === 'message' && message.subject && message.data) {
      const handlers = this.subscriptions.get(message.subject) || new Set();
      const msg = createMessage(message.subject, message.data);
      
      handlers.forEach(handler => {
        try {
          handler(msg);
        } catch (error) {
          this.logger.error('Handler error:', error);
        }
      });

      // Handle wildcard subscriptions
      this.matchWildcardSubscriptions(message.subject, msg);
    }
  }

  private matchWildcardSubscriptions(subject: string, msg: any): void {
    const subjectTokens = subject.split('.');
    
    for (const [pattern, handlers] of this.subscriptions) {
      if (pattern !== subject && this.matchesWildcard(pattern, subject)) {
        handlers.forEach(handler => {
          try {
            handler(msg);
          } catch (error) {
            this.logger.error('Wildcard handler error:', error);
          }
        });
      }
    }
  }

  private matchesWildcard(pattern: string, subject: string): boolean {
    const patternTokens = pattern.split('.');
    const subjectTokens = subject.split('.');

    let pi = 0, si = 0;

    while (pi < patternTokens.length && si < subjectTokens.length) {
      switch (patternTokens[pi]) {
        case '*':
          // '*' matches exactly one token
          pi++;
          si++;
          break;
        case '>':
          // '>' matches one or more remaining tokens (must be last in pattern)
          if (pi === patternTokens.length - 1) {
            return si < subjectTokens.length;
          }
          return false;
        default:
          // Exact match required
          if (patternTokens[pi] !== subjectTokens[si]) {
            return false;
          }
          pi++;
          si++;
      }
    }

    // Handle remaining pattern tokens
    if (pi < patternTokens.length) {
      return patternTokens.length - pi === 1 && 
             patternTokens[pi] === '>' && 
             si < subjectTokens.length;
    }

    return pi === patternTokens.length && si === subjectTokens.length;
  }

  private async reestablishSubscriptions(): Promise<void> {
    for (const subject of this.subscriptions.keys()) {
      await this.sendSubscribeMessage(subject);
    }
  }

  private async sendSubscribeMessage(subject: string): Promise<void> {
    if (!this.ws || this.ws.readyState !== WebSocket.OPEN) {
      throw new Error('WebSocket not connected');
    }

    const message = {
      type: 'subscribe',
      subject: subject
    };

    this.ws.send(JSON.stringify(message));
    this.logger.debug?.('Sent subscribe message', { subject });
  }

  private scheduleReconnect(): void {
    if (!this.shouldReconnect || this.currentRetryCount >= (this.config.maxRetries || Infinity)) {
      this.logger.warn('Max reconnection attempts reached or reconnect disabled');
      return;
    }

    this.currentRetryCount++;
    const timeout = this.config.reconnectTimeout || 5000;

    this.reconnectTimer = setTimeout(() => {
      this.logger.log(`Attempting to reconnect (${this.currentRetryCount}/${this.config.maxRetries || '∞'})`);
      this.connect().catch(error => {
        this.logger.error('Reconnection attempt failed:', error);
      });
    }, timeout);
  }

  async publish(subject: string, data: Uint8Array): Promise<void> {
    if (!this.ws || this.ws.readyState !== WebSocket.OPEN) {
      await this.connect();
    }

    if (!this.ws || this.ws.readyState !== WebSocket.OPEN) {
      throw new Error('HTTP message bus connection not available');
    }

    const message = {
      type: 'publish',
      subject: subject,
      data: Array.from(data) // Convert Uint8Array to regular array for JSON
    };

    this.ws.send(JSON.stringify(message));
    this.logger.debug?.('Published message', { subject, size: data.length });
  }

  async subscribe(subject: string, handler: Handler, opts?: SubscribeOptions): Promise<Subscription> {
    if (!this.subscriptions.has(subject)) {
      this.subscriptions.set(subject, new Set());
      
      // Send subscribe message to server if connected
      if (this.ws && this.ws.readyState === WebSocket.OPEN) {
        await this.sendSubscribeMessage(subject);
      } else {
        // Connect and then subscribe
        await this.connect();
        await this.sendSubscribeMessage(subject);
      }
    }

    const handlers = this.subscriptions.get(subject)!;
    handlers.add(handler);

    const subscriptionId = ++this.subscriptionCounter;
    this.logger.debug?.('Subscribed to subject', { subject, id: subscriptionId });

    return new HTTPSubscription(
      subscriptionId,
      subject,
      handler,
      this,
      this.logger
    );
  }

  async unsubscribeHandler(subject: string, handler: Handler): Promise<void> {
    const handlers = this.subscriptions.get(subject);
    if (!handlers) return;

    handlers.delete(handler);

    // If no more handlers for this subject, unsubscribe from server
    if (handlers.size === 0) {
      this.subscriptions.delete(subject);
      
      if (this.ws && this.ws.readyState === WebSocket.OPEN) {
        const message = {
          type: 'unsubscribe',
          subject: subject
        };
        this.ws.send(JSON.stringify(message));
        this.logger.debug?.('Sent unsubscribe message', { subject });
      }
    }
  }

  async close(): Promise<void> {
    this.shouldReconnect = false;
    
    if (this.reconnectTimer) {
      clearTimeout(this.reconnectTimer);
      this.reconnectTimer = null;
    }

    if (this.ws) {
      this.ws.close(1000, 'Client closing');
      this.ws = null;
    }

    this.subscriptions.clear();
    this.logger.log('HTTP message bus connection closed');
  }

  asNATS(): any {
    return null; // HTTP backend doesn't provide NATS connection
  }
}

/**
 * HTTP subscription wrapper
 */
class HTTPSubscription implements Subscription {
  constructor(
    private id: number,
    private subject: string,
    private handler: Handler,
    private backend: HTTPBackend,
    private logger: Console
  ) {}

  async unsubscribe(): Promise<void> {
    await this.backend.unsubscribeHandler(this.subject, this.handler);
    this.logger.debug?.('Unsubscribed from subject', { subject: this.subject, id: this.id });
  }

  async drain(): Promise<void> {
    // For HTTP backend, drain is equivalent to unsubscribe
    await this.unsubscribe();
  }
}