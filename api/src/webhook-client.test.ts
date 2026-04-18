import { describe, expect, it, mock } from "bun:test";
import { WebhookClient } from "./webhook-client";

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
  it("refreshCallbackUrls is a no-op when applicationId is null", async () => {
    const db = fakeDb();
    const wc = new WebhookClient(db, fakeLogger(), null);
    await wc.refreshCallbackUrls();
    expect(db.listClients).not.toHaveBeenCalled();
  });

  it("setApplicationId followed by refresh populates instances", async () => {
    const db = fakeDb([{ clientId: "c1", description: "d", callbackUrl: "http://x", callbackToken: "" }]);
    const wc = new WebhookClient(db, fakeLogger(), null);
    wc.setApplicationId("app-1");
    await wc.refreshCallbackUrls();
    expect(db.listClients).toHaveBeenCalledWith("app-1");
  });

  it("constructor with applicationId eagerly kicks off refresh", async () => {
    const db = fakeDb([{ clientId: "c1", description: "d", callbackUrl: "http://x", callbackToken: "" }]);
    const wc = new WebhookClient(db, fakeLogger(), "app-1");
    // Allow the constructor's un-awaited refreshCallbackUrls to settle.
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(db.listClients).toHaveBeenCalledWith("app-1");
    void wc; // suppress unused warning
  });
});
