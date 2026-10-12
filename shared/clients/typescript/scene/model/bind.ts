// Filling a composition's inputs in.
//
// A composition declares the values it takes from whoever uses it in
// `inputs`, and refers to them in two ways:
//
// - `{ "$input": "id" }` as a whole value: replaced by the input's value as
//   it is, so a number stays a number and an object stays an object.
// - `{{id}}` inside a string: replaced by the value as text. Whitespace
//   inside the braces is allowed (`{{ id }}`); the id is letters, digits,
//   `_`, `-` and `.`.
//
// A literal `{{` is written `\{{`. Backslashes are only special in a run
// directly before `{{`: each `\\` there is one literal backslash, and an odd
// one left over escapes the braces, so `\\{{id}}` is a backslash followed by
// the value. Any other `{{` that is not a well-formed reference is refused
// rather than kept, so a typo never reaches the screen as raw braces.
//
// Only the canvas (`layout`), widget `settings` and behavior `params` are
// read: ids, targets, timing and the document's structure never come from
// inputs. Values are substituted in one pass and never read again, so text
// a viewer typed into an input cannot itself refer to an input.

import type { CompositionDocument, InputField } from "./types";

/** A step into the document: an object key or an array index. */
export type DocumentPath = Array<string | number>;

/** One place the document uses an input: as a whole `value`, or inside `text`. */
export interface InputUsage {
  input: string;
  path: DocumentPath;
  form: "value" | "text";
}

export interface BindReport {
  /** Declared inputs with neither a value nor a default. */
  missing: string[];
  /** Values given for inputs the composition does not declare; ignored. */
  unknownValues: string[];
  /** Places the document refers to an input it does not declare. */
  unknownReferences: InputUsage[];
  /** Places that look like a reference but are not one (`{{` with no id, `$input` beside other keys). */
  malformed: DocumentPath[];
}

export type BindResult =
  | { ok: true; document: CompositionDocument; report: BindReport }
  | { ok: false; report: BindReport };

/** Every place the document uses an input, in document order. */
export function inputReferences(doc: CompositionDocument): InputUsage[] {
  const usages: InputUsage[] = [];
  walkDocument(doc, (value, path) => {
    collect(value, path, usages, []);
    return value;
  });
  return usages;
}

/**
 * The document with every input reference replaced by its value, or its
 * declared default when `values` has none. Fails, with the report saying
 * why, when an input is missing or the document refers to one it does not
 * declare or holds a malformed reference: a composition is never played
 * with a reference left in it. Values for undeclared inputs are reported
 * and ignored.
 */
export function bindInputs(doc: CompositionDocument, values: Readonly<Record<string, unknown>>): BindResult {
  const declared = declaredInputs(doc.inputs ?? []);
  const usages: InputUsage[] = [];
  const malformed: DocumentPath[] = [];
  walkDocument(doc, (value, path) => {
    collect(value, path, usages, malformed);
    return value;
  });

  const resolved = new Map<string, unknown>();
  const missing: string[] = [];
  for (const [id, field] of declared) {
    if (values[id] !== undefined) {
      resolved.set(id, values[id]);
    } else if (field.defaultValue !== undefined) {
      resolved.set(id, field.defaultValue);
    } else {
      missing.push(id);
    }
  }
  const report: BindReport = {
    missing,
    unknownValues: Object.keys(values)
      .filter((id) => values[id] !== undefined && !declared.has(id))
      .sort(),
    unknownReferences: usages.filter((usage) => !declared.has(usage.input)),
    malformed,
  };
  if (report.missing.length > 0 || report.unknownReferences.length > 0 || report.malformed.length > 0) {
    return { ok: false, report };
  }

  let substituted = 0;
  const document = walkDocument(doc, (value) =>
    substitute(value, resolved, () => {
      substituted += 1;
    })
  );
  // Every reference found above must have been replaced, or the bound
  // document would still hold one.
  if (substituted !== usages.length) {
    throw new Error(`bind: replaced ${substituted} input references but found ${usages.length}`);
  }
  return { ok: true, document, report };
}

function declaredInputs(inputs: readonly InputField[]): Map<string, InputField> {
  const declared = new Map<string, InputField>();
  for (const field of inputs) {
    if (typeof field.id !== "string" || field.id === "") {
      throw new Error("bind: every input must have an id");
    }
    if (declared.has(field.id)) {
      throw new Error(`bind: input ${field.id} is declared twice`);
    }
    declared.set(field.id, field);
  }
  return declared;
}

/**
 * Rebuild the document with `visit` applied to each part inputs may reach,
 * copying everything else as it is.
 */
