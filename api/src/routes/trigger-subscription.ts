import { routeModule } from "./context";
export const triggerSubscriptionRoutes = routeModule({
  async subscribeTriggerChanges(callback: {
    onTriggerChange(event: { type: string; moduleName: string }): Promise<void>;
  }): Promise<void> {
    this.triggerSubscribers.add(callback);
  }
});
