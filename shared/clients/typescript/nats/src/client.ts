import type { NatsConnection, Subscription } from "@nats-io/nats-core";
import { jwtAuthenticator, wsconnect } from "@nats-io/nats-core";
import { MessageImpl } from "./msg";
import type { Handler, Logger, NATSConfig } from "./types";

export default class NATSClient {
	private connection: NatsConnection | null = null;
	private logger: Logger;

	constructor(
		private config: NATSConfig,
		logger?: Logger,
	) {
		this.logger = logger || console;
	}

	async connect(): Promise<void> {
		if (this.connection) {
			return;
		}
		try {
			const options: any = {
				name: this.config.name,
				servers: this.config.url,
			};

			// Add JWT authentication if provided
			if (this.config.jwt && this.config.nkeySeed) {
				const authenticator = jwtAuthenticator(
					this.config.jwt,
					Buffer.from(this.config.nkeySeed),
				);
				options.authenticator = authenticator;
			}

			this.connection = await wsconnect(options);
			this.logger.info("Connected to NATS", {
				url: options.servers,
				name: options.name,
			});
		} catch (error) {
			this.logger.error("Failed to connect to NATS:", error);
			throw error;
		}
	}

	async publish(subject: string, data: Uint8Array): Promise<void> {
		if (!this.connection) {
			await this.connect();
		}

		if (!this.connection) {
			throw new Error("NATS connection not available");
		}

		this.connection.publish(subject, data);
		this.logger.debug?.("Published message", { subject, size: data.length });
	}

	async subscribe(subject: string, handler: Handler): Promise<Subscription> {
		if (!this.connection) {
			await this.connect();
		}

		if (!this.connection) {
			throw new Error("NATS connection not available");
		}

		// Create subscription using correct NATS API
		const subscription = this.connection.subscribe(subject);
		this.logger.debug?.("Subscribed to subject", { subject });

		// Start consuming messages asynchronously
		(async () => {
			try {
				for await (const msg of subscription) {
					const wrappedMsg = new MessageImpl(msg.subject, msg.data);
					handler(wrappedMsg);
				}
			} catch (error) {
				this.logger.error?.("Subscription error:", error);
			}
		})();

		return subscription;
	}

	async close(): Promise<void> {
		if (this.connection) {
			await this.connection.close();
			this.connection = null;
			this.logger.info("NATS connection closed");
		}
	}

	asNATS(): NatsConnection | null {
		return this.connection;
	}
}
