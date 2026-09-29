import type { FieldOptionsDeclaration, FieldOptionsDescriptor, FieldOptionsReference } from "@woofx3/api";

const DECLARATIONS: readonly FieldOptionsDeclaration[] = ["trigger", "action", "widget", "resource", "setting"];

function asRecord(value: unknown): Record<string, unknown> | null {
  return value !== null && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;
}

function nonEmptyString(value: unknown): string | null {
  return typeof value === "string" && value.trim() !== "" ? value : null;
}

/** A module row's stored manifest as an object, or null when it is absent or does not parse. */
export function parseStoredManifest(raw: string | undefined): Record<string, unknown> | null {
  if (!raw) {
    return null;
  }
  try {
    const parsed: unknown = JSON.parse(raw);
    return parsed !== null && typeof parsed === "object" && !Array.isArray(parsed)
      ? (parsed as Record<string, unknown>)
      : null;
  } catch {
    return null;
  }
}

/**
 * Narrow what a caller sent to a field reference, or throw saying what is
 * wrong with it.
 *
 * A request descriptor (`{ kind: "internal", request }`) gets its own answer:
 * it is what a dashboard built before references sends, and naming the fix
 * beats a generic shape error. It is refused, never sent.
 */
export function parseFieldOptionsReference(input: unknown): FieldOptionsReference {
  const o = asRecord(input);
  if (o === null) {
    throw new Error("dispatchFieldOptionsRequest: a field reference object is required");
  }
  if ("request" in o || o.kind === "internal") {
    throw new Error(
      "dispatchFieldOptionsRequest: requests are no longer accepted by descriptor; send the field's reference " +
        "({ moduleId, declaration, declarationId, fieldId }). Update the dashboard to a version that does."
    );
  }
  const moduleId = nonEmptyString(o.moduleId);
  const fieldId = nonEmptyString(o.fieldId);
  const declaration = o.declaration;
  if (moduleId === null || fieldId === null) {
    throw new Error("dispatchFieldOptionsRequest: moduleId and fieldId are required");
  }
  if (typeof declaration !== "string" || !(DECLARATIONS as readonly string[]).includes(declaration)) {
    throw new Error(`dispatchFieldOptionsRequest: declaration must be one of ${DECLARATIONS.join(", ")}`);
  }
  if (declaration === "setting") {
    if (o.declarationId !== undefined) {
      throw new Error("dispatchFieldOptionsRequest: a module setting takes no declarationId");
    }
    return { moduleId, declaration, fieldId };
  }
  const declarationId = nonEmptyString(o.declarationId);
  if (declarationId === null) {
    throw new Error(`dispatchFieldOptionsRequest: a ${declaration} field needs its declarationId`);
  }
  return { moduleId, declaration: declaration as FieldOptionsDeclaration, declarationId, fieldId };
}

/** The declaration's list of field entries, or null when the manifest has no such declaration. */
function declaredFields(manifest: Record<string, unknown>, reference: FieldOptionsReference): unknown[] | null {
  if (reference.declaration === "setting") {
    return Array.isArray(manifest.settings) ? manifest.settings : [];
  }
  const [listKey, idKey, fieldsKey] = {
    trigger: ["triggers", "id", "schema"],
    action: ["actions", "id", "schema"],
    widget: ["widgets", "id", "settingsSchema"],
    resource: ["resources", "kind", "schema"],
  }[reference.declaration];
  const entries = Array.isArray(manifest[listKey]) ? (manifest[listKey] as unknown[]) : [];
  const entry = entries.map(asRecord).find((e) => e !== null && e[idKey] === reference.declarationId);
  if (!entry) {
    return null;
  }
  return Array.isArray(entry[fieldsKey]) ? (entry[fieldsKey] as unknown[]) : [];
}

function asInternalDescriptor(value: unknown): FieldOptionsDescriptor | null {
  const o = asRecord(value);
  if (o === null || o.kind !== "internal") {
    return null;
  }
  const request = asRecord(o.request);
  const event = nonEmptyString(request?.event);
  if (request === null || event === null) {
    return null;
  }
  const payload = request.payload === undefined || request.payload === null ? undefined : asRecord(request.payload);
  if (payload === null) {
    return null;
  }
  const timeoutMs = o.timeoutMs === undefined || o.timeoutMs === null ? undefined : o.timeoutMs;
  if (timeoutMs !== undefined && (typeof timeoutMs !== "number" || !Number.isFinite(timeoutMs) || timeoutMs <= 0)) {
    return null;
  }
  return {
    kind: "internal",
    request: payload === undefined ? { event } : { event, payload },
    ...(timeoutMs === undefined ? {} : { timeoutMs }),
  };
}

function describe(reference: FieldOptionsReference): string {
  const owner =
    reference.declaration === "setting"
      ? `${reference.moduleId} settings`
      : `${reference.moduleId}:${reference.declaration}:${reference.declarationId}`;
  return `field "${reference.fieldId}" of ${owner}`;
}

/**
 * The request an installed manifest declares for one field: its `source`, or
 * the `action` of a `button` field. Only `internal` requests are sent by the
 * engine; any other kind is the UI's to resolve and is refused here.
 *
 * `manifest` is the manifest as barkloader stored it at install, which already
 * refused a request on a reserved subject for an uploaded module. Sending
 * exactly what it declares keeps that check the only gate a request passes.
 */
export function fieldOptionsDescriptorFor(
  manifest: Record<string, unknown>,
  reference: FieldOptionsReference
): FieldOptionsDescriptor {
  const fields = declaredFields(manifest, reference);
  if (fields === null) {
    throw new Error(
      `dispatchFieldOptionsRequest: module "${reference.moduleId}" declares no ${reference.declaration} "${reference.declarationId}"`
    );
  }
  const field = fields.map(asRecord).find((f) => f !== null && f.id === reference.fieldId);
  if (!field) {
    throw new Error(`dispatchFieldOptionsRequest: no ${describe(reference)}`);
  }
  const declared = field.type === "button" ? field.action : field.source;
  const descriptor = asInternalDescriptor(declared);
  if (descriptor === null) {
    throw new Error(`dispatchFieldOptionsRequest: ${describe(reference)} declares no internal request`);
  }
  return descriptor;
}
