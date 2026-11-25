import type { z } from "zod";
import type { Clock } from "../../../host/deps";
import {
  KickCategoryWireSchema,
  KickChannelWireSchema,
  KickEnvelopeSchema,
  KickErrorBodySchema,
  KickPublicKeyWireSchema,
  KickRewardWireSchema,
  KickSentChatWireSchema,
  KickSubscribeOutcomeWireSchema,
  KickSubscriptionWireSchema,
  KickUserWireSchema,
} from "./kick-schemas";
import type { KickTokenClient } from "./token";

export interface KickUser {
  userId: string;
  name: string;
  profilePicture: string | null;
}

export interface KickChannel {
  broadcasterUserId: string;
  slug: string;
  description: string;
  title: string;
  category: KickCategory | null;
  stream: {
    isLive: boolean;
    /** RFC 3339, null when not live or Kick did not say. */
    startedAt: string | null;
    viewerCount: number;
    language: string | null;
    tags: string[];
  };
}

export interface KickCategory {
  id: number;
  name: string;
}

export interface KickReward {
  id: string;
  title: string;
  cost: number;
  description: string;
  isEnabled: boolean;
}

export interface KickSubscription {
  id: string;
  event: string;
  version: number;
  /** RFC 3339. */
  createdAt: string;
}

export interface KickSubscribeOutcome {
  name: string;
  version: number;
  /** Set when Kick created the subscription. */
  subscriptionId: string | null;
  /** Kick's reason when it did not. */
  error: string | null;
}

export interface KickEventName {
  name: string;
  version: number;
}

/**
 * Why a call produced no result:
 * - http: Kick answered with an error status; `code` is its machine code when the body had one;
 * - timeout: the request was sent and no answer came in time, so Kick may have acted;
 * - stopped: the adapter run stopped while the request was out, so Kick may have acted;
 * - unreachable: the request never left (no connection, or no token to send);
 * - not_linked: no Kick account is linked, or the link has to be renewed by relinking;
 * - malformed: Kick answered 2xx with a body that is not the documented shape.
 */
export type KickApiFailure =
  | { kind: "http"; status: number; code: string | undefined; message: string; retryAfterMs: number | undefined }
  | { kind: "timeout" }
  | { kind: "stopped" }
  | { kind: "unreachable"; detail: string }
  | { kind: "not_linked" }
  | { kind: "malformed"; detail: string };

export type KickResult<T> = { ok: true; value: T } | { ok: false; error: KickApiFailure };

export interface KickApiDeps {
  fetch: typeof fetch;
  token: Pick<KickTokenClient, "get">;
  clock: Clock;
  /** Where api.kick.com is; a fake Kick server in tests. */
  baseUrl: string;
  /** How long one attempt may wait for Kick's answer. */
  timeoutMs: number;
  /** How long one attempt may wait for the api to hand over the token. */
  tokenTimeoutMs: number;
  /** Cloudflare in front of api.kick.com refuses clients without a browser-like user agent. */
  userAgent: string;
  /** Aborts every call in flight, when the adapter run stops. */
  signal: AbortSignal;
}

/**
 * One command's bound: a caller that waits a fixed budget (a served subject,
 * a gateway action) passes its deadline, so a token renewal, a 401 retry
 * and a second call share it instead of each taking a full timeout.
 */
export interface KickCall {
  deadline?: number;
}

type Query = ReadonlyArray<readonly [string, string]>;

interface KickRequest {
  method: "GET" | "POST" | "PATCH" | "DELETE";
  path: string;
  query?: Query;
  body?: unknown;
  /** The public key endpoint takes no token. */
  auth: boolean;
  /** Clock time the whole call, renewal and retry included, must be done by. */
  deadline: number | undefined;
}

/** A 2xx answer's envelope `data`, or nothing for a 204. */
type Answered = { ok: true; data: unknown } | { ok: false; error: KickApiFailure };

