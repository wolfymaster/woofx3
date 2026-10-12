// The built-in collections and entity types of a composition.
//
// `widgets` holds placements, all of type `widget`. `behaviors` holds the
// transitions, effects and activity windows that act on a widget or on the
// whole canvas. A behavior's kind is either a host kind, which the overlay
// plays on the widget's box, or a kind the widget declares for itself, which
// the widget plays when told to. Whether the target widget actually declares
// a widget kind depends on the installed catalog, so it is checked where the
// catalog is known (`declaresKind`: the engine when it dispatches an alert,
// the overlay as it plays), not here.

import { assert, isPlainObject } from "./composition";
import type {
  CollectionDefinition,
  EntityType,
  FieldSpec,
  JsonSchema,
  KindExecutor,
  RegistryMode,
  SubfieldSpec,
  WidgetTraits,
} from "./registry";
import {
  ANCHOR_KINDS,
  type BehaviorDocument,
  type BehaviorId,
  CANVAS_TARGET,
  EASINGS,
  type Easing,
  type NodeId,
  type PlacementDocument,
  type Timing,
} from "./types";

/** Longest id of an entry in any collection. */
export const ENTRY_ID_MAX_LENGTH = 128;

/**
 * A kind a widget declares for itself, and a behavior type's name. Kept to a
 * CSS-identifier-safe token, since a widget's stylesheet selects on it. Must
 * match `WIDGET_BEHAVIOR_KIND` in module-sdk's widget-behaviors.ts and
 * `is_widget_behavior_kind` in barkloader's manifest_validate.rs.
 */
export const KIND_ID = /^[a-z][a-z0-9-]{0,31}$/;

/** Kinds the overlay plays on a transition's target box, for any widget. */
export const HOST_TRANSITION_KINDS = ["fade", "slide", "zoom", "bounce", "spin", "pop", "blur"] as const;
export type HostTransitionKind = (typeof HOST_TRANSITION_KINDS)[number];

export const TRANSITION_PHASES = ["in", "out"] as const;
export type TransitionPhase = (typeof TRANSITION_PHASES)[number];

/** Which way a `slide` moves: in from the opposite side, out toward this one. */
export const TRANSITION_DIRECTIONS = ["up", "down", "left", "right"] as const;
export type TransitionDirection = (typeof TRANSITION_DIRECTIONS)[number];

export const MIN_TRANSITION_MS = 50;
/**
 * Long enough for any entrance. An out transition holds its target (and an
 * alert) on screen for its length, so it is bounded.
 */
export const MAX_TRANSITION_MS = 10_000;
export const DEFAULT_TRANSITION_MS = 400;

/** Kinds the overlay plays on an effect's target box, for any widget. */
export const HOST_EFFECT_KINDS = ["shake", "pulse", "float", "glow", "flash", "blur"] as const;
export type HostEffectKind = (typeof HOST_EFFECT_KINDS)[number];

/**
 * The kinds a widget declares it plays itself, by behavior type, as the
 * widget catalog lists them (a widget manifest's `transitions` and
 * `effects`). Ids only: what decides whether a behavior is handed to the
 * widget. Both lists are empty for a widget that declares none.
 */
export interface DeclaredBehaviorKinds {
  transitions: readonly string[];
  effects: readonly string[];
}

export const NO_DECLARED_KINDS: DeclaredBehaviorKinds = Object.freeze({
  transitions: Object.freeze([]) as readonly string[],
  effects: Object.freeze([]) as readonly string[],
});

/**
 * Whether a widget declaring `declared` plays `kind` for a behavior of
 * `type` itself. False for every type a widget cannot play, and for host
 * kinds, which a widget may not declare.
 */
export function declaresKind(declared: DeclaredBehaviorKinds, type: string, kind: string): boolean {
  if (type === "transition") {
    return declared.transitions.includes(kind);
  }
  if (type === "effect") {
    return declared.effects.includes(kind);
  }
  return false;
}

export function isDeclaredBehaviorKinds(value: unknown): value is DeclaredBehaviorKinds {
  const isKindList = (list: unknown) =>
    Array.isArray(list) && list.every((kind) => typeof kind === "string" && KIND_ID.test(kind));
  return isPlainObject(value) && isKindList(value.transitions) && isKindList(value.effects);
}

