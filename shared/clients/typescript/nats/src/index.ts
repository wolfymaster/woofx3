import Client from "./client";
import type { Logger, NATSConfig } from "./types";

export async function createMessageBus(c: NATSConfig, logger?: Logger) {
	const client = new Client(c, logger);
	return client;
}
