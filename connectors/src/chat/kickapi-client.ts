import { KICKAPI_SUBJECT, kickApiResultType } from "@woofx3/common/cloudevents/Kick/commands";
import { platformApiErrorType } from "@woofx3/common/cloudevents/PlatformApi/reply";
import { requestFailureKind } from "@woofx3/nats";
import { z } from "zod";
import { errorMessage } from "../host/deps";
import type { ScopedBus } from "../host/scoped-bus";

/** A Kick account as the chat commands key it: its id, and its channel slug, the login on its chat lines. */
export interface KickAccount {
  userId: string;
  login: string;
}

/** Why a Kick lookup gave no account; `missing` is a name Kick has no channel for. */
export type KickLookupFailure = { kind: "missing" } | { kind: "unavailable"; message: string };

export type KickLookupResult = { ok: true; value: KickAccount } | { ok: false; failure: KickLookupFailure };

/** The `kickapi` call the built-in commands make. */
export interface KickApiPort {
  /** The account a typed name (a display name or a slug, with or without `@`) belongs to. */
  findUser(name: string): Promise<KickLookupResult>;
}

export interface KickApiClientDeps {
  bus: Pick<ScopedBus, "request">;
  timeoutMs: number;
}

const envelope = z.object({ type: z.string(), data: z.unknown() });
const account = z.object({ userId: z.string().min(1), login: z.string().min(1) });
const refusal = z.object({ error: z.string(), code: z.unknown().optional() });

/** A client for the Kick adapter's `kickapi` subject. Never rejects. */
export class KickApiClient implements KickApiPort {
  constructor(private readonly deps: KickApiClientDeps) {
    if (!(Number.isInteger(deps.timeoutMs) && deps.timeoutMs > 0)) {
      throw new Error(`the kickapi timeout must be a positive whole number of milliseconds, got ${deps.timeoutMs}`);
    }
  }

  async findUser(name: string): Promise<KickLookupResult> {
    const request = new TextEncoder().encode(JSON.stringify({ command: "getUser", args: { userName: name } }));
    let reply: Uint8Array;
    try {
      reply = (await this.deps.bus.request(KICKAPI_SUBJECT, request, { timeout: this.deps.timeoutMs })).data;
    } catch (error) {
      const kind = requestFailureKind(error);
      return unavailable(kind === "other" ? errorMessage(error) : "Kick is not reachable right now");
    }
    let body: unknown;
    try {
      body = JSON.parse(new TextDecoder().decode(reply));
    } catch {
      return unavailable("the Kick adapter sent a reply that is not JSON");
    }
    const parsed = envelope.safeParse(body);
    if (!parsed.success) {
      return unavailable("the Kick adapter sent a reply that is not an event");
    }
    if (parsed.data.type === platformApiErrorType(KICKAPI_SUBJECT)) {
      const refused = refusal.safeParse(parsed.data.data);
      if (refused.success && refused.data.code === "invalid_arguments") {
        return { ok: false, failure: { kind: "missing" } };
      }
      return unavailable(refused.success ? refused.data.error : "the Kick adapter refused the lookup");
    }
    const found = parsed.data.type === kickApiResultType("getUser") ? account.safeParse(parsed.data.data) : null;
    if (found === null || !found.success) {
      return unavailable("the Kick adapter sent a reply of an unexpected shape");
    }
    return { ok: true, value: found.data };
  }
}

function unavailable(message: string): KickLookupResult {
  return { ok: false, failure: { kind: "unavailable", message } };
}