/** The one kind of activity: the window its target is active in. */
export const ACTIVITY_KINDS = ["window"] as const;

/**
 * Largest offset or duration a timing may give. An alert is cut off after
 * five minutes however it is timed, so nothing within one can be longer.
 */
export const MAX_TIMING_MS = 5 * 60 * 1000;

const MAX_WIDGET_ID_LENGTH = 256;
/** Longest `name` a placement may have. */
export const PLACEMENT_NAME_MAX_LENGTH = 256;
const MAX_KEY_LENGTH = 64;

function isFiniteNumber(value: unknown): value is number {
  return typeof value === "number" && Number.isFinite(value);
}

function isIntegerIn(value: unknown, min: number, max: number): value is number {
  return Number.isSafeInteger(value) && (value as number) >= min && (value as number) <= max;
}

function isNumberIn(value: unknown, min: number, max: number): value is number {
  return isFiniteNumber(value) && value >= min && value <= max;
}

function isEntryId(value: unknown): value is string {
  return typeof value === "string" && value.length > 0 && value.length <= ENTRY_ID_MAX_LENGTH;
}

/** A key that sorts as text: a placement's `z`, a behavior's `order`. */
function isSortKey(value: unknown): value is string {
  return typeof value === "string" && value.length > 0 && value.length <= MAX_KEY_LENGTH;
}

function isOneOf<T extends string>(options: readonly T[], value: unknown): value is T {
  return (options as readonly unknown[]).includes(value);
}

const ID_SCHEMA: JsonSchema = { type: "string", minLength: 1, maxLength: ENTRY_ID_MAX_LENGTH };
const SORT_KEY_SCHEMA: JsonSchema = { type: "string", minLength: 1, maxLength: MAX_KEY_LENGTH };
const FINITE_NUMBER_SCHEMA: JsonSchema = { type: "number" };
const OBJECT_SCHEMA: JsonSchema = { type: "object" };

function field(grain: FieldSpec["grain"], valid: (value: unknown) => boolean, schema: JsonSchema): FieldSpec {
  return { grain, valid, schema };
}

const PLACEMENT_FIELDS: Readonly<Record<keyof PlacementDocument, FieldSpec>> = {
  widget: field("value", (v) => typeof v === "string" && v.length > 0 && v.length <= MAX_WIDGET_ID_LENGTH, {
    type: "string",
    minLength: 1,
    maxLength: MAX_WIDGET_ID_LENGTH,
  }),
  x: field("value", isFiniteNumber, FINITE_NUMBER_SCHEMA),
  y: field("value", isFiniteNumber, FINITE_NUMBER_SCHEMA),
  width: field("value", (v) => isFiniteNumber(v) && v >= 0, { type: "number", minimum: 0 }),
  height: field("value", (v) => isFiniteNumber(v) && v >= 0, { type: "number", minimum: 0 }),
  visible: field("value", (v) => typeof v === "boolean", { type: "boolean" }),
  // An identifier, not text: merging two splices of one would make a key neither side wrote.
  z: field("value", isSortKey, SORT_KEY_SCHEMA),
  settings: field("freeform", isPlainObject, OBJECT_SCHEMA),
  name: field("text", (v) => typeof v === "string" && v.length <= PLACEMENT_NAME_MAX_LENGTH, {
    type: "string",
    maxLength: PLACEMENT_NAME_MAX_LENGTH,
  }),
  rotation: field("value", isFiniteNumber, FINITE_NUMBER_SCHEMA),
  opacity: field("value", (v) => isNumberIn(v, 0, 1), { type: "number", minimum: 0, maximum: 1 }),
  locked: field("value", (v) => typeof v === "boolean", { type: "boolean" }),
  extra: field("freeform", isPlainObject, OBJECT_SCHEMA),
};

function isDuration(value: unknown): boolean {
  return value === "until-exit" || isIntegerIn(value, 0, MAX_TIMING_MS);
}

