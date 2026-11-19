// A Zod contract that uses every feature the real specs lean on; emitted as 3.1 and as 3.0.3 by the same registry.
import { extendZodWithOpenApi, OpenAPIRegistry, OpenApiGeneratorV3, OpenApiGeneratorV31 } from "@asteasolutions/zod-to-openapi";
import { z } from "zod";
import { writeFileSync } from "node:fs";
extendZodWithOpenApi(z);

const Kind = z.enum(["provision", "deprovision"]).openapi("RunKind");
const Reason = z.enum(["refund", "dispute", "operator"]).nullable().openapi("RevokeReason");
const Err = z.object({ code: z.string().max(64), message: z.string() }).openapi("ApiError");
const Online = z.object({ type: z.literal("stream.online"), twitchUserId: z.string().min(1).max(200), viewerCount: z.number().int().min(0).max(100_000_000).optional() }).strict().openapi("StreamOnline");
const Offline = z.object({ type: z.literal("stream.offline"), twitchUserId: z.string().min(1).max(200) }).strict().openapi("StreamOffline");
const Event = z.discriminatedUnion("type", [Online, Offline]).openapi("EngineEvent");
const Body = z.object({
  name: z.string().min(1),
  note: z.string().nullable(),
  tags: z.array(z.string()).nullable().optional(),
  bundle: z.record(z.string(), z.unknown()).nullable().optional(),
  reason: Reason,
  kind: Kind.default("provision"),
  owner: Err.nullable(),
  limit: z.number().int().positive().default(50),
}).strict().openapi("UpdateThing");

export function build(v: "3.0.3" | "3.1.0", webhooks: boolean) {
  const r = new OpenAPIRegistry();
  r.register("Event", Event);
  r.registerPath({ method: "put", path: "/things/{id}", request: { params: z.object({ id: z.string() }), body: { required: true, content: { "application/json": { schema: Body } } } },
    responses: { 200: { description: "ok", content: { "application/json": { schema: Event } } }, 400: { description: "bad", content: { "application/json": { schema: Err } } } } });
  if (webhooks) {
    r.registerWebhook({ method: "post", path: "callback", request: { body: { required: true, content: { "application/json": { schema: Event } } } }, responses: { 200: { description: "ok" } } });
  }
  const cfg = { openapi: v, info: { title: "t", version: "1" } } as never;
  return v === "3.1.0" ? new OpenApiGeneratorV31(r.definitions).generateDocument(cfg) : new OpenApiGeneratorV3(r.definitions).generateDocument(cfg);
}
writeFileSync("work/zod.31.json", JSON.stringify(build("3.1.0", true), null, 2));
try { writeFileSync("work/zod.30.json", JSON.stringify(build("3.0.3", false), null, 2)); } catch (e) { console.log("V3 failed", String(e)); }
try { build("3.0.3", true); console.log("V3 accepted a webhook"); } catch (e) { console.log("V3 with webhook:", String(e).slice(0, 200)); }
