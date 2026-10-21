// The SDK's mock host, as a widget author's test drives it.

import { WIDGET_CAPABILITIES } from "@woofx3/module-sdk";
import { createMockHost } from "@woofx3/module-sdk/src/preview/widget-preview";
import {
  drain,
  type HarnessFactory,
  type HarnessOptions,
  type HostHarness,
  INSTANCE_ID,
  MODULE_ID,
  RESOURCE_BASE_URL,
} from "./harness";

export const mockHarness: HarnessFactory = (options: HarnessOptions): HostHarness => {
  const files = options.files ?? {};
  const reports: Array<{ key: string; value: unknown }> = [];
  const completed: string[] = [];
  const mock = createMockHost({
    moduleId: MODULE_ID,
    instanceId: INSTANCE_ID,
    settings: options.settings ?? {},
    storage: options.storage ?? {},
    capabilities: options.storage === null ? WIDGET_CAPABILITIES.filter((c) => c !== "storage") : undefined,
    resourceBaseUrl: RESOURCE_BASE_URL,
    fetchFn: async (url) => {
      const body = files[new URL(url).pathname];
      return body === undefined ? new Response("missing", { status: 404 }) : new Response(body);
    },
  });
  mock.onReport((report) => reports.push({ key: report.key, value: report.value }));
  mock.onComplete((eventId) => completed.push(eventId));

  return {
    host: mock.host,
    ready: drain,
    settle: drain,
    deliver(event): void {
      mock.fireEvent({ ...event, source: "scene-manager", time: new Date().toISOString(), data: event.data ?? null });
    },
    setStorage(key, value): void {
      mock.setStorage(key, value);
    },
    setSettings(settings): void {
      mock.setSettings(settings);
    },
    reports,
    completed,
    dispose(): void {
      mock.reset();
    },
  };
};