const TIMING_SUBFIELDS: Readonly<Record<keyof Timing, SubfieldSpec>> = {
  anchor: {
    optional: false,
    valid: (v) => isOneOf(ANCHOR_KINDS, v),
    schema: { enum: [...ANCHOR_KINDS] },
  },
  node: { optional: true, valid: isEntryId, schema: ID_SCHEMA },
  offsetMs: {
    optional: false,
    valid: (v) => isIntegerIn(v, -MAX_TIMING_MS, MAX_TIMING_MS),
    schema: { type: "integer", minimum: -MAX_TIMING_MS, maximum: MAX_TIMING_MS },
  },
  durationMs: {
    optional: false,
    valid: isDuration,
    schema: {
      anyOf: [{ const: "until-exit" }, { type: "integer", minimum: 0, maximum: MAX_TIMING_MS }],
    },
  },
  easing: { optional: false, valid: (v) => isOneOf(EASINGS, v), schema: { enum: [...EASINGS] } },
};

function isTiming(value: unknown, mode: RegistryMode): boolean {
  if (!isPlainObject(value)) {
    return false;
  }
  for (const [name, sub] of Object.entries(TIMING_SUBFIELDS)) {
    const present = Object.hasOwn(value, name);
    if (!present && !sub.optional) {
      return false;
    }
    if (present && !sub.valid(value[name])) {
      return false;
    }
  }
  return mode === "tolerant" || Object.keys(value).every((key) => Object.hasOwn(TIMING_SUBFIELDS, key));
}

const BEHAVIOR_FIELDS: Readonly<Record<keyof BehaviorDocument, FieldSpec>> = {
  type: field("fixed", (v) => typeof v === "string" && KIND_ID.test(v), { type: "string", pattern: KIND_ID.source }),
  kind: field("value", (v) => typeof v === "string" && KIND_ID.test(v), { type: "string", pattern: KIND_ID.source }),
  target: field("value", isEntryId, ID_SCHEMA),
  order: field("value", isSortKey, SORT_KEY_SCHEMA),
  timing: {
    grain: "struct",
    valid: isTiming,
    subfields: TIMING_SUBFIELDS,
    schema: {
      type: "object",
      required: Object.entries(TIMING_SUBFIELDS)
        .filter(([, sub]) => !sub.optional)
        .map(([name]) => name),
      properties: Object.fromEntries(Object.entries(TIMING_SUBFIELDS).map(([name, sub]) => [name, sub.schema])),
    },
  },
  params: field("keyed", isPlainObject, OBJECT_SCHEMA),
};

export const WIDGETS_COLLECTION: CollectionDefinition = {
  name: "widgets",
  noun: "placement",
  fields: PLACEMENT_FIELDS,
  typeOf: () => WIDGET_TYPE_NAME,
};

export const BEHAVIORS_COLLECTION: CollectionDefinition = {
  name: "behaviors",
  noun: "behavior",
  fields: BEHAVIOR_FIELDS,
  typeOf: (entry) => (typeof entry.type === "string" ? entry.type : null),
};

export const BUILTIN_COLLECTIONS: readonly CollectionDefinition[] = [WIDGETS_COLLECTION, BEHAVIORS_COLLECTION];

// ---------------------------------------------------------------------------
// widget

export const WIDGET_TYPE_NAME = "widget";

const PLACEMENT_DEFAULTS: Omit<PlacementDocument, "widget" | "width" | "height" | "z"> = {
  x: 0,
  y: 0,
  visible: true,
  settings: {},
  name: "",
  rotation: 0,
  opacity: 1,
  locked: false,
  extra: {},
};

/**
 * The bundled widgets' traits, by canonical id. Text is sized by its own
 * content, so its height is never something the user drags into a value that
 * clips or pads it. Media resize freely, as every other box does, with Shift
 * to keep the aspect: each media widget has a fit setting for how it fills a
 * box of any shape.
 */
export const BUILTIN_WIDGET_TRAITS: Readonly<Record<string, Partial<WidgetTraits>>> = {
  "woofx3:widget:text": { heightFollowsText: true },
};

/**
 * Placement fields a transition was once stored in, read by
 * `migrate`: `{ type, durationMs, easing?, direction? }`, the shape of
 * module-sdk's `PlacementTransition`.
 */
const LEGACY_TRANSITION_FIELDS: Readonly<Record<string, TransitionPhase>> = {
  transitionIn: "in",
  transitionOut: "out",
};

