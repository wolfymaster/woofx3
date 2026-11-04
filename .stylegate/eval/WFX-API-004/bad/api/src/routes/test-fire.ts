import type { Bus } from "../bus";

/** Prefixes only engine services may publish on. */
const ENGINE_PREFIXES = ["engine.", "platform.gateway.", "db.", "workflow.command.", "module.change."];

export type TestFireResult = { ok: true } | { ok: false; error: string };

export class TestFireRoutes {
  constructor(private readonly bus: Bus) {}

  /** Publishes a test event on the subject the dashboard names. */
  async triggerEvent(eventType: string, data: unknown): Promise<TestFireResult> {
    if (ENGINE_PREFIXES.some((prefix) => eventType.startsWith(prefix))) {
      return { ok: false, error: `${eventType} is reserved for the engine` };
    }
    await this.bus.publish(eventType, data);
    return { ok: true };
  }
}
