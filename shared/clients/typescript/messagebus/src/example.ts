/**
 * Example usage of the TypeScript message bus client
 * Shows compatibility with existing NATS usage patterns
 */

import { fromEnv, Handler, MessageBus } from './index';

// Handler compatible with existing NATS patterns
const workflowHandler: Handler = (msg) => {
  console.log('Received workflow event:', {
    subject: msg.subject,
    data: msg.string(),
    parsed: msg.json()
  });
};

// Example app similar to existing streamlabs/nats.ts patterns
class ExampleApp {
  private bus: MessageBus | null = null;
  private subscriptions: any[] = [];

  async initialize(): Promise<void> {
    // Automatically detect backend from environment
    this.bus = await fromEnv(console);
  }

  async setupSubscriptions(): Promise<void> {
    if (!this.bus) throw new Error('Bus not initialized');

    // Subscribe to workflow events (same pattern as existing code)
    const workflowSub = await this.bus.subscribe('workflow.>', workflowHandler);
    this.subscriptions.push(workflowSub);

    // Subscribe to specific events
    const startedSub = await this.bus.subscribe('workflow.started', (msg) => {
      const { command, args } = msg.json();
      console.log('Workflow started:', command, args);
    });
    this.subscriptions.push(startedSub);

    console.log('Subscriptions established');
  }

  async publishEvent(eventType: string, data: any): Promise<void> {
    if (!this.bus) throw new Error('Bus not initialized');

    const subject = `workflow.${eventType}`;
    const payload = JSON.stringify(data);
    const bytes = new TextEncoder().encode(payload);

    await this.bus.publish(subject, bytes);
    console.log(`Published event: ${subject}`);
  }

  async cleanup(): Promise<void> {
    // Unsubscribe from all subscriptions
    for (const sub of this.subscriptions) {
      await sub.unsubscribe();
    }
    this.subscriptions = [];

    // Close the bus
    if (this.bus) {
      await this.bus.close();
      this.bus = null;
    }

    console.log('Cleanup complete');
  }

  // Get underlying NATS connection if needed (for compatibility)
  getNATSConnection(): any {
    return this.bus?.asNATS() || null;
  }
}

// Usage example that's compatible with existing patterns
async function exampleUsage(): Promise<void> {
  const app = new ExampleApp();
  
  try {
    // Initialize (replaces existing NatsClient() calls)
    await app.initialize();
    
    // Set up subscriptions (same pattern as existing code)
    await app.setupSubscriptions();
    
    // Publish some test events
    await app.publishEvent('started', { id: '123', name: 'Test Workflow' });
    await app.publishEvent('completed', { id: '123', result: 'success' });
    
    // Wait a bit for message processing
    await new Promise(resolve => setTimeout(resolve, 1000));
    
  } finally {
    // Clean up resources
    await app.cleanup();
  }
}

// Migration helper for existing natsMessageHandler usage
export function adaptNatsMessageHandler<T>(
  callback: (command: string, args: T) => void
): Handler {
  return (msg) => {
    try {
      const { command, args } = msg.json<{ command: string; args: T }>();
      callback(command, args);
    } catch (error) {
      console.error('Failed to parse message:', error);
    }
  };
}

// Example of using the migration helper
async function compatibilityExample(): Promise<void> {
  const bus = await fromEnv();
  
  // This matches the existing natsMessageHandler pattern
  const handler = adaptNatsMessageHandler<any>((command, args) => {
    console.log('Command:', command);
    console.log('Args:', args);
  });
  
  await bus.subscribe('commands.>', handler);
}

export { ExampleApp, exampleUsage, compatibilityExample };