export const WIDGET_TYPE: EntityType = {
  collection: "widgets",
  name: WIDGET_TYPE_NAME,
  invalid: () => null,
  withDefaults(seed) {
    return {
      ...structuredClone(PLACEMENT_DEFAULTS),
      ...seed,
    };
  },
  /**
   * A placement that kept its transitions in `extra` (as `transitionIn` and
   * `transitionOut`) has them lifted into transition behaviors on it, under
   * ids derived from the placement's, so migrating the same document twice
   * gives the same result. A legacy transition that does not parse stays in
   * `extra` as it was rather than being dropped.
   */
  migrate(entry, id) {
    if (!isPlainObject(entry.extra)) {
      return { entry };
    }
    const extra = { ...entry.extra };
    const behaviors: Record<BehaviorId, BehaviorDocument> = {};
    for (const [key, phase] of Object.entries(LEGACY_TRANSITION_FIELDS)) {
      const behavior = behaviorOfLegacyTransition(extra[key], id, phase);
      if (behavior !== null) {
        behaviors[legacyTransitionId(id, phase)] = behavior;
        delete extra[key];
      }
    }
    if (Object.keys(behaviors).length === 0) {
      return { entry };
    }
    return { entry: { ...entry, extra }, behaviors };
  },
  schema: () => ({}),
};

export function legacyTransitionId(placementId: NodeId, phase: TransitionPhase): BehaviorId {
  return `${placementId}:transition-${phase}`;
}

function behaviorOfLegacyTransition(value: unknown, target: NodeId, phase: TransitionPhase): BehaviorDocument | null {
  if (!isPlainObject(value)) {
    return null;
  }
  const { type, durationMs, easing, direction } = value;
  const known = Object.keys(value).every((key) => ["type", "durationMs", "easing", "direction"].includes(key));
  if (
    !known ||
    typeof type !== "string" ||
    !KIND_ID.test(type) ||
    !isIntegerIn(durationMs, MIN_TRANSITION_MS, MAX_TRANSITION_MS) ||
    !(easing === undefined || isOneOf(EASINGS, easing)) ||
    !(direction === undefined || (type === "slide" && isOneOf(TRANSITION_DIRECTIONS, direction)))
  ) {
    return null;
  }
  return {
    type: TRANSITION_TYPE_NAME,
    kind: type,
    target,
    order: "a0",
    timing: {
      anchor: phase === "in" ? "enter" : "exit",
      offsetMs: 0,
      durationMs,
      easing: easing ?? defaultTransitionEasing(phase),
    },
    params: direction === undefined ? { phase } : { phase, direction },
  };
}

// ---------------------------------------------------------------------------
// behaviors

interface ParamSpec {
  valid(value: unknown): boolean;
  schema: JsonSchema;
}

/** What a behavior type needs beyond the shared fields, from which `behaviorType` builds the entity type. */
interface BehaviorTypeDefinition {
  name: string;
  hostKinds: readonly string[];
  /** Whether a widget may declare kinds of this type for itself. */
  widgetKinds: boolean;
  /** Params every kind takes, and whether each is required. */
  commonParams: Readonly<Record<string, ParamSpec & { required: boolean }>>;
  /** Further params a host kind takes, each optional. */
  hostParams: Readonly<Record<string, Readonly<Record<string, ParamSpec>>>>;
  canvasTarget: boolean;
  /** Why the timing does not suit this type, or null. Shared timing checks have passed. */
  invalidTiming(timing: Timing): string | null;
  timingSchema: JsonSchema;
  withDefaults(seed: Partial<BehaviorDocument>): BehaviorDocument;
}

function behaviorType(definition: BehaviorTypeDefinition): EntityType {
  const executorOf = (kind: string): KindExecutor | null => {
    if (definition.hostKinds.includes(kind)) {
      return "host";
    }
    return definition.widgetKinds && KIND_ID.test(kind) ? "widget" : null;
  };
  return {
    collection: "behaviors",
    name: definition.name,
    executorOf,
    invalid(entry, mode) {
      const behavior = entry as unknown as BehaviorDocument;
      const executor = executorOf(behavior.kind);
      if (executor === null) {
        return `a ${definition.name} has no kind ${behavior.kind}`;
      }
      if (behavior.target === CANVAS_TARGET && !definition.canvasTarget) {
        return `a ${definition.name} targets a widget, not the canvas`;
      }
      const timing = definition.invalidTiming(behavior.timing);
      if (timing !== null) {
        return timing;
      }
      return invalidParams(definition, behavior, executor, mode);
    },
    withDefaults: (seed) =>
      definition.withDefaults(seed as Partial<BehaviorDocument>) as unknown as Record<string, unknown>,
    schema: (mode) => behaviorTypeSchema(definition, mode),
  };
}

