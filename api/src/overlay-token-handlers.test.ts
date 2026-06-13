import { describe, expect, it, mock } from "bun:test";
import { initOverlayTokenHandlers } from "./overlay-token-handlers";

// ---------------------------------------------------------------------------
// Test infrastructure: minimal stubs for NATSClient and WebhookClient
// ---------------------------------------------------------------------------

const noopLogger = {
  debug: () => {},
  info: () => {},
  warn: () => {},
  error: () => {},
  child: () => noopLogger,
  withContext: () => noopLogger,
} as any;

/**
 * A minimal fake NATSClient that stores registered handlers so tests can
 * fire them directly without a real NATS connection.
 */
class FakeNatsClient {
  private handlers: Map<string, ((msg: { data: Uint8Array; subject: string }) => void | Promise<void>)> = new Map();

  async subscribe(
    subject: string,
    handler: (msg: { data: Uint8Array; subject: string }) => void | Promise<void>
  ): Promise<void> {
    this.handlers.set(subject, handler);
  }

  async publish(_subject: string, _data: Uint8Array): Promise<void> {}

  async request(_subject: string, _data: Uint8Array): Promise<{ data: Uint8Array; subject: string }> {
    return { data: new Uint8Array(), subject: "" };
  }

  /** Fire a message on a registered subscription for testing. */
  async dispatch(subject: string, data: Record<string, unknown>): Promise<void> {
    // Find the best-matching handler (wildcard support for *.suffix).
    for (const [pattern, handler] of this.handlers) {
      if (subjectMatchesPattern(pattern, subject)) {
        await handler({ data: new TextEncoder().encode(JSON.stringify(data)), subject });
        return;
      }
    }
    throw new Error(`No handler registered for subject: ${subject}`);
  }
}

/** Simple NATS wildcard matcher: * matches a single token. */
function subjectMatchesPattern(pattern: string, subject: string): boolean {
  const patternParts = pattern.split(".");
  const subjectParts = subject.split(".");
  if (patternParts.length !== subjectParts.length) {
    return false;
  }
  for (let i = 0; i < patternParts.length; i++) {
    if (patternParts[i] !== "*" && patternParts[i] !== subjectParts[i]) {
      return false;
    }
  }
  return true;
}

class FakeWebhookClient {
  public sentEvents: Array<{ type: string; [key: string]: unknown }> = [];

  async send(event: { type: string; [key: string]: unknown }): Promise<void> {
    this.sentEvents.push(event);
  }

  // Stub methods required by the real WebhookClient interface.
  setApplicationId(_id: string): void {}
  async refreshCallbackUrls(): Promise<void> {}
}

// ---------------------------------------------------------------------------
// OVERLAY_TOKEN_MINTED
// ---------------------------------------------------------------------------

describe("initOverlayTokenHandlers - OVERLAY_TOKEN_MINTED", () => {
  it("emits OVERLAY_TOKEN_MINTED when db.overlay_token.created.* fires", async () => {
    const nats = new FakeNatsClient();
    const webhook = new FakeWebhookClient();
    await initOverlayTokenHandlers(nats as any, webhook as any, noopLogger);

    await nats.dispatch("db.overlay_token.created.app-1", {
      id: "tok-id-1",
      token: "ovl_abcdefghijklmnop",
      scene_id: "scene-1",
      application_id: "app-1",
      label: "OBS Main",
      status: "active",
    });

    expect(webhook.sentEvents).toHaveLength(1);
    const event = webhook.sentEvents[0]!;
    expect(event.type).toBe("overlay.token.minted");
    expect(event.tokenId).toBe("tok-id-1");
    expect(event.sceneId).toBe("scene-1");
    expect(event.applicationId).toBe("app-1");
    expect(event.label).toBe("OBS Main");
  });

  it("webhook payload does NOT contain the plaintext token field", async () => {
    const nats = new FakeNatsClient();
    const webhook = new FakeWebhookClient();
    await initOverlayTokenHandlers(nats as any, webhook as any, noopLogger);

    await nats.dispatch("db.overlay_token.created.app-1", {
      id: "tok-id-2",
      token: "ovl_SUPERSECRETVALUE12345",
      scene_id: "scene-2",
      application_id: "app-1",
      label: "",
      status: "active",
    });

    expect(webhook.sentEvents).toHaveLength(1);
    const event = webhook.sentEvents[0]!;
    // The plaintext token must never appear in the webhook payload.
    expect("token" in event).toBe(false);
    // tokenPrefix is allowed — it is only the first 8 chars.
    expect(event.tokenPrefix).toBe("ovl_SUPE");
    expect((event.tokenPrefix as string).length).toBeLessThanOrEqual(8);
  });

  it("tokenPrefix is at most 8 characters", async () => {
    const nats = new FakeNatsClient();
    const webhook = new FakeWebhookClient();
    await initOverlayTokenHandlers(nats as any, webhook as any, noopLogger);

    await nats.dispatch("db.overlay_token.created.app-1", {
      id: "tok-id-3",
      token: "ovl_longerthan8chars_andmore",
      scene_id: "s",
      application_id: "a",
      label: "",
      status: "active",
    });

    const event = webhook.sentEvents[0]!;
    expect((event.tokenPrefix as string).length).toBeLessThanOrEqual(8);
  });

  it("skips webhook when event is missing id", async () => {
    const nats = new FakeNatsClient();
    const webhook = new FakeWebhookClient();
    await initOverlayTokenHandlers(nats as any, webhook as any, noopLogger);

    await nats.dispatch("db.overlay_token.created.app-1", {
      token: "ovl_sometoken",
      scene_id: "scene-1",
      application_id: "app-1",
      label: "",
      status: "active",
    });

    // No id → no webhook.
    expect(webhook.sentEvents).toHaveLength(0);
  });
});