/**
 * A typed client for the parts of api.kick.com woofx3 uses. Every answer is
 * parsed into a domain type here, so no wire shape leaves this file. A 401
 * is retried once with a renewed token. Nothing else is retried: a write
 * whose answer did not come may have reached Kick, and a 429 carries Kick's
 * `Retry-After` for the caller to honour.
 */
export class KickApi {
  constructor(private readonly deps: KickApiDeps) {}

  /** The token's own user: `GET /public/v1/users` with no ids. */
  async self(call?: KickCall): Promise<KickResult<KickUser>> {
    const users = await this.parsed(
      { method: "GET", path: "/public/v1/users", auth: true, deadline: call?.deadline },
      KickUserWireSchema.array()
    );
    if (!users.ok) {
      return users;
    }
    const user = users.value[0];
    if (user === undefined) {
      return malformed("the users answer named no user");
    }
    return { ok: true, value: toUser(user) };
  }

  /** `GET /public/v1/users?id=...`: up to 50 users by id. */
  async users(ids: string[], call?: KickCall): Promise<KickResult<KickUser[]>> {
    const users = await this.parsed(
      {
        method: "GET",
        path: "/public/v1/users",
        query: ids.map((id) => ["id", id] as const),
        auth: true,
        deadline: call?.deadline,
      },
      KickUserWireSchema.array()
    );
    return users.ok ? { ok: true, value: users.value.map(toUser) } : users;
  }

  /** `GET /public/v1/channels`: the token's own channel, or up to 50 by broadcaster id or by slug. */
  async channels(
    query: { ids: string[] } | { slugs: string[] } | "self",
    call?: KickCall
  ): Promise<KickResult<KickChannel[]>> {
    const params: Query =
      query === "self"
        ? []
        : "ids" in query
          ? query.ids.map((id) => ["broadcaster_user_id", id] as const)
          : query.slugs.map((slug) => ["slug", slug] as const);
    const channels = await this.parsed(
      { method: "GET", path: "/public/v1/channels", query: params, auth: true, deadline: call?.deadline },
      KickChannelWireSchema.array()
    );
    return channels.ok ? { ok: true, value: channels.value.map(toChannel) } : channels;
  }

  /** `PATCH /public/v1/channels`: the token's channel title, category and tags. */
  async updateChannel(
    update: { title?: string; categoryId?: number; tags?: string[] },
    call?: KickCall
  ): Promise<KickResult<null>> {
    const body: Record<string, unknown> = {};
    if (update.title !== undefined) {
      body.stream_title = update.title;
    }
    if (update.categoryId !== undefined) {
      body.category_id = update.categoryId;
    }
    if (update.tags !== undefined) {
      body.custom_tags = update.tags;
    }
    return this.empty({ method: "PATCH", path: "/public/v1/channels", body, auth: true, deadline: call?.deadline });
  }

  /** The category whose name matches `name` best: an exact match, ignoring case, else Kick's first. */
  async findCategory(name: string, call?: KickCall): Promise<KickResult<KickCategory | null>> {
    const found = await this.parsed(
      { method: "GET", path: "/public/v2/categories", query: [["name[]", name]], auth: true, deadline: call?.deadline },
      KickCategoryWireSchema.array()
    );
    if (!found.ok) {
      return found;
    }
    const wanted = name.trim().toLowerCase();
    const best = found.value.find((category) => category.name.toLowerCase() === wanted) ?? found.value[0];
    return { ok: true, value: best === undefined ? null : { id: best.id, name: best.name } };
  }

  /** `POST /public/v1/chat` as the token's user into `broadcasterUserId`'s chat. */
  async sendChat(
    line: {
      content: string;
      broadcasterUserId: string;
      replyTo?: string;
    },
    call?: KickCall
  ): Promise<KickResult<{ messageId: string; sent: boolean }>> {
    const body: Record<string, unknown> = {
      content: line.content,
      type: "user",
      broadcaster_user_id: Number(line.broadcasterUserId),
    };
    if (line.replyTo !== undefined) {
      body.reply_to_message_id = line.replyTo;
    }
    const sent = await this.parsed(
      { method: "POST", path: "/public/v1/chat", body, auth: true, deadline: call?.deadline },
      KickSentChatWireSchema
    );
    return sent.ok ? { ok: true, value: { messageId: sent.value.message_id, sent: sent.value.is_sent } } : sent;
  }

