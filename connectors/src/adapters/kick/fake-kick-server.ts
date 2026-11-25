// A fake api.kick.com for tests: the routes the Kick adapter calls, backed by
// in-memory state a test can read and change, with any route replaceable by
// a scripted answer. Shapes follow https://api.kick.com/swagger/doc.json.

import type { Server } from "bun";

export interface FakeKickRequest {
  method: string;
  path: string;
  query: URLSearchParams;
  headers: Headers;
  body: unknown;
}

export type FakeKickHandler = (request: FakeKickRequest) => Response | Promise<Response>;

export interface FakeKickSubscription {
  id: string;
  event: string;
  version: number;
  created_at: string;
}

export interface FakeKickChannel {
  broadcaster_user_id: number;
  slug: string;
  stream_title: string;
  channel_description: string;
  category: { id: number; name: string } | null;
  stream: {
    is_live: boolean;
    start_time: string | null;
    viewer_count: number;
    language: string;
    custom_tags: string[];
  };
}

export interface FakeKickState {
  /** Bearer tokens the fake accepts; any other is answered 401. */
  validTokens: Set<string>;
  /** The token's own user. */
  self: { user_id: number; name: string; profile_picture: string };
  /** Other users, found by id. */
  users: { user_id: number; name: string; profile_picture: string }[];
  channels: FakeKickChannel[];
  categories: { id: number; name: string }[];
  rewards: { id: string; title: string; cost: number; description: string; is_enabled: boolean }[];
  subscriptions: FakeKickSubscription[];
  /** Events whose subscription create answers this error instead of creating one. */
  refusedEvents: Map<string, string>;
  publicKeyPem: string;
  chat: { content: string; broadcaster_user_id: number; reply_to_message_id?: string; message_id: string }[];
  bans: { broadcaster_user_id: number; user_id: number; duration?: number; reason?: string }[];
  deletedMessages: string[];
}

export interface FakeKickServer {
  url: string;
  state: FakeKickState;
  requests: FakeKickRequest[];
  /** Answer `method path` with `handler` instead of the default. */
  route(method: string, path: string, handler: FakeKickHandler): void;
  stop(): Promise<void>;
}

export function kickJson(data: unknown, status = 200, headers: Record<string, string> = {}): Response {
  return Response.json({ data, message: "OK" }, { status, headers });
}

export function kickError(status: number, message: string, data?: unknown): Response {
  return Response.json(data === undefined ? { message } : { data, message }, { status });
}

function defaultState(): FakeKickState {
  return {
    validTokens: new Set(["token-1"]),
    self: { user_id: 4242, name: "wolfy", profile_picture: "https://files.kick.com/wolfy.png" },
    users: [{ user_id: 777, name: "Pup_Pal", profile_picture: "https://files.kick.com/pup.png" }],
    channels: [
      {
        broadcaster_user_id: 4242,
        slug: "wolfy",
        stream_title: "cozy stream",
        channel_description: "a den",
        category: { id: 15, name: "Just Chatting" },
        stream: { is_live: false, start_time: null, viewer_count: 0, language: "en", custom_tags: [] },
      },
      {
        broadcaster_user_id: 777,
        slug: "pup-pal",
        stream_title: "pup stream",
        channel_description: "",
        category: { id: 101, name: "Minecraft" },
        stream: {
          is_live: true,
          start_time: "2026-11-25T09:00:00Z",
          viewer_count: 12,
          language: "en",
          custom_tags: ["cozy"],
        },
      },
    ],
    categories: [
      { id: 15, name: "Just Chatting" },
      { id: 101, name: "Minecraft" },
      { id: 102, name: "Minecraft Dungeons" },
    ],
    rewards: [{ id: "01REWARD", title: "Hydrate", cost: 100, description: "drink water", is_enabled: true }],
    subscriptions: [],
    refusedEvents: new Map(),
    publicKeyPem: "",
    chat: [],
    bans: [],
    deletedMessages: [],
  };
}

