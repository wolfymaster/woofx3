// Precompiles the schemas to plain JS validators (no new Function/eval at run time), strict and lenient flavours.
import Ajv2020 from "ajv/dist/2020";
import standaloneCode from "ajv/dist/standalone";
import addFormats from "ajv-formats";
import { writeFileSync } from "node:fs";
import { allowExtraFields, loadSchemas } from "../ts/schemas";

const BASE = "https://schemas.woofx3.tv/contracts/";
const ENTRY_POINTS = [
  "platform-gateway/gateway-request.json",
  "platform-gateway/gateway-reply.json",
  "platform-gateway/capabilities-reply.json",
  "platform-gateway/field-options-request.json",
  "platform-gateway/field-options-reply.json",
  "events/engine-event.json",
];

function compile(lenient: boolean): string {
  const ajv = new Ajv2020({ strict: true, strictTypes: false, code: { source: true, esm: false } });
  addFormats(ajv);
  for (const s of loadSchemas()) {
    ajv.addSchema(lenient ? allowExtraFields(s) : s);
  }
  const exports = Object.fromEntries(
    ENTRY_POINTS.map((p) => [`validate${p.split("/")[1].replace(".json", "").replace(/(^|-)(\w)/g, (_, __, c) => c.toUpperCase())}`, BASE + p])
  );
  return standaloneCode(ajv, exports);
}

const out = process.argv[2];
writeFileSync(`${out}/validators.strict.cjs`, compile(false));
writeFileSync(`${out}/validators.lenient.cjs`, compile(true));