function walkDocument(
  doc: CompositionDocument,
  visit: (value: unknown, path: DocumentPath) => unknown
): CompositionDocument {
  const layout = visit(doc.layout, ["layout"]) as Record<string, unknown>;
  const widgets: CompositionDocument["widgets"] = {};
  for (const [id, widget] of Object.entries(doc.widgets)) {
    widgets[id] = {
      ...widget,
      settings: visit(widget.settings, ["widgets", id, "settings"]) as Record<string, unknown>,
    };
  }
  const behaviors: CompositionDocument["behaviors"] = {};
  for (const [id, behavior] of Object.entries(doc.behaviors)) {
    behaviors[id] = {
      ...behavior,
      params: visit(behavior.params, ["behaviors", id, "params"]) as Record<string, unknown>,
    };
  }
  return {
    ...doc,
    layout,
    widgets,
    behaviors,
  };
}

// ---- finding references ----------------------------------------------------

function collect(value: unknown, path: DocumentPath, usages: InputUsage[], malformed: DocumentPath[]): void {
  if (typeof value === "string") {
    const parsed = parseText(value);
    if (parsed === null) {
      malformed.push(path);
      return;
    }
    for (const part of parsed) {
      if (part.kind === "input") {
        usages.push({ input: part.id, path, form: "text" });
      }
    }
    return;
  }
  if (Array.isArray(value)) {
    value.forEach((item, index) => {
      collect(item, [...path, index], usages, malformed);
    });
    return;
  }
  if (isRecord(value)) {
    const reference = asReference(value);
    if (reference === "malformed") {
      malformed.push(path);
      return;
    }
    if (reference !== null) {
      usages.push({ input: reference, path, form: "value" });
      return;
    }
    for (const [key, item] of Object.entries(value)) {
      collect(item, [...path, key], usages, malformed);
    }
  }
}

/** The input a whole-value reference names, `null` for an ordinary object. */
function asReference(value: Record<string, unknown>): string | "malformed" | null {
  if (!Object.hasOwn(value, "$input")) {
    return null;
  }
  const keys = Object.keys(value);
  if (keys.length !== 1 || typeof value.$input !== "string" || value.$input === "") {
    return "malformed";
  }
  return value.$input;
}

// ---- replacing references --------------------------------------------------

function substitute(value: unknown, resolved: ReadonlyMap<string, unknown>, counted: () => void): unknown {
  if (typeof value === "string") {
    const parsed = parseText(value);
    if (parsed === null) {
      throw new Error("bind: a malformed reference survived the report");
    }
    let text = "";
    for (const part of parsed) {
      if (part.kind === "text") {
        text += part.text;
      } else {
        counted();
        text += asText(lookup(resolved, part.id));
      }
    }
    return text;
  }
  if (Array.isArray(value)) {
    return value.map((item) => substitute(item, resolved, counted));
  }
  if (isRecord(value)) {
    const reference = asReference(value);
    if (reference === "malformed") {
      throw new Error("bind: a malformed reference survived the report");
    }
    if (reference !== null) {
      counted();
      // A copy, so editing the bound document never reaches the caller's values.
      return structuredClone(lookup(resolved, reference));
    }
    const copy: Record<string, unknown> = {};
    for (const [key, item] of Object.entries(value)) {
      copy[key] = substitute(item, resolved, counted);
    }
    return copy;
  }
  return value;
}

function lookup(resolved: ReadonlyMap<string, unknown>, id: string): unknown {
  if (!resolved.has(id)) {
    throw new Error(`bind: input ${id} has no value`);
  }
  return resolved.get(id);
}

/** How a value reads inside text. */
function asText(value: unknown): string {
  if (typeof value === "string") {
    return value;
  }
  if (value === null) {
    return "";
  }
  if (typeof value === "number" || typeof value === "boolean") {
    return String(value);
  }
  return JSON.stringify(value);
}

// ---- text ------------------------------------------------------------------

type TextPart = { kind: "text"; text: string } | { kind: "input"; id: string };

const REFERENCE = /^\{\{\s*([A-Za-z0-9_.-]+)\s*\}\}/;

/** A string split into literal text and references, or `null` when it holds a malformed one. */
function parseText(value: string): TextPart[] | null {
  const parts: TextPart[] = [];
  let text = "";
  let index = 0;
  while (index < value.length) {
    const open = value.indexOf("{{", index);
    if (open === -1) {
      text += value.slice(index);
      break;
    }
    let slashes = 0;
    while (open - slashes - 1 >= index && value[open - slashes - 1] === "\\") {
      slashes += 1;
    }
    text += value.slice(index, open - slashes) + "\\".repeat(Math.floor(slashes / 2));
    if (slashes % 2 === 1) {
      text += "{{";
      index = open + 2;
      continue;
    }
    const match = REFERENCE.exec(value.slice(open));
    if (match === null) {
      return null;
    }
    if (text !== "") {
      parts.push({ kind: "text", text });
      text = "";
    }
    parts.push({ kind: "input", id: match[1] });
    index = open + match[0].length;
  }
  if (text !== "") {
    parts.push({ kind: "text", text });
  }
  return parts;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
