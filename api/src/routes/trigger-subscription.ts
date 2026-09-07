export const triggerSubscriptionRoutes = {
  async subscribeTriggerChanges(callback: {
    onTriggerChange(event: { type: string; moduleName: string }): Promise<void>;
  }): Promise<void> {
    this.triggerSubscribers.add(callback);
  }
};
