import { holdStub, onStubBroken, releaseStub } from "../held-stub";
import { routeModule } from "./context";

export const triggerSubscriptionRoutes = routeModule({
  async subscribeTriggerChanges(
    callback: {
      onTriggerChange(event: { type: string; moduleName: string }): Promise<void>;
    },
    context?: { session: object }
  ): Promise<void> {
    const held = holdStub(callback);
    this.triggerSubscribers.set(held, context?.session ?? held);
    onStubBroken(held, () => {
      if (this.triggerSubscribers.delete(held)) {
        releaseStub(held);
      }
    });
  },
});