  /** `DELETE /public/v1/chat/{message_id}`. */
  async deleteChat(messageId: string, call?: KickCall): Promise<KickResult<null>> {
    return this.empty({
      method: "DELETE",
      path: `/public/v1/chat/${encodeURIComponent(messageId)}`,
      auth: true,
      deadline: call?.deadline,
    });
  }

  /** `POST /public/v1/moderation/bans`: a timeout of `durationMinutes`, or a ban without one. */
  async ban(
    target: {
      broadcasterUserId: string;
      userId: string;
      durationMinutes?: number;
      reason?: string;
    },
    call?: KickCall
  ): Promise<KickResult<null>> {
    const body: Record<string, unknown> = {
      broadcaster_user_id: Number(target.broadcasterUserId),
      user_id: Number(target.userId),
    };
    if (target.durationMinutes !== undefined) {
      body.duration = target.durationMinutes;
    }
    if (target.reason !== undefined) {
      body.reason = target.reason;
    }
    return this.empty({
      method: "POST",
      path: "/public/v1/moderation/bans",
      body,
      auth: true,
      deadline: call?.deadline,
    });
  }

  /** `GET /public/v1/channels/rewards`: the token's channel point rewards. */
  async rewards(call?: KickCall): Promise<KickResult<KickReward[]>> {
    const rewards = await this.parsed(
      { method: "GET", path: "/public/v1/channels/rewards", auth: true, deadline: call?.deadline },
      KickRewardWireSchema.array()
    );
    if (!rewards.ok) {
      return rewards;
    }
    return {
      ok: true,
      value: rewards.value.map((reward) => ({
        id: reward.id,
        title: reward.title,
        cost: reward.cost,
        description: reward.description ?? "",
        isEnabled: reward.is_enabled ?? true,
      })),
    };
  }

  /** `GET /public/v1/events/subscriptions`: this app's subscriptions to the token's channel. */
  async subscriptions(call?: KickCall): Promise<KickResult<KickSubscription[]>> {
    const subscriptions = await this.parsed(
      { method: "GET", path: "/public/v1/events/subscriptions", auth: true, deadline: call?.deadline },
      KickSubscriptionWireSchema.array()
    );
    if (!subscriptions.ok) {
      return subscriptions;
    }
    return {
      ok: true,
      value: subscriptions.value.map((s) => ({
        id: s.id,
        event: s.event,
        version: s.version,
        createdAt: s.created_at,
      })),
    };
  }

  /** `POST /public/v1/events/subscriptions` for the token's channel; Kick answers per event. */
  async subscribe(events: readonly KickEventName[], call?: KickCall): Promise<KickResult<KickSubscribeOutcome[]>> {
    const outcomes = await this.parsed(
      {
        method: "POST",
        path: "/public/v1/events/subscriptions",
        body: { events: events.map(({ name, version }) => ({ name, version })), method: "webhook" },
        auth: true,
        deadline: call?.deadline,
      },
      KickSubscribeOutcomeWireSchema.array()
    );
    if (!outcomes.ok) {
      return outcomes;
    }
    return {
      ok: true,
      value: outcomes.value.map((o) => ({
        name: o.name,
        version: o.version,
        subscriptionId: o.subscription_id ?? null,
        error: o.error ?? null,
      })),
    };
  }

  /** `DELETE /public/v1/events/subscriptions?id=...`. */
  async unsubscribe(ids: string[], call?: KickCall): Promise<KickResult<null>> {
    return this.empty({
      method: "DELETE",
      path: "/public/v1/events/subscriptions",
      query: ids.map((id) => ["id", id] as const),
      auth: true,
      deadline: call?.deadline,
    });
  }