export function startFakeKick(): FakeKickServer {
  const state = defaultState();
  const requests: FakeKickRequest[] = [];
  const overrides = new Map<string, FakeKickHandler>();
  let ids = 0;
  const nextId = (prefix: string) => `${prefix}${String(++ids).padStart(4, "0")}`;

  const authorized = (request: FakeKickRequest): boolean => {
    const header = request.headers.get("authorization") ?? "";
    return header.startsWith("Bearer ") && state.validTokens.has(header.slice("Bearer ".length));
  };

  const defaults: Record<string, FakeKickHandler> = {
    "GET /public/v1/users": (request) => {
      const ids = request.query.getAll("id").map(Number);
      if (ids.length === 0) {
        return kickJson([state.self]);
      }
      return kickJson([state.self, ...state.users].filter((u) => ids.includes(u.user_id)));
    },
    "GET /public/v1/channels": (request) => {
      const ids = request.query.getAll("broadcaster_user_id").map(Number);
      const slugs = request.query.getAll("slug");
      if (ids.length === 0 && slugs.length === 0) {
        return kickJson(state.channels.filter((c) => c.broadcaster_user_id === state.self.user_id));
      }
      return kickJson(state.channels.filter((c) => ids.includes(c.broadcaster_user_id) || slugs.includes(c.slug)));
    },
    "PATCH /public/v1/channels": (request) => {
      const body = request.body as { stream_title?: string; category_id?: number; custom_tags?: string[] };
      const own = state.channels.find((c) => c.broadcaster_user_id === state.self.user_id);
      if (own !== undefined) {
        own.stream_title = body.stream_title ?? own.stream_title;
        own.category = state.categories.find((c) => c.id === body.category_id) ?? own.category;
        own.stream.custom_tags = body.custom_tags ?? own.stream.custom_tags;
      }
      return new Response(null, { status: 204 });
    },
    "GET /public/v2/categories": (request) => {
      const names = request.query.getAll("name[]").map((n) => n.toLowerCase());
      return kickJson(state.categories.filter((c) => names.some((n) => c.name.toLowerCase().includes(n))));
    },
    "POST /public/v1/chat": (request) => {
      const body = request.body as { content: string; broadcaster_user_id: number; reply_to_message_id?: string };
      const messageId = nextId("msg-");
      state.chat.push({ ...body, message_id: messageId });
      return kickJson({ is_sent: true, message_id: messageId });
    },
    "POST /public/v1/moderation/bans": (request) => {
      state.bans.push(request.body as FakeKickState["bans"][number]);
      return kickJson({});
    },
    "GET /public/v1/channels/rewards": () => kickJson(state.rewards),
    "GET /public/v1/events/subscriptions": () => kickJson(state.subscriptions),
    "POST /public/v1/events/subscriptions": (request) => {
      const body = request.body as { events: { name: string; version: number }[] };
      return kickJson(
        body.events.map(({ name, version }) => {
          const refusal = state.refusedEvents.get(name);
          if (refusal !== undefined) {
            return { name, version, subscription_id: null, error: refusal };
          }
          const id = nextId("01SUB");
          state.subscriptions.push({ id, event: name, version, created_at: new Date(ids * 1000).toISOString() });
          return { name, version, subscription_id: id, error: null };
        })
      );
    },
    "DELETE /public/v1/events/subscriptions": (request) => {
      const ids = new Set(request.query.getAll("id"));
      state.subscriptions = state.subscriptions.filter((s) => !ids.has(s.id));
      return new Response(null, { status: 204 });
    },
    "GET /public/v1/public-key": () => kickJson({ public_key: state.publicKeyPem }),
  };

  const server: Server<undefined> = Bun.serve({
    port: 0,
    async fetch(raw) {
      const url = new URL(raw.url);
      const text = await raw.text();
      const request: FakeKickRequest = {
        method: raw.method,
        path: url.pathname,
        query: url.searchParams,
        headers: raw.headers,
        body: text === "" ? undefined : JSON.parse(text),
      };
      requests.push(request);
      const key = `${request.method} ${request.path}`;
      const override = overrides.get(key);
      if (override !== undefined) {
        return override(request);
      }
      if (request.path !== "/public/v1/public-key" && !authorized(request)) {
        return kickError(401, "Unauthorized");
      }
      if (request.method === "DELETE" && request.path.startsWith("/public/v1/chat/")) {
        state.deletedMessages.push(decodeURIComponent(request.path.slice("/public/v1/chat/".length)));
        return new Response(null, { status: 204 });
      }
      const handler = defaults[key];
      return handler === undefined ? kickError(404, `no route ${key}`) : handler(request);
    },
  });

  return {
    url: `http://127.0.0.1:${server.port}`,
    state,
    requests,
    route(method, path, handler) {
      overrides.set(`${method} ${path}`, handler);
    },
    async stop() {
      await server.stop(true);
    },
  };
}
