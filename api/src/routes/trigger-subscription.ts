import { holdStub, onStubBroken, releaseStub } from "../held-stub";
import { routeModule } from "./context";

export const triggerSubscriptionRoutes = routeModule({
  async subscribeTriggerChanges(
    callback: {
      onTriggerChange(event: { type: string; moduleName: string }): Promise<void>;
    },
    context?: { session: object; clientId: string }
  ): Promise<void> {
    const held = holdStub(callback);
    this.triggerSubscribers.set(held, { session: context?.session ?? held, clientId: context?.clientId ?? null });
    onStubBroken(held, () => {
      if (this.triggerSubscribers.delete(held)) {
        releaseStub(held);
      }
    });
  },
});