  /** `GET /public/v1/public-key`: the PEM webhook signatures verify against. */
  async publicKey(call?: KickCall): Promise<KickResult<string>> {
    const key = await this.parsed(
      { method: "GET", path: "/public/v1/public-key", auth: false, deadline: call?.deadline },
      KickPublicKeyWireSchema
    );
    return key.ok ? { ok: true, value: key.value.public_key } : key;
  }

  private async parsed<S extends z.ZodType>(request: KickRequest, schema: S): Promise<KickResult<z.infer<S>>> {
    const answered = await this.send(request);
    if (!answered.ok) {
      return answered;
    }
    const result = schema.safeParse(answered.data);
    if (!result.success) {
      return malformed(`${request.method} ${request.path}: ${result.error.issues[0]?.message ?? "unexpected shape"}`);
    }
    return { ok: true, value: result.data };
  }

  private async empty(request: KickRequest): Promise<KickResult<null>> {
    const answered = await this.send(request);
    return answered.ok ? { ok: true, value: null } : answered;
  }

  /** One call, with one more after a 401 on a renewed token. */
  private async send(request: KickRequest): Promise<Answered> {
    const first = await this.attempt(request, false);
    if (first.kind !== "unauthorized") {
      return first.answered;
    }
    const second = await this.attempt(request, true);
    return second.answered;
  }

  private async attempt(
    request: KickRequest,
    forceToken: boolean
  ): Promise<{ kind: "unauthorized" | "done"; answered: Answered }> {
    const headers: Record<string, string> = { Accept: "application/json", "User-Agent": this.deps.userAgent };
    if (this.deps.signal.aborted) {
      return { kind: "done", answered: { ok: false, error: { kind: "stopped" } } };
    }
    if (request.auth) {
      const tokenWait = this.remaining(request, this.deps.tokenTimeoutMs);
      if (tokenWait <= 0) {
        return {
          kind: "done",
          answered: {
            ok: false,
            error: { kind: "unreachable", detail: "the caller's deadline passed before the request left" },
          },
        };
      }
      const token = await this.deps.token.get({ force: forceToken, timeoutMs: tokenWait });
      if (!token.ok) {
        const error: KickApiFailure =
          token.failure.reason === "not_linked" || token.failure.reason === "relink_required"
            ? { kind: "not_linked" }
            : { kind: "unreachable", detail: token.failure.message };
        return { kind: "done", answered: { ok: false, error } };
      }
      headers.Authorization = `Bearer ${token.token.accessToken}`;
    }
    if (request.body !== undefined) {
      headers["Content-Type"] = "application/json";
    }
    const url = new URL(request.path, this.deps.baseUrl);
    for (const [key, value] of request.query ?? []) {
      url.searchParams.append(key, value);
    }
    const wait = this.remaining(request, this.deps.timeoutMs);
    if (wait <= 0) {
      return {
        kind: "done",
        answered: {
          ok: false,
          error: { kind: "unreachable", detail: "the caller's deadline passed before the request left" },
        },
      };
    }
    const timeout = AbortSignal.timeout(wait);
    let response: Response;
    try {
      response = await this.deps.fetch(url, {
        method: request.method,
        headers,
        body: request.body === undefined ? undefined : JSON.stringify(request.body),
        signal: AbortSignal.any([timeout, this.deps.signal]),
      });
    } catch (err) {
      return { kind: "done", answered: { ok: false, error: fetchFailure(err, timeout, this.deps.signal) } };
    }
    if (response.status === 401 && request.auth && !forceToken) {
      return { kind: "unauthorized", answered: { ok: false, error: await this.httpFailure(response) } };
    }
    if (!response.ok) {
      return { kind: "done", answered: { ok: false, error: await this.httpFailure(response) } };
    }
    if (response.status === 204) {
      return { kind: "done", answered: { ok: true, data: null } };
    }
    let body: unknown;
    try {
      body = await response.json();
    } catch (err) {
      if (this.deps.signal.aborted) {
        return { kind: "done", answered: { ok: false, error: { kind: "stopped" } } };
      }
      if (timeout.aborted) {
        return { kind: "done", answered: { ok: false, error: { kind: "timeout" } } };
      }
      return {
        kind: "done",
        answered: { ok: false, error: { kind: "malformed", detail: `not JSON: ${String(err)}` } },
      };
    }
    const envelope = KickEnvelopeSchema.safeParse(body);
    if (!envelope.success) {
      return { kind: "done", answered: { ok: false, error: { kind: "malformed", detail: "not a Kick envelope" } } };
    }
    return { kind: "done", answered: { ok: true, data: envelope.data.data } };
  }