/**
 * A widget kind's params beyond the common ones are the widget's own,
 * checked against what it declares where the catalog is known, so any are
 * accepted here. A host kind's params are this file's, so in strict mode
 * one it does not take is refused, which catches a misspelling where it is
 * written.
 */
function invalidParams(
  definition: BehaviorTypeDefinition,
  behavior: BehaviorDocument,
  executor: KindExecutor,
  mode: RegistryMode
): string | null {
  const hostParams = executor === "host" ? (definition.hostParams[behavior.kind] ?? {}) : {};
  for (const [name, spec] of Object.entries(definition.commonParams)) {
    if (!Object.hasOwn(behavior.params, name)) {
      if (spec.required) {
        return `a ${definition.name} needs params.${name}`;
      }
      continue;
    }
    if (!spec.valid(behavior.params[name])) {
      return `invalid ${definition.name} params.${name}`;
    }
  }
  for (const [name, value] of Object.entries(behavior.params)) {
    if (Object.hasOwn(definition.commonParams, name)) {
      continue;
    }
    if (Object.hasOwn(hostParams, name)) {
      if (!hostParams[name].valid(value)) {
        return `invalid ${definition.name} params.${name}`;
      }
      continue;
    }
    if (executor === "host" && mode === "strict") {
      return `a ${behavior.kind} ${definition.name} has no param ${name}`;
    }
  }
  return null;
}

function behaviorTypeSchema(definition: BehaviorTypeDefinition, mode: RegistryMode): JsonSchema {
  const common = Object.fromEntries(Object.entries(definition.commonParams).map(([name, spec]) => [name, spec.schema]));
  const required = Object.entries(definition.commonParams)
    .filter(([, spec]) => spec.required)
    .map(([name]) => name);
  const hostBranches = definition.hostKinds.map((kind) => {
    const params = definition.hostParams[kind] ?? {};
    return {
      properties: {
        kind: { const: kind },
        params: {
          type: "object",
          required,
          properties: {
            ...common,
            ...Object.fromEntries(Object.entries(params).map(([name, spec]) => [name, spec.schema])),
          },
          additionalProperties: mode === "tolerant",
        },
      },
    };
  });
  const kindBranches: JsonSchema[] = [...hostBranches];
  if (definition.widgetKinds) {
    kindBranches.push({
      properties: {
        kind: { type: "string", pattern: KIND_ID.source, not: { enum: [...definition.hostKinds] } },
        params: { type: "object", required, properties: common },
      },
    });
  }
  const schema: JsonSchema = {
    properties: { type: { const: definition.name }, timing: definition.timingSchema },
    oneOf: kindBranches,
  };
  if (!definition.canvasTarget) {
    schema.properties = {
      ...(schema.properties as JsonSchema),
      target: { not: { const: CANVAS_TARGET } },
    };
  }
  return schema;
}

function defaultTransitionEasing(phase: TransitionPhase): Easing {
  return phase === "in" ? "ease-out" : "ease-in";
}

function timingWithDefaults(seed: Partial<Timing> | undefined, defaults: Timing): Timing {
  return { ...defaults, ...(seed ?? {}) };
}

function behaviorBase(seed: Partial<BehaviorDocument>, name: string, kind: string): Omit<BehaviorDocument, "timing"> {
  assert(seed.target !== undefined, `a new ${name} names its target`);
  return {
    type: name,
    kind: seed.kind ?? kind,
    target: seed.target,
    order: seed.order ?? "a0",
    params: { ...(seed.params ?? {}) },
  };
}

export const TRANSITION_TYPE_NAME = "transition";
export const EFFECT_TYPE_NAME = "effect";
export const ACTIVITY_TYPE_NAME = "activity";

