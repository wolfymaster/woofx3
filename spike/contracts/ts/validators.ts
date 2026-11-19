import Ajv2020, { type ValidateFunction } from "ajv/dist/2020";
import addFormats from "ajv-formats";
import { allowExtraFields, loadSchemas } from "./schemas";

const BASE = "https://schemas.woofx3.tv/contracts/";

export type Validator = (value: unknown) => { ok: true } | { ok: false; error: string };

function build(lenient: boolean) {
  const ajv = new Ajv2020({ strict: true, strictTypes: false, allErrors: false });
  addFormats(ajv);
  for (const schema of loadSchemas()) {
    ajv.addSchema(lenient ? allowExtraFields(schema) : schema);
  }
  return (path: string): Validator => {
    const validate = ajv.getSchema(BASE + path) as ValidateFunction;
    return (value) =>
      validate(value) ? { ok: true } : { ok: false, error: `${validate.errors?.[0]?.instancePath} ${validate.errors?.[0]?.message}` };
  };
}

// Producers send with the strict schema, so an unknown field is a bug; consumers read with the lenient one.
export const strict = build(false);
export const lenient = build(true);
