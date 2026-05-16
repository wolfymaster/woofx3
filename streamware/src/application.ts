import type { ApplicationContext, IApplication, ServicesRegistry } from "@woofx3/common/runtime";
import type { SharedLogger } from "@woofx3/common/logging";
import type { DbClient } from "./db";
import { AlertBroadcaster } from "./alert-broadcaster";
import { AlertQueueManager } from "./alert-queue-manager";
import { StorageBroadcaster } from "./storage-broadcaster";
import type { StreamwareRuntimeConfig } from "./config";

export type StreamwareServices = ServicesRegistry & {
  db: DbClient | null;
  messageBus: unknown;
  obs: unknown;
  alertBroadcaster: AlertBroadcaster;
  alertQueue: AlertQueueManager | null;
  storageBroadcaster: StorageBroadcaster;
};

export type StreamwareContext = {
  alertBroadcaster: AlertBroadcaster;
  storageBroadcaster: StorageBroadcaster;
  alertQueue: AlertQueueManager | null;
  config: StreamwareRuntimeConfig;
};

export type StreamwareAppContext = ApplicationContext<StreamwareContext, StreamwareServices>;

export default class Streamware implements IApplication<StreamwareContext, StreamwareServices> {
  readonly context: StreamwareContext;

  constructor() {
    this.context = {
      alertBroadcaster: {} as AlertBroadcaster,
      storageBroadcaster: {} as StorageBroadcaster,
      alertQueue: null,
      config: {} as StreamwareRuntimeConfig,
    } as StreamwareContext;
  }

  async run(ctx: StreamwareAppContext): Promise<void> {
    // The actual initialization is done in server.ts main()
    // This method exists to satisfy IApplication interface
    ctx.logger.info("Streamware application run called");
  }
}