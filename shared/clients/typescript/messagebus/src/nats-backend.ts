import { jwtAuthenticator, wsconnect, type NatsConnection, Msg as NatsMsg } from '@nats-io/transport-node';
import { MessageBus, Subscription, Handler, SubscribeOptions, NATSConfig } from './types';
import { MessageImpl } from './msg';

/**
 * NATS backend implementation
 */
export class NATSBackend implements MessageBus {
  private connection: NatsConnection | null = null;
  private logger: Console;

  constructor(
    private config: NATSConfig,
    logger?: Console
  ) {
    this.logger = logger || console;
  }

  async connect(): Promise<void> {
    if (this.connection) {
      return;
    }

    try {
      const options: any = {
        name: this.config.name || 'messagebus-client',
        servers: this.config.url || 'tls://connect.ngs.global'
      };

      // Add JWT authentication if provided
      if (this.config.jwt && this.config.nkeySeed) {
        const authenticator = jwtAuthenticator(
          this.config.jwt,
          Buffer.from(this.config.nkeySeed)
        );
        options.authenticator = authenticator;
      }

      this.connection = await wsconnect(options);
      this.logger.log('Connected to NATS', { url: options.servers, name: options.name });
    } catch (error) {
      this.logger.error('Failed to connect to NATS:', error);
      throw error;
    }
  }

  async publish(subject: string, data: Uint8Array): Promise<void> {
    if (!this.connection) {
      await this.connect();
    }

    if (!this.connection) {
      throw new Error('NATS connection not available');
    }

    this.connection.publish(subject, data);
    this.logger.debug?.('Published message', { subject, size: data.length });
  }

  async subscribe(subject: string, handler: Handler, opts?: SubscribeOptions): Promise<Subscription> {
    if (!this.connection) {
      await this.connect();
    }

    if (!this.connection) {
      throw new Error('NATS connection not available');
    }

    // Wrap the handler to convert NATS messages to our interface
    const natsHandler = (msg: NatsMsg) => {
      const wrappedMsg = new MessageImpl(msg.subject, msg.data);
      handler(wrappedMsg);
    };

    const subscription = this.connection.subscribe(subject, natsHandler);
    this.logger.debug?.('Subscribed to subject', { subject });

    return new NATSSubscription(subscription, this.logger);
  }

  async close(): Promise<void> {
    if (this.connection) {
      await this.connection.close();
      this.connection = null;
      this.logger.log('NATS connection closed');
    }
  }

  asNATS(): NatsConnection | null {
    return this.connection;
  }
}

/**
 * NATS subscription wrapper
 */
class NATSSubscription implements Subscription {
  constructor(
    private natsSubscription: any,
    private logger: Console
  ) {}

  async unsubscribe(): Promise<void> {
    if (this.natsSubscription) {
      this.natsSubscription.unsubscribe();
      this.logger.debug?.('Unsubscribed from subject');
    }
  }

  async drain(): Promise<void> {
    if (this.natsSubscription && this.natsSubscription.drain) {
      await this.natsSubscription.drain();
      this.logger.debug?.('Drained subscription');
    } else {
      // Fallback to unsubscribe if drain not available
      await this.unsubscribe();
    }
  }
}