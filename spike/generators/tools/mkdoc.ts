// Folds the first spike's JSON Schema files into one OpenAPI 3.1 document: schemas become components, unions with a
// const tag become discriminated oneOfs, and four POST operations carry the request/reply pairs and the event union.
// Usage: mkdoc.ts <schemasDir> <out.json>
import { readdirSync, readFileSync, writeFileSync, statSync } from "node:fs";
import { join } from "node:path";

type J = any;
const [dir, out] = process.argv.slice(2);
const files: J[] = [];
const walk = (d: string) => {
  for (const f of readdirSync(d).sort()) {
    const p = join(d, f);
    statSync(p).isDirectory() ? walk(p) : files.push(JSON.parse(readFileSync(p, "utf8")));
  }
};
walk(dir);
const nameOf = new Map<string, string>(files.map((s) => [s.$id, s.title]));
const components: Record<string, J> = {};

function rewrite(node: J, base: string): J {
  if (Array.isArray(node)) {
    return node.map((n) => rewrite(n, base));
  }
  if (node === null || typeof node !== "object") {
    return node;
  }
  const o: J = {};
  for (const [k, v] of Object.entries(node)) {
    if (["$schema", "$id"].includes(k)) {
      continue;
    }
    if (k === "$ref") {
      const t = nameOf.get(new URL(v as string, base).href);
      if (!t) {
        throw new Error(`unresolvable ${v}`);
      }
      o[k] = `#/components/schemas/${t}`;
    } else {
      o[k] = rewrite(v, base);
    }
  }
  // A bare const has no type; Go generators fall back to interface{} without one.
  if ("const" in o && !("type" in o)) {
    o.type = typeof o.const;
  }
  return o;
}

// An inline titled oneOf member becomes its own component so every member is a $ref (discriminator needs that).
function hoist(name: string, s: J) {
  if (!Array.isArray(s.oneOf)) {
    return;
  }
  s.oneOf = s.oneOf.map((m: J) => {
    if (m.$ref || !m.title) {
      return m;
    }
    components[m.title] = m;
    return { $ref: `#/components/schemas/${m.title}` };
  });
}

for (const f of files) {
  const { $id, ...rest } = f;
  components[f.title] = rewrite(rest, $id);
}
for (const [name, s] of Object.entries({ ...components })) {
  hoist(name, s);
}
// Tag property: a const property required by every member.
for (const [name, s] of Object.entries(components)) {
  if (!Array.isArray(s.oneOf) || !s.oneOf.every((m: J) => m.$ref)) {
    continue;
  }
  const members = s.oneOf.map((m: J) => [m.$ref.split("/").pop() as string, components[m.$ref.split("/").pop() as string]]);
  const tag = Object.keys(members[0][1].properties ?? {}).find((p) =>
    members.every(([, c]: J) => c.required?.includes(p) && c.properties?.[p]?.const !== undefined)
  );
  if (tag) {
    s.discriminator = {
      propertyName: tag,
      mapping: Object.fromEntries(members.map(([n, c]: J) => [c.properties[tag].const, `#/components/schemas/${n}`])),
    };
  }
}
const ref = (n: string) => ({ $ref: `#/components/schemas/${n}` });
const post = (id: string, req: string, rep: string) => ({
  post: {
    operationId: id,
    requestBody: { required: true, content: { "application/json": { schema: ref(req) } } },
    responses: { "200": { description: "reply", content: { "application/json": { schema: ref(rep) } } } },
  },
});
const doc = {
  openapi: "3.1.0",
  info: { title: "woofx3 message contracts (spike)", version: "0.0.0" },
  paths: {
    "/platform-gateway.request": post("gatewayRequest", "GatewayRequest", "GatewayReply"),
    "/platform-gateway.capabilities": { get: { operationId: "gatewayCapabilities", responses: { "200": { description: "reply", content: { "application/json": { schema: ref("CapabilitiesReply") } } } } } },
    "/platform-gateway.field-options": post("gatewayFieldOptions", "FieldOptionsRequest", "FieldOptionsReply"),
    "/events": post("publishEvent", "EngineEvent", "EngineEvent"),
  },
  components: { schemas: components },
};
writeFileSync(out, JSON.stringify(doc, null, 2) + "\n");