  /** How long this step may wait: `limit`, cut to what is left of the request's deadline. */
  private remaining(request: KickRequest, limit: number): number {
    return request.deadline === undefined ? limit : Math.min(limit, request.deadline - this.deps.clock.now());
  }

  private async httpFailure(response: Response): Promise<KickApiFailure> {
    let message = `Kick answered ${response.status}`;
    let code: string | undefined;
    try {
      const parsed = KickErrorBodySchema.safeParse(await response.json());
      if (parsed.success) {
        if (parsed.data.message !== undefined && parsed.data.message !== "") {
          message = `Kick answered ${response.status}: ${parsed.data.message}`;
        }
        code = typeof parsed.data.data === "string" ? parsed.data.data : undefined;
      }
    } catch {
      // Not JSON: Kick's status alone says what happened.
    }
    return { kind: "http", status: response.status, code, message, retryAfterMs: this.retryAfterMs(response) };
  }

  /** `Retry-After` as seconds or an HTTP date; undefined when absent or unreadable. */
  private retryAfterMs(response: Response): number | undefined {
    const header = response.headers.get("Retry-After");
    if (header === null || header.trim() === "") {
      return undefined;
    }
    const seconds = Number(header);
    if (Number.isFinite(seconds) && seconds >= 0) {
      return seconds * 1000;
    }
    const at = Date.parse(header);
    return Number.isNaN(at) ? undefined : Math.max(0, at - this.deps.clock.now());
  }
}

function fetchFailure(err: unknown, timeout: AbortSignal, run: AbortSignal): KickApiFailure {
  if (run.aborted) {
    return { kind: "stopped" };
  }
  if (timeout.aborted) {
    return { kind: "timeout" };
  }
  if (err instanceof Error && err.name === "AbortError") {
    return { kind: "timeout" };
  }
  return { kind: "unreachable", detail: err instanceof Error ? err.message : String(err) };
}

function malformed(detail: string): { ok: false; error: KickApiFailure } {
  return { ok: false, error: { kind: "malformed", detail } };
}

function toUser(wire: z.infer<typeof KickUserWireSchema>): KickUser {
  return { userId: String(wire.user_id), name: wire.name, profilePicture: wire.profile_picture ?? null };
}

function toChannel(wire: z.infer<typeof KickChannelWireSchema>): KickChannel {
  return {
    broadcasterUserId: String(wire.broadcaster_user_id),
    slug: wire.slug,
    description: wire.channel_description ?? "",
    title: wire.stream_title ?? "",
    category: wire.category == null ? null : { id: wire.category.id, name: wire.category.name },
    stream: {
      isLive: wire.stream?.is_live ?? false,
      startedAt: wire.stream?.is_live === true ? (wire.stream.start_time ?? null) : null,
      viewerCount: wire.stream?.viewer_count ?? 0,
      language: wire.stream?.language ?? null,
      tags: wire.stream?.custom_tags ?? [],
    },
  };
}

/** A failure in words, for logs and /health. */
export function describeKickFailure(failure: KickApiFailure): string {
  switch (failure.kind) {
    case "http": {
      return failure.message;
    }
    case "timeout": {
      return "Kick did not answer in time";
    }
    case "stopped": {
      return "the Kick connection stopped before Kick answered";
    }
    case "unreachable": {
      return `Kick could not be reached: ${failure.detail}`;
    }
    case "not_linked": {
      return "Kick is not linked";
    }
    case "malformed": {
      return `Kick's answer could not be read: ${failure.detail}`;
    }
  }
}
