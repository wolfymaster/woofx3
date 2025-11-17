import type { Service } from "@woofx3/common/runtime";
import type NATSClient from "@woofx3/nats/src/client";

export default class MessageBusService implements Service<NATSClient> {
  name: string;
  type: string;
  client: NATSClient;
  connected: boolean;

  constructor(client: NATSClient) {
    this.name = 'messageBus';
    this.type = 'nats';
    this.client = client;
    this.connected = false;
  }

  async connect(): Promise<void> {
    await this.client.connect();
    this.connected = true;
  }
  
  async disconnect(): Promise<void> { 
    await this.client.close();
    this.connected = false;
  }
}