export const TRANSITION_TYPE: EntityType = behaviorType({
  name: TRANSITION_TYPE_NAME,
  hostKinds: HOST_TRANSITION_KINDS,
  widgetKinds: true,
  commonParams: {
    phase: {
      required: true,
      valid: (v) => isOneOf(TRANSITION_PHASES, v),
      schema: { enum: [...TRANSITION_PHASES] },
    },
  },
  hostParams: {
    slide: {
      direction: { valid: (v) => isOneOf(TRANSITION_DIRECTIONS, v), schema: { enum: [...TRANSITION_DIRECTIONS] } },
    },
  },
  canvasTarget: true,
  invalidTiming(timing) {
    if (!isIntegerIn(timing.durationMs, MIN_TRANSITION_MS, MAX_TRANSITION_MS)) {
      return `a transition lasts from ${MIN_TRANSITION_MS} to ${MAX_TRANSITION_MS} ms`;
    }
    return null;
  },
  timingSchema: {
    properties: { durationMs: { type: "integer", minimum: MIN_TRANSITION_MS, maximum: MAX_TRANSITION_MS } },
  },
  withDefaults(seed) {
    const base = behaviorBase(seed, TRANSITION_TYPE_NAME, "fade");
    const phase: TransitionPhase = isOneOf(TRANSITION_PHASES, base.params.phase) ? base.params.phase : "in";
    const params: Record<string, unknown> = { ...base.params, phase };
    if (base.kind === "slide" && params.direction === undefined) {
      params.direction = "up";
    }
    return {
      ...base,
      params,
      timing: timingWithDefaults(seed.timing, {
        anchor: phase === "in" ? "enter" : "exit",
        offsetMs: 0,
        durationMs: DEFAULT_TRANSITION_MS,
        easing: defaultTransitionEasing(phase),
      }),
    };
  },
});

/** A hex colour only: the overlay writes it into a CSS `filter` value. */
const HEX_COLOR_PATTERN = "^#(?:[0-9a-fA-F]{3}|[0-9a-fA-F]{4}|[0-9a-fA-F]{6}|[0-9a-fA-F]{8})$";

/** Each host effect's tunables, with the value the overlay plays when a param is absent. */
export const EFFECT_DEFAULTS = {
  shake: { distancePx: 10, periodMs: 400 },
  pulse: { scale: 1.1, periodMs: 1000 },
  float: { distancePx: 8, periodMs: 2000 },
  glow: { radiusPx: 12, color: "#ffffff", periodMs: 1500 },
  flash: { brightness: 1.8, periodMs: 800 },
  blur: { radiusPx: 8 },
} as const satisfies Readonly<Record<HostEffectKind, Readonly<Record<string, number | string>>>>;

/**
 * One param a host effect takes: the bounds the registry checks, the value
 * the overlay plays without it, and how an inspector presents it. The
 * registry's checks and JSON Schema are built from these, so an editor that
 * reads them offers exactly what the engine accepts.
 */
export interface EffectParamSpec {
  name: string;
  label: string;
  /** A number, or a hex colour. */
  input: "number" | "color";
  unit?: string;
  min?: number;
  max?: number;
  /** The value must be above `min` rather than at least it. */
  minExclusive: boolean;
  /** A sensible increment for a number input. */
  step: number;
  defaultValue: number | string;
}

type ParamShape = Omit<EffectParamSpec, "name" | "defaultValue">;

const DISTANCE: ParamShape = {
  label: "Distance",
  input: "number",
  unit: "px",
  min: 1,
  max: 500,
  minExclusive: false,
  step: 1,
};
/** One cycle of a repeating effect. */
const PERIOD: ParamShape = {
  label: "Cycle",
  input: "number",
  unit: "ms",
  min: 50,
  max: 60_000,
  minExclusive: false,
  step: 50,
};
/** Above zero: animation.ts takes every numeric effect param as positive. */
const RADIUS: ParamShape = {
  label: "Radius",
  input: "number",
  unit: "px",
  min: 0,
  max: 200,
  minExclusive: true,
  step: 1,
};
const COLOR: ParamShape = { label: "Color", input: "color", minExclusive: false, step: 1 };

function paramsOf<K extends HostEffectKind>(
  kind: K,
  shapes: Readonly<Record<keyof (typeof EFFECT_DEFAULTS)[K] & string, ParamShape>>
): readonly EffectParamSpec[] {
  const defaults = EFFECT_DEFAULTS[kind] as Readonly<Record<string, number | string>>;
  return Object.entries(shapes as Readonly<Record<string, ParamShape>>).map(([name, shape]) => ({
    name,
    ...shape,
    defaultValue: defaults[name],
  }));
}

