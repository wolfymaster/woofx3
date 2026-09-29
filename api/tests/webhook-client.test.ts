import { describe, expect, it, mock } from "bun:test";
import { WebhookClient } from "../src/webhook-client";

function fakeLogger() {
  return {
    debug: mock(() => {}),
    info: mock(() => {}),
    warn: mock(() => {}),
    error: mock(() => {}),
  } as any;
}

function fakeDb(clients: any[] = []) {
  return { listClients: mock(async () => ({ clients })) } as any;
}

describe("WebhookClient", () => {
  it("does not read clients until asked to refresh", () => {
    const db = fakeDb();
    new WebhookClient(db, fakeLogger());
    expect(db.listClients).not.toHaveBeenCalled();
  });

  it("refreshCallbackUrls lists every client and sends only to those with a callback", async () => {
    const db = fakeDb([
      { clientId: "c1", description: "d", callbackUrl: "http://x", callbackToken: "" },
      { clientId: "c2", description: "headless", callbackUrl: "", callbackToken: "" },
    ]);
    const logger = fakeLogger();
    const wc = new WebhookClient(db, logger);
    await wc.refreshCallbackUrls();
    expect(db.listClients).toHaveBeenCalledWith();
    expect(logger.info).toHaveBeenCalledWith("Webhook callback URLs refreshed", { count: 1 });
  });
});
