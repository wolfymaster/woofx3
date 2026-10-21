import { holdStub, onStubBroken, releaseStub } from "../held-stub";
import { routeModule } from "./context";

export const triggerSubscriptionRoutes = routeModule({
  async subscribeTriggerChanges(callback: {
    onTriggerChange(event: { type: string; moduleName: string }): Promise<void>;
  }): Promise<void> {
    const held = holdStub(callback);
    this.triggerSubscribers.add(held);
    onStubBroken(held, () => {
      if (this.triggerSubscribers.delete(held)) {
        releaseStub(held);
      }
    });
  },
});
