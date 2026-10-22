import { afterEach, describe, expect, mock, test } from "bun:test";
import { EngineRequestType } from "@woofx3/api/webhooks";
import { Api } from "../src/api";
import { ApiGateway } from "../src/gateway";
import { resolveRegistrationPolicy } from "../src/registration";
import { TwitchTokenSource } from "../src/twitch-token-source";
import { EngineEventStream } from "../src/engine-event-stream";
import { WebhookClient } from "../src/webhook-client";

/*
 * A desktop shell registers with its local engine as a dashboard client whose
 * callback URL is a loopback address, and answers `twitch.token.requested`
 * itself. Nothing on the registration or callback path may refuse such a URL.
 */

const GRANT = {
  userId: "42",
  accessToken: "from-the-shell",
  scope: ["chat:read"],
  expiresIn: 3600,
  obtainmentTimestamp: Date.now(),
  clientId: "desktop-app",
};

function fakeLogger() {
  return {
    debug: mock(() => {}),
    info: mock(() => {}),
    warn: mock(() => {}),
    error: mock(() => {}),
  } as never as ConstructorParameters<typeof ApiGateway>[3];
}

/** A clients table that hands back what was registered. */
function clientsDb() {
  const clients: { clientId: string; description: string; callbackUrl: string; callbackToken: string }[] = [];
  return {
    clients,
    createClient: mock(async (req: { description: string; callbackUrl: string; callbackToken: string }) => {
      const client = { clientId: "shell", clientSecret: "secret", ...req };
      clients.push(client);
      return { client };
    }),
    listClients: mock(async () => ({ clients })),
  };
}

let server: ReturnType<typeof Bun.serve> | null = null;

afterEach(() => {
  server?.stop(true);
  server = null;
});

/** A shell listening on 127.0.0.1 that answers every request with `answer`, recording what it got. */
function loopbackShell(answer: unknown) {
  const received: { authorization: string | null; body: unknown }[] = [];
  server = Bun.serve({
    hostname: "127.0.0.1",
    port: 0,
    async fetch(req) {
      received.push({ authorization: req.headers.get("authorization"), body: await req.json() });
      return Response.json(answer);
    },
  });
  return { url: `http://127.0.0.1:${server.port}/engine/callback`, received };
}

async function registerShell(callbackUrl: string) {
  const db = clientsDb();
  const logger = fakeLogger();
  const api = new Api({
    db: db as never,
    nats: null,
    functions: null,
    barkloaderUrl: "http://b",
    sceneManagerUrl: "http://scene.test",
    apiUrl: "http://api.test",
    logger,
  });
  const gateway = new ApiGateway(api, {} as never, db as never, logger, resolveRegistrationPolicy({}));
  const webhooks = new WebhookClient(db as never, logger, new EngineEventStream(logger));
  gateway.setWebhookClient(webhooks);
  const registered = await gateway.registerClient("desktop shell", { callbackUrl, callbackToken: "shell-token" });
  return { db, webhooks, registered };
}

describe("a dashboard client with a loopback callback URL", () => {
  test("is registered with its callback URL unchanged", async () => {
    const url = "http://127.0.0.1:41234/engine/callback";
    const { db, webhooks, registered } = await registerShell(url);

    expect(registered.clientId).toBe("shell");
    expect(db.createClient).toHaveBeenCalledWith({
      description: "desktop shell",
      callbackUrl: url,
      callbackToken: "shell-token",
      kind: "CLIENT_KIND_REGISTERED",
      origin: "",
    });
    expect(webhooks.clientIds()).toEqual(["shell"]);
  });

  test("is asked for the Twitch token at that URL, with its callback token", async () => {
    const shell = loopbackShell({ token: GRANT });
    const { webhooks } = await registerShell(shell.url);

    const answer = await webhooks.request({ type: EngineRequestType.TWITCH_TOKEN_REQUESTED }, "shell");

    expect(answer).toEqual({ token: GRANT });
    expect(shell.received).toHaveLength(1);
    expect(shell.received[0].authorization).toBe("Bearer shell-token");
    expect((shell.received[0].body as { type: string }).type).toBe(EngineRequestType.TWITCH_TOKEN_REQUESTED);
  });

  test("renews a token it sent through TwitchTokenSource like any dashboard", async () => {
    const renewed = { ...GRANT, accessToken: "renewed-by-the-shell" };
    const shell = loopbackShell({ token: renewed });
    const { webhooks } = await registerShell(shell.url);
    let stored: string | null = JSON.stringify({ ...GRANT, dashboardClientId: "shell" });
    const settings = {
      getSetting: async () => stored,
      setSetting: async (_key: string, value: string) => {
        stored = value;
      },
    };
    const source = new TwitchTokenSource({
      db: settings,
      dashboard: () => webhooks,
      ownClientId: null,
      onLinkChanged: () => {},
      publicClient: {
        refresh: async () => {
          throw new Error("this test has no public Twitch app");
        },
      },
    });

    expect(await source.dashboardToken(true)).toEqual(renewed);
    expect(JSON.parse(stored ?? "null")).toEqual({ ...renewed, dashboardClientId: "shell" });
  });
});
