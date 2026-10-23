// Answers `engine.companion.module.request`: barkloader's `ctx.local`, on
// behalf of module code, asking the companion gateway to write a frame to one
// of the module's own declared endpoints and optionally wait for the device's
// answer. The module names the endpoint and the message; the gateway checks
// it may reach it, picks the address and acts on a session it holds.

import {
  COMPANION_GATEWAY_SUBJECTS,
  type ModuleEndpointFailed,
  type ModuleEndpointFailureCode,
  type ModuleEndpointReply,
  type ModuleEndpointRequest,
  parseModuleEndpointRequest,
} from "@woofx3/common/cloudevents/Companion/module-request";
import { type Clock, errorMessage, type Logger, type Timers } from "../host/deps";
import {
  type HostRequestErrorCode,
  type ParseResult,
  parsed,
  parseFailed,
  type RawRequestSpec,
  type RequestContext,
} from "../host/host-requests";
import { type EndpointSessions, failureCodeFor, type SessionFailure } from "./endpoint-sessions";
import type { ModuleRoutePolicy } from "./module-route-policy";

/** The contract's bound on a failed reply's message, in characters. */
export const FAILED_MESSAGE_MAX_CHARS = 1_000;

/** How the host's own refusals read to barkloader. */
const HOST_ERROR_CODES: Record<HostRequestErrorCode, ModuleEndpointFailureCode> = {
  invalid: "invalid",
  internal: "unavailable",
  expired: "timeout",
};

export type ModuleRequestOp = ModuleEndpointRequest["op"];

/** Answered requests by op, then by `ok` or the failure code. */
export type ModuleRequestCounters = Record<ModuleRequestOp, Partial<Record<"ok" | ModuleEndpointFailureCode, number>>>;

export interface ModuleRequestsDeps {
  policy: Pick<ModuleRoutePolicy, "admit">;
  sessions: Pick<EndpointSessions, "acquire">;
  /** The longest a request is served, from arrival; a request's own budgetMs can only shorten it. */
  budgetMs: number;
  clock: Clock;
  timers: Timers;
  logger: Logger;
}

const encoder = new TextEncoder();
const decoder = new TextDecoder();

export class ModuleRequests {
  private readonly counters: ModuleRequestCounters = { send: {}, request: {} };

  constructor(private readonly deps: ModuleRequestsDeps) {}

  get served(): ReadonlyArray<{ subject: string; budgetMs: number }> {
    return [{ subject: COMPANION_GATEWAY_SUBJECTS.moduleRequest, budgetMs: this.deps.budgetMs }];
  }

  /** For HostRequests.serveRequest: a raw JSON request and reply, no CloudEvent envelope. */
  spec(): RawRequestSpec<ModuleEndpointRequest> {
    return {
      subject: COMPANION_GATEWAY_SUBJECTS.moduleRequest,
      budgetMs: this.deps.budgetMs,
      replyMode: "raw",
      parse: parseRequest,
      handle: async (request, ctx) => encode(await this.handle(request, ctx)),
      errorReply: (code, message) => encode(failedReply(HOST_ERROR_CODES[code], message)),
    };
  }

  snapshot(): ModuleRequestCounters {
    return { send: { ...this.counters.send }, request: { ...this.counters.request } };
  }

  /**
   * Serves one request until the earlier of the host's deadline and the
   * caller's own `budgetMs` from arrival, so nothing is written after
   * barkloader has given up.
   */
  async handle(request: ModuleEndpointRequest, ctx: RequestContext): Promise<ModuleEndpointReply> {
    const { moduleId, endpointId, op } = request;
    // The moduleId is barkloader's stamp from the invocation, trusted like the
    // platform gateway's requestedBy: the subject is reserved, not authenticated.
    this.deps.logger.info("companion module request", { moduleId, endpointId, op });
    const reply = await this.serve(request, ctx);
    const outcome = reply.status === "ok" ? "ok" : reply.code;
    const byOutcome = this.counters[op];
    byOutcome[outcome] = (byOutcome[outcome] ?? 0) + 1;
    if (reply.status === "failed") {
      this.deps.logger.info("companion module request failed", {
        moduleId,
        endpointId,
        op,
        code: reply.code,
        error: reply.message,
      });
    }
    return reply;
  }

  private async serve(request: ModuleEndpointRequest, ctx: RequestContext): Promise<ModuleEndpointReply> {
    const { clock, timers } = this.deps;
    const deadline = Math.min(ctx.arrivedAt + request.budgetMs, ctx.deadline);
    const remainingMs = deadline - clock.now();
    if (remainingMs <= 0) {
      return failedReply("timeout", "the budget ran out before the request was served");
    }
    const budget = new AbortController();
    const timer = timers.setTimeout(() => {
      budget.abort(new Error(`the ${request.budgetMs}ms budget ran out`));
    }, remainingMs);
    const signal = AbortSignal.any([ctx.signal, budget.signal]);
    try {
      const ref = { moduleId: request.moduleId, endpointId: request.endpointId };
      const admission = await this.deps.policy.admit(ref);
      if (!admission.ok) {
        return failedReply(failureCodeFor(admission.reason), admission.message);
      }
      const acquired = await this.deps.sessions.acquire(ref, signal);
      if (!acquired.ok) {
        return fromFailure(acquired);
      }
      if (request.op === "send") {
        const sent = acquired.session.send(request.message, signal);
        return sent.ok ? { status: "ok", sessionEpoch: sent.sessionEpoch } : fromFailure(sent);
      }
      const answered = await acquired.session.request(request.match, request.message, signal);
      return answered.ok
        ? { status: "ok", reply: answered.reply, sessionEpoch: answered.sessionEpoch }
        : fromFailure(answered);
    } finally {
      timers.clearTimeout(timer);
    }
  }
}

function parseRequest(raw: Uint8Array): ParseResult<ModuleEndpointRequest> {
  let value: unknown;
  try {
    value = JSON.parse(decoder.decode(raw));
  } catch (error) {
    return parseFailed(`the request is not JSON: ${errorMessage(error)}`);
  }
  const result = parseModuleEndpointRequest(value);
  if (!result.ok) {
    return parseFailed(`${result.error.field}: ${result.error.problem}`);
  }
  return parsed(result.value);
}

function fromFailure(failure: SessionFailure): ModuleEndpointFailed {
  const reply = failedReply(failure.code, failure.message);
  if (failure.sessionEpoch !== undefined) {
    reply.sessionEpoch = failure.sessionEpoch;
  }
  return reply;
}

function failedReply(code: ModuleEndpointFailureCode, message: string): ModuleEndpointFailed {
  const bounded = [...message].slice(0, FAILED_MESSAGE_MAX_CHARS).join("");
  return { status: "failed", code, message: bounded === "" ? code : bounded };
}

function encode(reply: ModuleEndpointReply): Uint8Array {
  return encoder.encode(JSON.stringify(reply));
}
