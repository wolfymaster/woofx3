/**
 * Example usage of the TypeScript message bus client
 * Shows compatibility with existing NATS usage patterns
 */
import { Handler } from './index';
declare class ExampleApp {
    private bus;
    private subscriptions;
    initialize(): Promise<void>;
    setupSubscriptions(): Promise<void>;
    publishEvent(eventType: string, data: any): Promise<void>;
    cleanup(): Promise<void>;
    getNATSConnection(): any;
}
declare function exampleUsage(): Promise<void>;
export declare function adaptNatsMessageHandler<T>(callback: (command: string, args: T) => void): Handler;
declare function compatibilityExample(): Promise<void>;
export { ExampleApp, exampleUsage, compatibilityExample };