// Must match the params animation.ts reads for each effect.
const EFFECT_PARAMS: Readonly<Record<HostEffectKind, readonly EffectParamSpec[]>> = {
  shake: paramsOf("shake", { distancePx: DISTANCE, periodMs: PERIOD }),
  pulse: paramsOf("pulse", {
    scale: { label: "Scale", input: "number", unit: "×", min: 1, max: 3, minExclusive: false, step: 0.05 },
    periodMs: PERIOD,
  }),
  float: paramsOf("float", { distancePx: DISTANCE, periodMs: PERIOD }),
  glow: paramsOf("glow", { color: COLOR, radiusPx: RADIUS, periodMs: PERIOD }),
  flash: paramsOf("flash", {
    brightness: { label: "Brightness", input: "number", unit: "×", min: 1, max: 5, minExclusive: false, step: 0.1 },
    periodMs: PERIOD,
  }),
  blur: paramsOf("blur", { radiusPx: RADIUS }),
};

/**
 * The params a host effect `kind` takes, in the order an inspector lists
 * them. Empty for any other kind: a kind a widget declares takes the
 * widget's own params.
 */
export function effectParamSpecs(kind: string): readonly EffectParamSpec[] {
  return (HOST_EFFECT_KINDS as readonly string[]).includes(kind) ? EFFECT_PARAMS[kind as HostEffectKind] : [];
}

function paramSpecOf(spec: EffectParamSpec): ParamSpec {
  if (spec.input === "color") {
    return {
      valid: (v) => typeof v === "string" && new RegExp(HEX_COLOR_PATTERN).test(v),
      schema: { type: "string", pattern: HEX_COLOR_PATTERN },
    };
  }
  const { min, max, minExclusive } = spec;
  const schema: JsonSchema = { type: "number" };
  if (min !== undefined) {
    schema[minExclusive ? "exclusiveMinimum" : "minimum"] = min;
  }
  if (max !== undefined) {
    schema.maximum = max;
  }
  return {
    valid: (v) =>
      isFiniteNumber(v) &&
      (min === undefined || (minExclusive ? v > min : v >= min)) &&
      (max === undefined || v <= max),
    schema,
  };
}

function hostParamsOf(
  table: Readonly<Record<string, readonly EffectParamSpec[]>>
): Readonly<Record<string, Readonly<Record<string, ParamSpec>>>> {
  return Object.fromEntries(
    Object.entries(table).map(([kind, specs]) => [
      kind,
      Object.fromEntries(specs.map((spec) => [spec.name, paramSpecOf(spec)])),
    ])
  );
}

export const EFFECT_TYPE: EntityType = behaviorType({
  name: EFFECT_TYPE_NAME,
  hostKinds: HOST_EFFECT_KINDS,
  widgetKinds: true,
  commonParams: {},
  hostParams: hostParamsOf(EFFECT_PARAMS),
  canvasTarget: true,
  invalidTiming(timing) {
    if (timing.durationMs === 0) {
      return "an effect lasts some time";
    }
    return null;
  },
  timingSchema: {
    properties: {
      durationMs: { anyOf: [{ const: "until-exit" }, { type: "integer", minimum: 1, maximum: MAX_TIMING_MS }] },
    },
  },
  withDefaults(seed) {
    return {
      ...behaviorBase(seed, EFFECT_TYPE_NAME, "pulse"),
      timing: timingWithDefaults(seed.timing, {
        anchor: "enter",
        offsetMs: 0,
        durationMs: "until-exit",
        easing: "ease-in-out",
      }),
    };
  },
});

export const ACTIVITY_TYPE: EntityType = behaviorType({
  name: ACTIVITY_TYPE_NAME,
  hostKinds: ACTIVITY_KINDS,
  widgetKinds: false,
  commonParams: {},
  hostParams: {},
  canvasTarget: false,
  invalidTiming: () => null,
  timingSchema: {},
  withDefaults(seed) {
    return {
      ...behaviorBase(seed, ACTIVITY_TYPE_NAME, "window"),
      timing: timingWithDefaults(seed.timing, {
        anchor: "start",
        offsetMs: 0,
        durationMs: "until-exit",
        easing: "linear",
      }),
    };
  },
});

export const BUILTIN_TYPES: readonly EntityType[] = [WIDGET_TYPE, TRANSITION_TYPE, EFFECT_TYPE, ACTIVITY_TYPE];
