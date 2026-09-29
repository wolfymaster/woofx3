import type { DbClient } from "./db-client";

/**
 * The outcome of one Helix read, kept apart so the sampler can tell a value it
 * may store from a reason it may not.
 *
 * `offline` exists only for the viewer count: Helix answering "not live" is a
 * fact about the stream, not a failed read. `rate_limited` carries when Twitch
 * says the bucket refills, so the caller can wait instead of dropping the read.
 */
export type HelixRead<T> =
  | { kind: "value"; value: T }
  | { kind: "offline" }
  | { kind: "rate_limited"; retryAtMs: number | null }
  | { kind: "failed"; reason: string };

export interface SubscriptionTotals {
  total: number;
  points: number;
}

/** The three Helix reads a gauge sample is made of. */
export interface HelixGauges {
  viewerCount(): Promise<HelixRead<number>>;
  followerTotal(): Promise<HelixRead<number>>;
  subscriptions(): Promise<HelixRead<SubscriptionTotals>>;
}

interface Credentials {
  clientId: string;
  accessToken: string;
  broadcasterId: string;
}

type Fetch = (input: string, init: RequestInit) => Promise<Response>;

const HELIX = "https://api.twitch.tv/helix";

/**
 * Reads the broadcaster's viewer count, follower total and subscriber totals
 * from Twitch Helix, with the OAuth token stored in the `twitch_token` setting
 * (the same source `getStreamStatus` and `twitchBootstrap.ts` read). The token
 * already carries `moderator:read:followers` and `channel:read:subscriptions`.
 *
 * Credentials are read on every call rather than cached, because the Twitch
 * service refreshes the token in that setting underneath this process.
 *
 * Never throws: every failure is a `HelixRead`, so one bad endpoint cannot
 * cost the sample the values the other two returned.
 */
export class TwitchHelixGauges implements HelixGauges {
  constructor(
    private db: DbClient,
    private fetchFn: Fetch = (input, init) => fetch(input, init),
    private clientId: () => string | undefined = () => process.env.WOOFX3_TWITCH_CLIENT_ID
  ) {}

  async viewerCount(): Promise<HelixRead<number>> {
    return this.get(
      (id) => `/streams?user_id=${id}`,
      (body) => {
        const stream: unknown = Array.isArray(body.data) ? body.data[0] : undefined;
        if (stream === undefined) {
          return { kind: "offline" };
        }
        if (typeof stream !== "object" || stream === null) {
          return { kind: "failed", reason: "helix stream entry is not an object" };
        }
        return count((stream as Record<string, unknown>).viewer_count, "viewer_count");
      }
    );
  }

  async followerTotal(): Promise<HelixRead<number>> {
    return this.get(
      (id) => `/channels/followers?broadcaster_id=${id}&first=1`,
      (body) => count(body.total, "total")
    );
  }

  async subscriptions(): Promise<HelixRead<SubscriptionTotals>> {
    return this.get(
      (id) => `/subscriptions?broadcaster_id=${id}&first=1`,
      (body) => {
        const total = count(body.total, "total");
        const points = count(body.points, "points");
        if (total.kind !== "value") {
          return total;
        }
        if (points.kind !== "value") {
          return points;
        }
        return { kind: "value", value: { total: total.value, points: points.value } };
      }
    );
  }

  private async get<T>(
    path: (broadcasterId: string) => string,
    parse: (body: Record<string, unknown>) => HelixRead<T>
  ): Promise<HelixRead<T>> {
    const credentials = await this.credentials();
    if (typeof credentials === "string") {
      return { kind: "failed", reason: credentials };
    }

    let response: Response;
    try {
      response = await this.fetchFn(`${HELIX}${path(encodeURIComponent(credentials.broadcasterId))}`, {
        headers: {
          Authorization: `Bearer ${credentials.accessToken}`,
          "Client-Id": credentials.clientId,
        },
      });
    } catch (err) {
      return { kind: "failed", reason: `helix fetch failed: ${err instanceof Error ? err.message : String(err)}` };
    }

    if (response.status === 429) {
      return { kind: "rate_limited", retryAtMs: rateLimitReset(response.headers) };
    }
    if (!response.ok) {
      const body = await response.text().catch(() => "unreadable");
      return { kind: "failed", reason: `helix ${response.status}: ${body}` };
    }

    let body: unknown;
    try {
      body = await response.json();
    } catch {
      return { kind: "failed", reason: "helix returned a body that is not JSON" };
    }
    if (typeof body !== "object" || body === null) {
      return { kind: "failed", reason: "helix returned a body that is not an object" };
    }
    return parse(body as Record<string, unknown>);
  }

  /** The credentials to call Helix with, or why there are none. */
  private async credentials(): Promise<Credentials | string> {
    const clientId = this.clientId();
    if (!clientId) {
      return "WOOFX3_TWITCH_CLIENT_ID is not set";
    }
    let token: { accessToken?: unknown; userId?: unknown };
    try {
      const raw = await this.db.getSetting("twitch_token");
      if (!raw) {
        return "no twitch_token setting";
      }
      token = JSON.parse(raw);
    } catch (err) {
      return `failed to read twitch_token: ${err instanceof Error ? err.message : String(err)}`;
    }
    if (
      typeof token.accessToken !== "string" ||
      typeof token.userId !== "string" ||
      !token.accessToken ||
      !token.userId
    ) {
      return "twitch_token has no accessToken or userId";
    }
    return { clientId, accessToken: token.accessToken, broadcasterId: token.userId };
  }
}

function count(value: unknown, field: string): HelixRead<number> {
  if (typeof value === "number" && Number.isSafeInteger(value) && value >= 0) {
    return { kind: "value", value };
  }
  return { kind: "failed", reason: `helix response has no usable ${field}` };
}

/**
 * When the rate-limit bucket refills, from Twitch's `Ratelimit-Reset` header
 * (epoch seconds), or null when it is missing or unreadable.
 */
function rateLimitReset(headers: Headers): number | null {
  const raw = headers.get("ratelimit-reset");
  if (raw === null) {
    return null;
  }
  const seconds = Number(raw);
  return Number.isFinite(seconds) && seconds > 0 ? seconds * 1000 : null;
}
