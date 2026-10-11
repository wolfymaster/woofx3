// Playing a stored alert composition: the step names it and fills its
// inputs, and by the time anything is delivered it is an inline alert like
// any other.
//
// The workflow engine publishes `{ composition, inputs }` with every `${...}`
// in the inputs already resolved. Here the composition's latest published
// version is loaded, the inputs are bound into it (an input the step leaves
// out takes its default), and the result is checked with the engine's strict
// registry. The bound document is what the alert's log row records, and what
// a replay plays: what a play showed never changes after the fact, even when
// the composition is edited or deleted.

import {
  type BindReport,
  bindInputs,
  type CompositionDocument,
  type DocumentPath,
  STRICT_REGISTRY,
} from "@woofx3/scene/model";
import type { PublishedComposition } from "../scene/scene-documents";

/** Where published compositions are read from. `SceneDocuments` is one. */
export interface CompositionSource {
  published(compositionId: string): Promise<PublishedComposition | null>;
}

/** A composition ready to play: bound, checked, and which version it came from. */
export interface BoundComposition {
  compositionId: string;
  /** The published version that was bound; see `documentVersion`. */
  version: string;
  /** Inline: no input references and no `inputs`. */
  document: CompositionDocument;
}

export type MaterializedAlert =
  | { ok: true; composition: BoundComposition; ignoredInputs: string[] }
  | { ok: false; reason: string };

/**
 * The step's alert composition, with `inputs` bound into its latest published
 * version, or why it cannot play. Every refusal names the composition, since
 * the reason ends up on the alert's log row with nothing else beside it.
 */
export async function materializeAlert(
  compositionId: string,
  inputs: Readonly<Record<string, unknown>>,
  source: CompositionSource
): Promise<MaterializedAlert> {
  const published = await source.published(compositionId);
  if (published === null) {
    return { ok: false, reason: `alert composition ${compositionId} does not exist` };
  }
  if (published.kind !== "alert") {
    return {
      ok: false,
      reason: `composition ${JSON.stringify(published.name)} (${compositionId}) is a ${published.kind}, not an alert`,
    };
  }
  const named = `alert composition ${JSON.stringify(published.name)}`;
  const bound = bindInputs(published.doc, inputs);
  if (!bound.ok) {
    return { ok: false, reason: `${named} cannot be bound: ${bindFailure(bound.report)}` };
  }
  const { inputs: _declared, ...document } = bound.document;
  const invalid = invalidComposition(document);
  if (invalid !== null) {
    return { ok: false, reason: `${named} is not playable once bound: ${invalid}` };
  }
  return {
    ok: true,
    composition: { compositionId, version: published.version, document },
    ignoredInputs: bound.report.unknownValues,
  };
}

function bindFailure(report: BindReport): string {
  const parts: string[] = [];
  if (report.missing.length > 0) {
    parts.push(`the step gives no value for ${report.missing.join(", ")}, which have no default`);
  }
  const undeclared = [...new Set(report.unknownReferences.map((usage) => usage.input))];
  if (undeclared.length > 0) {
    parts.push(`it refers to inputs it does not declare: ${undeclared.join(", ")}`);
  }
  if (report.malformed.length > 0) {
    parts.push(`it holds a malformed input reference at ${report.malformed.map(pathText).join(", ")}`);
  }
  return parts.join("; ");
}

function pathText(path: DocumentPath): string {
  return path.join(".");
}

/**
 * Why a bound document cannot be played, or null when it can: a canvas with a
 * size, and every widget and behavior a valid entry of a type the engine
 * knows. Bound values come from a step, so they are checked here even though
 * the stored document passed the editor's checks.
 */
export function invalidComposition(doc: CompositionDocument): string | null {
  const { width, height } = doc.layout;
  if (!isPositiveNumber(width) || !isPositiveNumber(height)) {
    return "the canvas needs a positive width and height";
  }
  for (const [id, widget] of Object.entries(doc.widgets)) {
    const invalid = STRICT_REGISTRY.invalidEntry("widgets", widget);
    if (invalid !== null) {
      return `widget ${JSON.stringify(id)}: ${invalid}`;
    }
  }
  for (const [id, behavior] of Object.entries(doc.behaviors)) {
    const invalid = STRICT_REGISTRY.invalidEntry("behaviors", behavior);
    if (invalid !== null) {
      return `behavior ${JSON.stringify(id)}: ${invalid}`;
    }
  }
  return null;
}

/** A stored snapshot read back, or null when it is not a composition. */
export function parseSnapshot(text: string): CompositionDocument | null {
  let parsed: unknown;
  try {
    parsed = JSON.parse(text);
  } catch {
    return null;
  }
  if (!isRecord(parsed) || !isRecord(parsed.layout) || !isRecord(parsed.widgets) || !isRecord(parsed.behaviors)) {
    return null;
  }
  return parsed as unknown as CompositionDocument;
}

function isPositiveNumber(value: unknown): value is number {
  return typeof value === "number" && Number.isFinite(value) && value > 0;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