// ---------------------------------------------------------------------------
// OVERLAY_TOKEN_REVOKED
// ---------------------------------------------------------------------------

describe("initOverlayTokenHandlers - OVERLAY_TOKEN_REVOKED", () => {
  it("emits OVERLAY_TOKEN_REVOKED when db.overlay_token.updated.* fires with status=revoked", async () => {
    const nats = new FakeNatsClient();
    const webhook = new FakeWebhookClient();
    await initOverlayTokenHandlers(nats as any, webhook as any, noopLogger);

    await nats.dispatch("db.overlay_token.updated.app-1", {
      id: "tok-id-4",
      token: "ovl_revokedtoken12345",
      scene_id: "scene-3",
      application_id: "app-1",
      label: "Revoked Label",
      status: "revoked",
    });

    expect(webhook.sentEvents).toHaveLength(1);
    const event = webhook.sentEvents[0]!;
    expect(event.type).toBe("overlay.token.revoked");
    expect(event.tokenId).toBe("tok-id-4");
    expect(event.sceneId).toBe("scene-3");
    expect(event.applicationId).toBe("app-1");
    expect(event.label).toBe("Revoked Label");
    // Plaintext token must not appear.
    expect("token" in event).toBe(false);
  });

  it("does NOT emit webhook for db.overlay_token.updated.* with non-revoked status", async () => {
    const nats = new FakeNatsClient();
    const webhook = new FakeWebhookClient();
    await initOverlayTokenHandlers(nats as any, webhook as any, noopLogger);

    // Simulate a lastUsedAt refresh update.
    await nats.dispatch("db.overlay_token.updated.app-1", {
      id: "tok-id-5",
      token: "ovl_activetoken",
      scene_id: "scene-4",
      application_id: "app-1",
      label: "Active",
      status: "active",
    });

    expect(webhook.sentEvents).toHaveLength(0);
  });

  it("webhook payload for revoked event does NOT contain plaintext token", async () => {
    const nats = new FakeNatsClient();
    const webhook = new FakeWebhookClient();
    await initOverlayTokenHandlers(nats as any, webhook as any, noopLogger);

    await nats.dispatch("db.overlay_token.updated.app-1", {
      id: "tok-id-6",
      token: "ovl_SECRETSECRET9999",
      scene_id: "scene-5",
      application_id: "app-1",
      label: "",
      status: "revoked",
    });

    const event = webhook.sentEvents[0]!;
    expect("token" in event).toBe(false);
    expect(event.tokenPrefix).toBe("ovl_SECR");
  });

  it("handles camelCase field names from db outbox", async () => {
    const nats = new FakeNatsClient();
    const webhook = new FakeWebhookClient();
    await initOverlayTokenHandlers(nats as any, webhook as any, noopLogger);

    await nats.dispatch("db.overlay_token.created.app-2", {
      id: "tok-camel",
      token: "ovl_cameltoken123",
      sceneId: "scene-camel",
      applicationId: "app-2",
      label: "Camel",
      status: "active",
    });

    const event = webhook.sentEvents[0]!;
    expect(event.sceneId).toBe("scene-camel");
    expect(event.applicationId).toBe("app-2");
  });
});
