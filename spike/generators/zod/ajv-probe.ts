// What Ajv does with 3.0.3 constructs and with the Zod generator's 3.0 and 3.1 output.
import Ajv2020 from "ajv/dist/2020";
import Ajv04 from "ajv-draft-04";
import addFormats from "ajv-formats";
import { readFileSync } from "node:fs";

type Make = () => any;
const engines: Record<string, Make> = {
  "Ajv2020 strict:false": () => { const a = new Ajv2020({ strict: false }); addFormats(a); return a; },
  "Ajv2020 strict:false validateSchema:false": () => { const a = new Ajv2020({ strict: false, validateSchema: false }); addFormats(a); return a; },
  "Ajv draft-04 strict:false": () => { const a = new Ajv04({ strict: false }); addFormats(a); return a; },
};
const check = (mk: Make, schema: object, components: object, value: unknown): string => {
  try { return mk().compile({ ...schema, components })(value) ? "accept" : "reject"; } catch (e) { return "COMPILE ERROR: " + String(e).slice(0, 80); }
};
const comps = { schemas: { Obj: { type: "object", properties: { a: { type: "string" } }, required: ["a"] } } };
const cases: [string, object, unknown][] = [
  ["3.0 {type:string,nullable:true} <- null", { type: "string", nullable: true }, null],
  ["3.0 {type:string} <- null (must reject)", { type: "string" }, null],
  ["3.0 {type:object,nullable:true} <- null", { type: "object", nullable: true }, null],
  ["3.0 {enum:[a,null],type:string,nullable:true} <- null", { type: "string", nullable: true, enum: ["a", null] }, null],
  ["3.0 {enum:[a],type:string,nullable:true} <- null (spec: reject)", { type: "string", nullable: true, enum: ["a"] }, null],
  ["3.0 allOf[$ref Obj,{nullable:true}] <- null (3.0 spec: reject)", { allOf: [{ $ref: "#/components/schemas/Obj" }, { nullable: true }] }, null],
  ["3.0 {nullable:true,allOf:[$ref Obj]} <- null (3.0 idiom)", { nullable: true, allOf: [{ $ref: "#/components/schemas/Obj" }] }, null],
  ["3.0 {nullable:true,oneOf:[$ref Obj]} <- null", { nullable: true, oneOf: [{ $ref: "#/components/schemas/Obj" }] }, null],
  ["3.0 {type:integer,minimum:0,exclusiveMinimum:true} <- 0 (spec: reject)", { type: "integer", minimum: 0, exclusiveMinimum: true }, 0],
  ["3.1 allOf[$ref Obj,{type:[object,null]}] <- null (Zod 3.1 output)", { allOf: [{ $ref: "#/components/schemas/Obj" }, { type: ["object", "null"] }] }, null],
  ["3.1 anyOf[$ref Obj,{type:null}] <- null", { anyOf: [{ $ref: "#/components/schemas/Obj" }, { type: "null" }] }, null],
];
for (const [name, mk] of Object.entries(engines)) {
  console.log(`\n# ${name}`);
  for (const [label, schema, value] of cases) { console.log(check(mk, schema, comps, value).padEnd(16), label); }
}
// The Zod-emitted body schema, with every nullable set to null.
const body = { name: "x", note: null, reason: null, owner: null, tags: null, bundle: null };
for (const v of ["30", "31"]) {
  const doc = JSON.parse(readFileSync(`work/zod.${v}.json`, "utf8"));
  console.log(`\n# Zod ${v} UpdateThing with all nullables null`);
  for (const [name, mk] of Object.entries(engines)) {
    console.log(check(mk, { $ref: "#/components/schemas/UpdateThing" }, doc.components, body).padEnd(16), name);
  }
}
