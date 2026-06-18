import type { ApplicationContext, IApplication, ServicesRegistry } from "@woofx3/common/runtime";
import type { SharedLogger } from "@woofx3/common/logging";
import type { DbClient } from "./db";
import { EventBroadcaster } from "./events/broadcaster";
import { EventQueueManager } from "./events/queue-manager";
import { StorageBroadcaster } from "./storage/broadcaster";
import type { StreamwareRuntimeConfig } from "./config";

export type StreamwareServices = ServicesRegistry & {
  db: DbClient | null;
  messageBus: unknown;
  obs: unknown;
  eventBroadcaster: EventBroadcaster;
  eventQueue: EventQueueManager | null;
  storageBroadcaster: StorageBroadcaster;
};

export type StreamwareContext = {
  eventBroadcaster: EventBroadcaster;
  storageBroadcaster: StorageBroadcaster;
  eventQueue: EventQueueManager | null;
  config: StreamwareRuntimeConfig;
};

export type StreamwareAppContext = ApplicationContext<StreamwareContext, StreamwareServices>;

export default class Streamware implements IApplication<StreamwareContext, StreamwareServices> {
  readonly context: StreamwareContext;

  constructor() {
    this.context = {
      eventBroadcaster: {} as EventBroadcaster,
      storageBroadcaster: {} as StorageBroadcaster,
      eventQueue: null,
      config: {} as StreamwareRuntimeConfig,
    } as StreamwareContext;
  }

  async run(ctx: StreamwareAppContext): Promise<void> {
    ctx.logger.info("Streamware application run called");
  }
}
