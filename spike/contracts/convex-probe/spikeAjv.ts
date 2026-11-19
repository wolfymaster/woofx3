import Ajv2020 from "ajv/dist/2020";
import addFormats from "ajv-formats";
import { httpRouter } from "convex/server";
import { httpAction, query } from "./_generated/server";
import streamOnline from "../shared/spike/stream-online.json";
// @ts-ignore generated CommonJS
import * as standalone from "../shared/spike/validators.lenient.cjs";

const GOOD = { type: "stream.online", twitchUserId: "u1", startedAt: "2026-11-19T10:00:00Z", viewerCount: 3 };
const BAD = { type: "stream.online", twitchUserId: "", startedAt: "not a date" };

export function runStandalone() {
  const validate = (standalone as any).validateEngineEvent ?? (standalone as any).default?.validateEngineEvent;
  return { good: validate(GOOD), bad: validate(BAD), errors: validate.errors?.length ?? 0 };
}

export function runRuntimeAjv() {
  const ajv = new Ajv2020({ strict: false });
  addFormats(ajv);
  const validate = ajv.compile(streamOnline);
  return { good: validate(GOOD), bad: validate(BAD) };
}

function attempt(fn: () => unknown) {
  try {
    return { ok: true, result: fn() };
  } catch (e) {
    return { ok: false, error: String((e as Error)?.message ?? e).slice(0, 400) };
  }
}

export const standaloneQuery = query({ args: {}, handler: async () => attempt(runStandalone) });
export const runtimeQuery = query({ args: {}, handler: async () => attempt(runRuntimeAjv) });

export function registerSpikeRoutes(http: ReturnType<typeof httpRouter>) {
  http.route({ path: "/spike/standalone", method: "GET", handler: httpAction(async () => Response.json(attempt(runStandalone))) });
  http.route({ path: "/spike/runtime", method: "GET", handler: httpAction(async () => Response.json(attempt(runRuntimeAjv))) });
}
