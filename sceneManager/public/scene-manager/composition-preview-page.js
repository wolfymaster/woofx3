// ../shared/clients/typescript/module-sdk/dist/widget-assets.js
var ENGINE_ASSET_PREFIXES = ["/assets/user/", "/assets/modules/"];
function engineAssetPath(ref, resourceBaseUrl) {
  let url;
  try {
    url = new URL(ref, resourceBaseUrl);
  } catch {
    return null;
  }
  if (url.protocol !== "http:" && url.protocol !== "https:") {
    return null;
  }
  return ENGINE_ASSET_PREFIXES.some((prefix) => url.pathname.startsWith(prefix)) ? url.pathname : null;
}
// ../shared/clients/typescript/module-sdk/dist/widget-bindings.js
var URL_ATTRIBUTES = ["src", "href", "poster"];
var ELEMENT_SELECTOR = ["[data-setting]", ...URL_ATTRIBUTES.map((a) => `[data-setting-${a}]`)].join(", ");
// ../shared/clients/typescript/module-sdk/dist/widget-protocol.js
var WIDGET_PROTOCOL = "woofx3.widget";
var PROTOCOL_VERSION = 1;
var WIDGET_BOOT_FRAGMENT_PARAM = "boot";
function encodePlacementBoot(boot) {
  const bytes = new TextEncoder().encode(JSON.stringify(boot));
  let binary = "";
  for (const byte of bytes) {
    binary += String.fromCharCode(byte);
  }
  const base64 = btoa(binary).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
  return `${WIDGET_BOOT_FRAGMENT_PARAM}=${base64}`;
}
function isWidgetProtocolEnvelope(value) {
  if (typeof value !== "object" || value === null) {
    return false;
  }
  const msg = value;
  return msg.proto === WIDGET_PROTOCOL && msg.v === PROTOCOL_VERSION && typeof msg.type === "string" && msg.type.length > 0 && typeof msg.nonce === "string" && msg.nonce.length > 0;
}
// ../shared/clients/typescript/module-sdk/dist/widget-fonts.js
var GENERIC_FAMILIES = new Set([
  "serif",
  "sans-serif",
  "monospace",
  "cursive",
  "fantasy",
  "system-ui",
  "ui-serif",
  "ui-sans-serif",
  "ui-monospace",
  "ui-rounded",
  "emoji",
  "math",
  "fangsong",
  "inherit",
  "initial",
  "unset",
  "revert"
]);
// ../shared/clients/typescript/scene/model/composition.ts
function assert(condition, message) {
  if (!condition) {
    throw new Error(`invariant violated: ${message}`);
  }
}
function isPlainObject(value) {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
function sameValue(a, b) {
  if (a === b) {
    return true;
  }
  if (typeof a !== "object" || typeof b !== "object" || a === null || b === null) {
    return false;
  }
  if (Array.isArray(a) || Array.isArray(b)) {
    return Array.isArray(a) && Array.isArray(b) && a.length === b.length && a.every((item, i) => sameValue(item, b[i]));
  }
  const aRecord = a;
  const bRecord = b;
  const aKeys = Object.keys(aRecord);
  if (aKeys.length !== Object.keys(bRecord).length) {
    return false;
  }
  return aKeys.every((key) => Object.hasOwn(bRecord, key) && sameValue(aRecord[key], bRecord[key]));
}
function isCompositionShape(value) {
  return isPlainObject(value) && isPlainObject(value.layout) && isPlainObject(value.widgets) && isPlainObject(value.behaviors);
}
function normalizeComposition(value) {
  if (!isPlainObject(value) || !isPlainObject(value.layout) || !isPlainObject(value.widgets)) {
    return null;
  }
  if (value.behaviors === undefined) {
    return { ...value, behaviors: {} };
  }
  if (!isPlainObject(value.behaviors)) {
    return null;
  }
  return value;
}

// ../shared/clients/typescript/scene/model/types.ts
var CANVAS_TARGET = "canvas";
var ANCHOR_KINDS = ["start", "end", "enter", "exit", "complete"];
var EASINGS = ["linear", "ease", "ease-in", "ease-out", "ease-in-out"];
var PROFILES = {
  scene: { id: "scene", surface: "scene", bounded: false, anchors: ["enter", "exit", "complete"] },
  alert: { id: "alert", surface: "alert", bounded: true, anchors: ["start", "end", "enter", "exit", "complete"] }
};

// ../shared/clients/typescript/scene/model/entity-types.ts
var ENTRY_ID_MAX_LENGTH = 128;
var KIND_ID = /^[a-z][a-z0-9-]{0,31}$/;
var HOST_TRANSITION_KINDS = ["fade", "slide", "zoom", "bounce", "spin", "pop", "blur"];
var TRANSITION_PHASES = ["in", "out"];
var TRANSITION_DIRECTIONS = ["up", "down", "left", "right"];
var MIN_TRANSITION_MS = 50;
var MAX_TRANSITION_MS = 1e4;
var DEFAULT_TRANSITION_MS = 400;
var HOST_EFFECT_KINDS = ["shake", "pulse", "float", "glow", "flash", "blur"];
var NO_DECLARED_KINDS = Object.freeze({
  transitions: Object.freeze([]),
  effects: Object.freeze([])
});
function declaresKind(declared, type, kind) {
  if (type === "transition") {
    return declared.transitions.includes(kind);
  }
  if (type === "effect") {
    return declared.effects.includes(kind);
  }
  return false;
}
function isDeclaredBehaviorKinds(value) {
  const isKindList = (list) => Array.isArray(list) && list.every((kind) => typeof kind === "string" && KIND_ID.test(kind));
  return isPlainObject(value) && isKindList(value.transitions) && isKindList(value.effects);
}
var ACTIVITY_KINDS = ["window"];
var MAX_TIMING_MS = 5 * 60 * 1000;
var MAX_WIDGET_ID_LENGTH = 256;
var PLACEMENT_NAME_MAX_LENGTH = 256;
var MAX_KEY_LENGTH = 64;
function isFiniteNumber(value) {
  return typeof value === "number" && Number.isFinite(value);
}
function isIntegerIn(value, min, max) {
  return Number.isSafeInteger(value) && value >= min && value <= max;
}
function isNumberIn(value, min, max) {
  return isFiniteNumber(value) && value >= min && value <= max;
}
function isEntryId(value) {
  return typeof value === "string" && value.length > 0 && value.length <= ENTRY_ID_MAX_LENGTH;
}
function isSortKey(value) {
  return typeof value === "string" && value.length > 0 && value.length <= MAX_KEY_LENGTH;
}
function isOneOf(options, value) {
  return options.includes(value);
}
var ID_SCHEMA = { type: "string", minLength: 1, maxLength: ENTRY_ID_MAX_LENGTH };
var SORT_KEY_SCHEMA = { type: "string", minLength: 1, maxLength: MAX_KEY_LENGTH };
var FINITE_NUMBER_SCHEMA = { type: "number" };
var OBJECT_SCHEMA = { type: "object" };
function field(grain, valid, schema) {
  return { grain, valid, schema };
}
var PLACEMENT_FIELDS = {
  widget: field("value", (v) => typeof v === "string" && v.length > 0 && v.length <= MAX_WIDGET_ID_LENGTH, {
    type: "string",
    minLength: 1,
    maxLength: MAX_WIDGET_ID_LENGTH
  }),
  x: field("value", isFiniteNumber, FINITE_NUMBER_SCHEMA),
  y: field("value", isFiniteNumber, FINITE_NUMBER_SCHEMA),
  width: field("value", (v) => isFiniteNumber(v) && v >= 0, { type: "number", minimum: 0 }),
  height: field("value", (v) => isFiniteNumber(v) && v >= 0, { type: "number", minimum: 0 }),
  visible: field("value", (v) => typeof v === "boolean", { type: "boolean" }),
  z: field("value", isSortKey, SORT_KEY_SCHEMA),
  settings: field("freeform", isPlainObject, OBJECT_SCHEMA),
  name: field("text", (v) => typeof v === "string" && v.length <= PLACEMENT_NAME_MAX_LENGTH, {
    type: "string",
    maxLength: PLACEMENT_NAME_MAX_LENGTH
  }),
  rotation: field("value", isFiniteNumber, FINITE_NUMBER_SCHEMA),
  opacity: field("value", (v) => isNumberIn(v, 0, 1), { type: "number", minimum: 0, maximum: 1 }),
  locked: field("value", (v) => typeof v === "boolean", { type: "boolean" }),
  extra: field("freeform", isPlainObject, OBJECT_SCHEMA)
};
function isDuration(value) {
  return value === "until-exit" || isIntegerIn(value, 0, MAX_TIMING_MS);
}
var TIMING_SUBFIELDS = {
  anchor: {
    optional: false,
    valid: (v) => isOneOf(ANCHOR_KINDS, v),
    schema: { enum: [...ANCHOR_KINDS] }
  },
  node: { optional: true, valid: isEntryId, schema: ID_SCHEMA },
  offsetMs: {
    optional: false,
    valid: (v) => isIntegerIn(v, -MAX_TIMING_MS, MAX_TIMING_MS),
    schema: { type: "integer", minimum: -MAX_TIMING_MS, maximum: MAX_TIMING_MS }
  },
  durationMs: {
    optional: false,
    valid: isDuration,
    schema: {
      anyOf: [{ const: "until-exit" }, { type: "integer", minimum: 0, maximum: MAX_TIMING_MS }]
    }
  },
  easing: { optional: false, valid: (v) => isOneOf(EASINGS, v), schema: { enum: [...EASINGS] } }
};
function isTiming(value, mode) {
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
var BEHAVIOR_FIELDS = {
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
      required: Object.entries(TIMING_SUBFIELDS).filter(([, sub]) => !sub.optional).map(([name]) => name),
      properties: Object.fromEntries(Object.entries(TIMING_SUBFIELDS).map(([name, sub]) => [name, sub.schema]))
    }
  },
  params: field("keyed", isPlainObject, OBJECT_SCHEMA)
};
var WIDGETS_COLLECTION = {
  name: "widgets",
  noun: "placement",
  fields: PLACEMENT_FIELDS,
  typeOf: () => WIDGET_TYPE_NAME
};
var BEHAVIORS_COLLECTION = {
  name: "behaviors",
  noun: "behavior",
  fields: BEHAVIOR_FIELDS,
  typeOf: (entry) => typeof entry.type === "string" ? entry.type : null
};
var BUILTIN_COLLECTIONS = [WIDGETS_COLLECTION, BEHAVIORS_COLLECTION];
var WIDGET_TYPE_NAME = "widget";
var PLACEMENT_DEFAULTS = {
  x: 0,
  y: 0,
  visible: true,
  settings: {},
  name: "",
  rotation: 0,
  opacity: 1,
  locked: false,
  extra: {}
};
var BUILTIN_WIDGET_TRAITS = {
  "woofx3:widget:text": { heightFollowsText: true }
};
var LEGACY_TRANSITION_FIELDS = {
  transitionIn: "in",
  transitionOut: "out"
};
var WIDGET_TYPE = {
  collection: "widgets",
  name: WIDGET_TYPE_NAME,
  invalid: () => null,
  withDefaults(seed) {
    return {
      ...structuredClone(PLACEMENT_DEFAULTS),
      ...seed
    };
  },
  migrate(entry, id) {
    if (!isPlainObject(entry.extra)) {
      return { entry };
    }
    const extra = { ...entry.extra };
    const behaviors = {};
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
  schema: () => ({})
};
function legacyTransitionId(placementId, phase) {
  return `${placementId}:transition-${phase}`;
}
function behaviorOfLegacyTransition(value, target, phase) {
  if (!isPlainObject(value)) {
    return null;
  }
  const { type, durationMs, easing, direction } = value;
  const known = Object.keys(value).every((key) => ["type", "durationMs", "easing", "direction"].includes(key));
  if (!known || typeof type !== "string" || !KIND_ID.test(type) || !isIntegerIn(durationMs, MIN_TRANSITION_MS, MAX_TRANSITION_MS) || !(easing === undefined || isOneOf(EASINGS, easing)) || !(direction === undefined || type === "slide" && isOneOf(TRANSITION_DIRECTIONS, direction))) {
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
      easing: easing ?? defaultTransitionEasing(phase)
    },
    params: direction === undefined ? { phase } : { phase, direction }
  };
}
function behaviorType(definition) {
  const executorOf = (kind) => {
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
      const behavior = entry;
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
    withDefaults: (seed) => definition.withDefaults(seed),
    schema: (mode) => behaviorTypeSchema(definition, mode)
  };
}
function invalidParams(definition, behavior, executor, mode) {
  const hostParams = executor === "host" ? definition.hostParams[behavior.kind] ?? {} : {};
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
function behaviorTypeSchema(definition, mode) {
  const common = Object.fromEntries(Object.entries(definition.commonParams).map(([name, spec]) => [name, spec.schema]));
  const required = Object.entries(definition.commonParams).filter(([, spec]) => spec.required).map(([name]) => name);
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
            ...Object.fromEntries(Object.entries(params).map(([name, spec]) => [name, spec.schema]))
          },
          additionalProperties: mode === "tolerant"
        }
      }
    };
  });
  const kindBranches = [...hostBranches];
  if (definition.widgetKinds) {
    kindBranches.push({
      properties: {
        kind: { type: "string", pattern: KIND_ID.source, not: { enum: [...definition.hostKinds] } },
        params: { type: "object", required, properties: common }
      }
    });
  }
  const schema = {
    properties: { type: { const: definition.name }, timing: definition.timingSchema },
    oneOf: kindBranches
  };
  if (!definition.canvasTarget) {
    schema.properties = {
      ...schema.properties,
      target: { not: { const: CANVAS_TARGET } }
    };
  }
  return schema;
}
function defaultTransitionEasing(phase) {
  return phase === "in" ? "ease-out" : "ease-in";
}
function timingWithDefaults(seed, defaults) {
  return { ...defaults, ...seed ?? {} };
}
function behaviorBase(seed, name, kind) {
  assert(seed.target !== undefined, `a new ${name} names its target`);
  return {
    type: name,
    kind: seed.kind ?? kind,
    target: seed.target,
    order: seed.order ?? "a0",
    params: { ...seed.params ?? {} }
  };
}
var TRANSITION_TYPE_NAME = "transition";
var EFFECT_TYPE_NAME = "effect";
var ACTIVITY_TYPE_NAME = "activity";
var TRANSITION_TYPE = behaviorType({
  name: TRANSITION_TYPE_NAME,
  hostKinds: HOST_TRANSITION_KINDS,
  widgetKinds: true,
  commonParams: {
    phase: {
      required: true,
      valid: (v) => isOneOf(TRANSITION_PHASES, v),
      schema: { enum: [...TRANSITION_PHASES] }
    }
  },
  hostParams: {
    slide: {
      direction: { valid: (v) => isOneOf(TRANSITION_DIRECTIONS, v), schema: { enum: [...TRANSITION_DIRECTIONS] } }
    }
  },
  canvasTarget: true,
  invalidTiming(timing) {
    if (!isIntegerIn(timing.durationMs, MIN_TRANSITION_MS, MAX_TRANSITION_MS)) {
      return `a transition lasts from ${MIN_TRANSITION_MS} to ${MAX_TRANSITION_MS} ms`;
    }
    return null;
  },
  timingSchema: {
    properties: { durationMs: { type: "integer", minimum: MIN_TRANSITION_MS, maximum: MAX_TRANSITION_MS } }
  },
  withDefaults(seed) {
    const base = behaviorBase(seed, TRANSITION_TYPE_NAME, "fade");
    const phase = isOneOf(TRANSITION_PHASES, base.params.phase) ? base.params.phase : "in";
    const params = { ...base.params, phase };
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
        easing: defaultTransitionEasing(phase)
      })
    };
  }
});
var HEX_COLOR_PATTERN = "^#(?:[0-9a-fA-F]{3}|[0-9a-fA-F]{4}|[0-9a-fA-F]{6}|[0-9a-fA-F]{8})$";
var EFFECT_DEFAULTS = {
  shake: { distancePx: 10, periodMs: 400 },
  pulse: { scale: 1.1, periodMs: 1000 },
  float: { distancePx: 8, periodMs: 2000 },
  glow: { radiusPx: 12, color: "#ffffff", periodMs: 1500 },
  flash: { brightness: 1.8, periodMs: 800 },
  blur: { radiusPx: 8 }
};
var DISTANCE = {
  label: "Distance",
  input: "number",
  unit: "px",
  min: 1,
  max: 500,
  minExclusive: false,
  step: 1
};
var PERIOD = {
  label: "Cycle",
  input: "number",
  unit: "ms",
  min: 50,
  max: 60000,
  minExclusive: false,
  step: 50
};
var RADIUS = {
  label: "Radius",
  input: "number",
  unit: "px",
  min: 0,
  max: 200,
  minExclusive: true,
  step: 1
};
var COLOR = { label: "Color", input: "color", minExclusive: false, step: 1 };
function paramsOf(kind, shapes) {
  const defaults = EFFECT_DEFAULTS[kind];
  return Object.entries(shapes).map(([name, shape]) => ({
    name,
    ...shape,
    defaultValue: defaults[name]
  }));
}
var EFFECT_PARAMS = {
  shake: paramsOf("shake", { distancePx: DISTANCE, periodMs: PERIOD }),
  pulse: paramsOf("pulse", {
    scale: { label: "Scale", input: "number", unit: "×", min: 1, max: 3, minExclusive: false, step: 0.05 },
    periodMs: PERIOD
  }),
  float: paramsOf("float", { distancePx: DISTANCE, periodMs: PERIOD }),
  glow: paramsOf("glow", { color: COLOR, radiusPx: RADIUS, periodMs: PERIOD }),
  flash: paramsOf("flash", {
    brightness: { label: "Brightness", input: "number", unit: "×", min: 1, max: 5, minExclusive: false, step: 0.1 },
    periodMs: PERIOD
  }),
  blur: paramsOf("blur", { radiusPx: RADIUS })
};
function paramSpecOf(spec) {
  if (spec.input === "color") {
    return {
      valid: (v) => typeof v === "string" && new RegExp(HEX_COLOR_PATTERN).test(v),
      schema: { type: "string", pattern: HEX_COLOR_PATTERN }
    };
  }
  const { min, max, minExclusive } = spec;
  const schema = { type: "number" };
  if (min !== undefined) {
    schema[minExclusive ? "exclusiveMinimum" : "minimum"] = min;
  }
  if (max !== undefined) {
    schema.maximum = max;
  }
  return {
    valid: (v) => isFiniteNumber(v) && (min === undefined || (minExclusive ? v > min : v >= min)) && (max === undefined || v <= max),
    schema
  };
}
function hostParamsOf(table) {
  return Object.fromEntries(Object.entries(table).map(([kind, specs]) => [
    kind,
    Object.fromEntries(specs.map((spec) => [spec.name, paramSpecOf(spec)]))
  ]));
}
var EFFECT_TYPE = behaviorType({
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
      durationMs: { anyOf: [{ const: "until-exit" }, { type: "integer", minimum: 1, maximum: MAX_TIMING_MS }] }
    }
  },
  withDefaults(seed) {
    return {
      ...behaviorBase(seed, EFFECT_TYPE_NAME, "pulse"),
      timing: timingWithDefaults(seed.timing, {
        anchor: "enter",
        offsetMs: 0,
        durationMs: "until-exit",
        easing: "ease-in-out"
      })
    };
  }
});
var ACTIVITY_TYPE = behaviorType({
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
        easing: "linear"
      })
    };
  }
});
var BUILTIN_TYPES = [WIDGET_TYPE, TRANSITION_TYPE, EFFECT_TYPE, ACTIVITY_TYPE];

// ../shared/clients/typescript/scene/model/animation.ts
function isHostKind(type, kind) {
  if (type === "transition") {
    return HOST_TRANSITION_KINDS.includes(kind);
  }
  if (type === "effect") {
    return HOST_EFFECT_KINDS.includes(kind);
  }
  return false;
}
function compileAnimation(behavior, window2) {
  if (!isHostKind(behavior.type, behavior.kind)) {
    return null;
  }
  assertWindow(window2);
  if (behavior.type === "transition") {
    return compileTransition(behavior, window2);
  }
  return compileEffect(behavior, window2);
}
var SLIDE_OFFSET = {
  up: { enter: "translate(0, 100%)", leave: "translate(0, -100%)" },
  down: { enter: "translate(0, -100%)", leave: "translate(0, 100%)" },
  left: { enter: "translate(100%, 0)", leave: "translate(-100%, 0)" },
  right: { enter: "translate(-100%, 0)", leave: "translate(100%, 0)" }
};
var SHOWN = { opacity: 1, transform: "none" };
function compileTransition(behavior, window2) {
  const phase = behavior.params.phase;
  if (phase !== "in" && phase !== "out") {
    throw new Error(`animation: a transition's params.phase must be "in" or "out"`);
  }
  if (window2.endMs === null) {
    throw new Error("animation: a transition must have an end");
  }
  const kind = behavior.kind;
  const direction = slideDirection(behavior);
  return {
    layer: "transition",
    keyframes: transitionKeyframes(kind, phase, direction),
    timing: {
      duration: window2.endMs - window2.startMs,
      easing: behavior.timing.easing,
      delay: window2.startMs,
      fill: "both",
      iterations: 1
    }
  };
}
function transitionKeyframes(kind, phase, direction = "up") {
  const entrance = entranceKeyframes(kind, phase, direction);
  if (phase === "in") {
    return entrance;
  }
  return entrance.slice().reverse().map((frame) => frame.offset === undefined ? frame : { ...frame, offset: 1 - frame.offset });
}
function entranceKeyframes(kind, phase, direction) {
  switch (kind) {
    case "fade":
      return [
        { opacity: 0, transform: "none" },
        { opacity: 1, transform: "none" }
      ];
    case "slide": {
      const offset = SLIDE_OFFSET[direction];
      return [{ opacity: 0, transform: phase === "in" ? offset.enter : offset.leave }, { ...SHOWN }];
    }
    case "zoom":
      return [{ opacity: 0, transform: "scale(0.5)" }, { ...SHOWN }];
    case "bounce":
      return [
        { opacity: 0, transform: "scale(0.3)" },
        { opacity: 1, transform: "scale(1.08)", offset: 0.5 },
        { opacity: 1, transform: "scale(0.94)", offset: 0.75 },
        { ...SHOWN }
      ];
    case "spin":
      return [{ opacity: 0, transform: "rotate(-360deg) scale(0)" }, { ...SHOWN }];
    case "pop":
      return [
        { opacity: 0, transform: "scale(0)" },
        { opacity: 1, transform: "scale(1.15)", offset: 0.7 },
        { ...SHOWN }
      ];
    case "blur":
      return [
        { opacity: 0, transform: "none", filter: "blur(16px)" },
        { ...SHOWN, filter: "none" }
      ];
    default:
      throw new Error(`animation: no keyframes for transition ${String(kind)}`);
  }
}
function slideDirection(behavior) {
  const direction = behavior.params.direction;
  if (direction === undefined) {
    return "up";
  }
  if (!TRANSITION_DIRECTIONS.includes(direction)) {
    throw new Error(`animation: params.direction must be one of ${TRANSITION_DIRECTIONS.join(", ")}`);
  }
  return direction;
}
var HEX_COLOR = /^#(?:[0-9a-f]{3}|[0-9a-f]{4}|[0-9a-f]{6}|[0-9a-f]{8})$/i;
function compileEffect(behavior, window2) {
  const kind = behavior.kind;
  const length = window2.endMs === null ? Number.POSITIVE_INFINITY : window2.endMs - window2.startMs;
  const { keyframes, periodMs } = effectCycle(kind, behavior.params);
  const duration = periodMs ?? length;
  const iterations = periodMs === null ? 1 : length / periodMs;
  return {
    layer: "effect",
    keyframes,
    timing: {
      duration,
      easing: behavior.timing.easing,
      delay: window2.startMs,
      fill: "none",
      iterations
    }
  };
}
function effectCycle(kind, params) {
  switch (kind) {
    case "shake": {
      const distance = positiveParam(params, "distancePx", EFFECT_DEFAULTS.shake.distancePx);
      const at = (x, offset) => offset === undefined ? { transform: `translateX(${x}px)` } : { transform: `translateX(${x}px)`, offset };
      return {
        keyframes: [at(0), at(-distance, 0.2), at(distance, 0.4), at(-distance, 0.6), at(distance, 0.8), at(0)],
        periodMs: positiveParam(params, "periodMs", EFFECT_DEFAULTS.shake.periodMs)
      };
    }
    case "pulse": {
      const scale = positiveParam(params, "scale", EFFECT_DEFAULTS.pulse.scale);
      return {
        keyframes: [
          { transform: "scale(1)" },
          { transform: `scale(${scale})`, offset: 0.5 },
          { transform: "scale(1)" }
        ],
        periodMs: positiveParam(params, "periodMs", EFFECT_DEFAULTS.pulse.periodMs)
      };
    }
    case "glow": {
      const radius = positiveParam(params, "radiusPx", EFFECT_DEFAULTS.glow.radiusPx);
      const color = colorParam(params, "color", EFFECT_DEFAULTS.glow.color);
      return {
        keyframes: [
          { filter: `drop-shadow(0 0 0px ${color})` },
          { filter: `drop-shadow(0 0 ${radius}px ${color})`, offset: 0.5 },
          { filter: `drop-shadow(0 0 0px ${color})` }
        ],
        periodMs: positiveParam(params, "periodMs", EFFECT_DEFAULTS.glow.periodMs)
      };
    }
    case "float": {
      const distance = positiveParam(params, "distancePx", EFFECT_DEFAULTS.float.distancePx);
      return {
        keyframes: [
          { transform: "translateY(0px)" },
          { transform: `translateY(${-distance}px)`, offset: 0.5 },
          { transform: "translateY(0px)" }
        ],
        periodMs: positiveParam(params, "periodMs", EFFECT_DEFAULTS.float.periodMs)
      };
    }
    case "flash": {
      const brightness = positiveParam(params, "brightness", EFFECT_DEFAULTS.flash.brightness);
      return {
        keyframes: [
          { filter: "brightness(1)" },
          { filter: `brightness(${brightness})`, offset: 0.5 },
          { filter: "brightness(1)" }
        ],
        periodMs: positiveParam(params, "periodMs", EFFECT_DEFAULTS.flash.periodMs)
      };
    }
    case "blur": {
      const radius = positiveParam(params, "radiusPx", EFFECT_DEFAULTS.blur.radiusPx);
      return {
        keyframes: [{ filter: `blur(${radius}px)` }, { filter: `blur(${radius}px)` }],
        periodMs: null
      };
    }
    default:
      throw new Error(`animation: no keyframes for effect ${String(kind)}`);
  }
}
function positiveParam(params, name, fallback) {
  const value = params[name];
  if (value === undefined) {
    return fallback;
  }
  if (typeof value !== "number" || !Number.isFinite(value) || value <= 0) {
    throw new Error(`animation: params.${name} must be a positive number`);
  }
  return value;
}
function colorParam(params, name, fallback) {
  const value = params[name];
  if (value === undefined) {
    return fallback;
  }
  if (typeof value !== "string" || !HEX_COLOR.test(value)) {
    throw new Error(`animation: params.${name} must be a hex colour`);
  }
  return value;
}
function assertWindow(window2) {
  if (!Number.isFinite(window2.startMs)) {
    throw new Error("animation: window.startMs must be a finite number");
  }
  if (window2.endMs !== null && !(Number.isFinite(window2.endMs) && window2.endMs >= window2.startMs)) {
    throw new Error("animation: window.endMs must be a finite number no earlier than startMs");
  }
}
// ../shared/clients/typescript/scene/model/bind.ts
function bindInputs(doc, values) {
  const declared = declaredInputs(doc.inputs ?? []);
  const usages = [];
  const malformed = [];
  walkDocument(doc, (value, path) => {
    collect(value, path, usages, malformed);
    return value;
  });
  const resolved = new Map;
  const missing = [];
  for (const [id, field2] of declared) {
    if (values[id] !== undefined) {
      resolved.set(id, values[id]);
    } else if (field2.defaultValue !== undefined) {
      resolved.set(id, field2.defaultValue);
    } else {
      missing.push(id);
    }
  }
  const report = {
    missing,
    unknownValues: Object.keys(values).filter((id) => values[id] !== undefined && !declared.has(id)).sort(),
    unknownReferences: usages.filter((usage) => !declared.has(usage.input)),
    malformed
  };
  if (report.missing.length > 0 || report.unknownReferences.length > 0 || report.malformed.length > 0) {
    return { ok: false, report };
  }
  let substituted = 0;
  const document2 = walkDocument(doc, (value) => substitute(value, resolved, () => {
    substituted += 1;
  }));
  if (substituted !== usages.length) {
    throw new Error(`bind: replaced ${substituted} input references but found ${usages.length}`);
  }
  return { ok: true, document: document2, report };
}
function declaredInputs(inputs) {
  const declared = new Map;
  for (const field2 of inputs) {
    if (typeof field2.id !== "string" || field2.id === "") {
      throw new Error("bind: every input must have an id");
    }
    if (declared.has(field2.id)) {
      throw new Error(`bind: input ${field2.id} is declared twice`);
    }
    declared.set(field2.id, field2);
  }
  return declared;
}
function walkDocument(doc, visit) {
  const layout = visit(doc.layout, ["layout"]);
  const widgets = {};
  for (const [id, widget] of Object.entries(doc.widgets)) {
    widgets[id] = {
      ...widget,
      settings: visit(widget.settings, ["widgets", id, "settings"])
    };
  }
  const behaviors = {};
  for (const [id, behavior] of Object.entries(doc.behaviors)) {
    behaviors[id] = {
      ...behavior,
      params: visit(behavior.params, ["behaviors", id, "params"])
    };
  }
  return {
    ...doc,
    layout,
    widgets,
    behaviors
  };
}
function collect(value, path, usages, malformed) {
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
function asReference(value) {
  if (!Object.hasOwn(value, "$input")) {
    return null;
  }
  const keys = Object.keys(value);
  if (keys.length !== 1 || typeof value.$input !== "string" || value.$input === "") {
    return "malformed";
  }
  return value.$input;
}
function substitute(value, resolved, counted) {
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
      return structuredClone(lookup(resolved, reference));
    }
    const copy = {};
    for (const [key, item] of Object.entries(value)) {
      copy[key] = substitute(item, resolved, counted);
    }
    return copy;
  }
  return value;
}
function lookup(resolved, id) {
  if (!resolved.has(id)) {
    throw new Error(`bind: input ${id} has no value`);
  }
  return resolved.get(id);
}
function asText(value) {
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
var REFERENCE = /^\{\{\s*([A-Za-z0-9_.-]+)\s*\}\}/;
function parseText(value) {
  const parts = [];
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
function isRecord(value) {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
// ../shared/clients/typescript/scene/model/keys.ts
var DIGITS = "0123456789abcdefghijklmnopqrstuvwxyz";
var BASE = DIGITS.length;
var FIRST_KEY = DIGITS[BASE / 2];
function isOrderKey(key) {
  if (key.length === 0) {
    return false;
  }
  for (const char of key) {
    if (!DIGITS.includes(char)) {
      return false;
    }
  }
  return true;
}
function evenKeys(n) {
  assert(Number.isSafeInteger(n) && n >= 0 && n <= BASE ** 4, "too many entries to number");
  const keys = [];
  for (let i = 0;i < n; i++) {
    keys.push(`a${(i + 1).toString(BASE).padStart(4, "0")}`);
  }
  return keys;
}
// ../shared/clients/typescript/scene/model/legacy-alert.ts
function isLegacyAlertLayout(value) {
  return isPlainObject(value) && Array.isArray(value.widgets);
}
function compositionOfLegacyAlert(legacy) {
  const { widgets: entries, ...canvas } = legacy;
  const kept = [];
  const skipped = [];
  const seen = new Set;
  entries.forEach((raw, index) => {
    const entry = isPlainObject(raw) ? raw : {};
    const widgetCanonicalId = typeof entry.widgetCanonicalId === "string" ? entry.widgetCanonicalId : "";
    const id = typeof entry.id === "string" ? entry.id : "";
    if (!isPlainObject(raw)) {
      skipped.push({ index, widgetCanonicalId, reason: "a layout widget must be an object" });
      return;
    }
    if (id.length === 0) {
      skipped.push({ index, widgetCanonicalId, reason: "a layout widget needs an `id`" });
      return;
    }
    if (seen.has(id)) {
      skipped.push({ index, widgetCanonicalId, reason: `duplicate id ${JSON.stringify(id)}` });
      return;
    }
    seen.add(id);
    kept.push({ id, index, entry });
  });
  const zKeys = evenKeys(kept.length);
  const widgets = {};
  const indexOf = {};
  stackingOrder(kept).forEach(({ id, index, entry }, rank) => {
    widgets[id] = placementOf(entry, zKeys[rank]);
    indexOf[id] = index;
  });
  return { doc: { layout: canvas, widgets, behaviors: {} }, indexOf, skipped };
}
function stackingOrder(kept) {
  const zIndexed = kept.every(({ entry }) => isFiniteNumber2(entry.zIndex));
  if (!zIndexed) {
    return kept;
  }
  return [...kept].sort((a, b) => a.entry.zIndex - b.entry.zIndex);
}
function alertCompositionOf(value) {
  if (isLegacyAlertLayout(value)) {
    return compositionOfLegacyAlert(value).doc;
  }
  return normalizeComposition(value);
}
var LEGACY_ENTRY_FIELDS = new Set([
  "id",
  "widgetCanonicalId",
  "position",
  "size",
  "settings",
  "name",
  "visible",
  "rotation",
  "opacity",
  "locked",
  "zIndex"
]);
function placementOf(entry, z) {
  const position = isPlainObject(entry.position) ? entry.position : {};
  const size = isPlainObject(entry.size) ? entry.size : {};
  const extra = {};
  for (const [key, value] of Object.entries(entry)) {
    if (!LEGACY_ENTRY_FIELDS.has(key)) {
      extra[key] = value;
    }
  }
  return {
    widget: typeof entry.widgetCanonicalId === "string" ? entry.widgetCanonicalId : "",
    x: numberOr(position.x, 0),
    y: numberOr(position.y, 0),
    width: numberOr(position.width, numberOr(size.width, 0)),
    height: numberOr(position.height, numberOr(size.height, 0)),
    visible: typeof entry.visible === "boolean" ? entry.visible : true,
    z,
    settings: isPlainObject(entry.settings) ? entry.settings : {},
    name: typeof entry.name === "string" && entry.name.length <= PLACEMENT_NAME_MAX_LENGTH ? entry.name : "",
    rotation: numberOr(entry.rotation, 0),
    opacity: isFiniteNumber2(entry.opacity) && entry.opacity >= 0 && entry.opacity <= 1 ? entry.opacity : 1,
    locked: typeof entry.locked === "boolean" ? entry.locked : false,
    extra
  };
}
function isFiniteNumber2(value) {
  return typeof value === "number" && Number.isFinite(value);
}
function numberOr(value, fallback) {
  return isFiniteNumber2(value) ? value : fallback;
}
// ../shared/clients/typescript/scene/model/registry.ts
var DEFAULT_WIDGET_TRAITS = { keepsAspect: false, heightFollowsText: false };

class TypeRegistry {
  mode;
  collections;
  types;
  traits;
  constructor(mode, collections, types, widgetTraits = {}) {
    const byName = new Map;
    for (const collection of collections) {
      assert(!byName.has(collection.name), `collection ${collection.name} is defined once`);
      byName.set(collection.name, collection);
    }
    const byKey = new Map;
    for (const type of types) {
      assert(byName.has(type.collection), `type ${type.name} belongs to a defined collection`);
      const key = typeKey(type.collection, type.name);
      assert(!byKey.has(key), `type ${key} is registered once`);
      byKey.set(key, type);
    }
    this.mode = mode;
    this.collections = byName;
    this.types = byKey;
    this.traits = new Map(Object.entries(widgetTraits).map(([widgetId, traits]) => [widgetId, { ...DEFAULT_WIDGET_TRAITS, ...traits }]));
  }
  widgetTraits(widgetId) {
    return this.traits.get(widgetId) ?? DEFAULT_WIDGET_TRAITS;
  }
  isCollection(name) {
    return typeof name === "string" && this.collections.has(name);
  }
  collection(name) {
    const collection = this.collections.get(name);
    assert(collection !== undefined, `collection ${name} is defined`);
    return collection;
  }
  collectionNames() {
    return [...this.collections.keys()];
  }
  field(collection, field2) {
    const fields = this.collection(collection).fields;
    return Object.hasOwn(fields, field2) ? fields[field2] : undefined;
  }
  type(collection, name) {
    return this.types.get(typeKey(collection, name));
  }
  typesOf(collection) {
    return [...this.types.values()].filter((type) => type.collection === collection);
  }
  executorOf(type, kind) {
    return this.type("behaviors", type)?.executorOf?.(kind) ?? null;
  }
  hasExactFields(collection, value) {
    if (!isPlainObject(value)) {
      return false;
    }
    const fields = this.collection(collection).fields;
    const keys = Object.keys(value);
    return keys.length === Object.keys(fields).length && keys.every((key) => Object.hasOwn(fields, key));
  }
  invalidEntry(collection, value) {
    const definition = this.collection(collection);
    if (!isPlainObject(value)) {
      return `a ${definition.noun} must be an object`;
    }
    const typeName = definition.typeOf(value);
    const type = typeName === null ? undefined : this.type(collection, typeName);
    if (type === undefined) {
      if (this.mode === "tolerant" && typeName !== null) {
        return null;
      }
      return `unknown ${definition.noun} type ${JSON.stringify(typeName)}`;
    }
    for (const [field2, spec] of Object.entries(definition.fields)) {
      if (!Object.hasOwn(value, field2)) {
        return `a ${definition.noun} needs ${field2}`;
      }
      if (!spec.valid(value[field2], this.mode)) {
        return `invalid ${definition.noun} ${field2}`;
      }
    }
    if (this.mode === "strict") {
      for (const key of Object.keys(value)) {
        if (!Object.hasOwn(definition.fields, key)) {
          return `a ${definition.noun} has no field ${key}`;
        }
      }
    }
    return type.invalid(value, this.mode);
  }
  isEntry(collection, value) {
    return this.invalidEntry(collection, value) === null;
  }
  invalidField(collection, field2, value) {
    const definition = this.collection(collection);
    const spec = this.field(collection, field2);
    if (spec === undefined) {
      return `a ${definition.noun} has no field ${field2}`;
    }
    if (spec.grain === "fixed") {
      return `a ${definition.noun}'s ${field2} changes only with the whole ${definition.noun}`;
    }
    return spec.valid(value, this.mode) ? null : `invalid ${definition.noun} ${field2}`;
  }
  invalidSubfield(collection, field2, subfield, change) {
    const spec = this.field(collection, field2);
    if (spec === undefined || spec.grain !== "struct" || spec.subfields === undefined) {
      return `${field2} has no fields of its own`;
    }
    const sub = Object.hasOwn(spec.subfields, subfield) ? spec.subfields[subfield] : undefined;
    if (sub === undefined) {
      return `${field2} has no field ${subfield}`;
    }
    if (!sub.optional && !(change.inserts && change.removes)) {
      return `${field2}.${subfield} can only be replaced`;
    }
    if (change.inserts && !sub.valid(change.value)) {
      return `invalid ${field2}.${subfield}`;
    }
    return null;
  }
  invalidLayoutKey(key, value) {
    if (CANVAS_SIZE_KEYS.has(key)) {
      if (value === undefined) {
        return `a canvas keeps its ${key}`;
      }
      if (typeof value !== "number" || !Number.isFinite(value) || value <= 0) {
        return `a canvas ${key} is a positive number`;
      }
      return null;
    }
    if (key === "backgroundColor" && value !== undefined && typeof value !== "string") {
      return "a canvas backgroundColor is a string";
    }
    return null;
  }
  invalidEdit(before, after) {
    if (!isCompositionShape(after)) {
      return "a composition has a layout, and widgets and behaviors keyed by id";
    }
    for (const key of new Set([...Object.keys(before.layout), ...Object.keys(after.layout)])) {
      const value = Object.hasOwn(after.layout, key) ? after.layout[key] : undefined;
      const was = Object.hasOwn(before.layout, key) ? before.layout[key] : undefined;
      if (sameValue(was, value)) {
        continue;
      }
      const invalid = this.invalidLayoutKey(key, value);
      if (invalid !== null) {
        return invalid;
      }
    }
    for (const collection of this.collectionNames()) {
      const was = before[collection];
      const is = after[collection];
      const noun = this.collection(collection).noun;
      for (const [id, entry] of Object.entries(is)) {
        if (Object.hasOwn(was, id) && sameValue(was[id], entry)) {
          continue;
        }
        if (id.length === 0 || id.length > ENTRY_ID_MAX_LENGTH) {
          return `a ${noun} id is 1 to ${ENTRY_ID_MAX_LENGTH} characters`;
        }
        const invalid = this.invalidEntry(collection, entry);
        if (invalid !== null) {
          return `${noun} ${id} would not be valid: ${invalid}`;
        }
      }
    }
    return null;
  }
  create(collection, type, seed) {
    const built = this.tryCreate(collection, type, seed);
    assert(built.ok, `a new ${type} is valid: ${built.ok ? "" : built.detail}`);
    return built.entry;
  }
  tryCreate(collection, type, seed) {
    const entityType = this.type(collection, type);
    if (entityType === undefined) {
      return { ok: false, detail: `there is no ${this.collection(collection).noun} type ${type}` };
    }
    const entry = entityType.withDefaults(seed);
    const invalid = this.invalidEntry(collection, entry);
    return invalid === null ? { ok: true, entry } : { ok: false, detail: invalid };
  }
  migrateDocument(doc) {
    const next = { ...doc, widgets: { ...doc.widgets }, behaviors: { ...doc.behaviors } };
    for (const collection of this.collectionNames()) {
      const entries = next[collection];
      for (const [id, value] of Object.entries(entries)) {
        if (!isPlainObject(value)) {
          continue;
        }
        const typeName = this.collection(collection).typeOf(value);
        const type = typeName === null ? undefined : this.type(collection, typeName);
        if (type?.migrate === undefined) {
          continue;
        }
        const migrated = type.migrate(value, id);
        entries[id] = migrated.entry;
        for (const [behaviorId, behavior] of Object.entries(migrated.behaviors ?? {})) {
          if (!Object.hasOwn(next.behaviors, behaviorId)) {
            next.behaviors[behaviorId] = behavior;
          }
        }
      }
    }
    return next;
  }
}
var CANVAS_SIZE_KEYS = new Set(["width", "height"]);
function typeKey(collection, name) {
  return `${collection}/${name}`;
}
function createRegistry(mode, extra = [], extraWidgetTraits = {}) {
  for (const widgetId of Object.keys(extraWidgetTraits)) {
    assert(!Object.hasOwn(BUILTIN_WIDGET_TRAITS, widgetId), `widget ${widgetId} declares its traits once`);
  }
  return new TypeRegistry(mode, BUILTIN_COLLECTIONS, [...BUILTIN_TYPES, ...extra], {
    ...BUILTIN_WIDGET_TRAITS,
    ...extraWidgetTraits
  });
}
var STRICT_REGISTRY = createRegistry("strict");
var TOLERANT_REGISTRY = createRegistry("tolerant");
// ../shared/clients/typescript/scene/model/timeline.ts
var UNTIMED_ALERT_MS = 5000;
var SUBSCRIBE_TIMEOUT_MS = 1e4;
var MAX_ALERT_MS = 5 * 60000;
var RENDER_WAIT_MS = 2000;
var MEDIA_WIDGETS = new Set([
  "woofx3:widget:video",
  "woofx3:widget:audio",
  "woofx3:widget:lottie"
]);
var MEDIA_LENGTH_HINT_SETTING = "mediaDurationSeconds";
function mediaLengthEstimates(doc) {
  const estimates = {};
  for (const [id, placement] of Object.entries(doc.widgets)) {
    const { settings } = placement;
    const ownLength = settings.duration !== undefined && settings.duration !== 0;
    if (!MEDIA_WIDGETS.has(placement.widget) || ownLength || settings.loop === true) {
      continue;
    }
    const hint = settings[MEDIA_LENGTH_HINT_SETTING];
    if (typeof hint === "number" && Number.isFinite(hint) && hint > 0) {
      estimates[id] = hint * 1000;
    }
  }
  return estimates;
}
var NEVER = Number.POSITIVE_INFINITY;
function resolveTimeline(doc, profile, facts, options = {}) {
  return new Resolver(doc, profile, facts, options).resolve();
}

class Resolver {
  doc;
  profile;
  facts;
  bounded;
  now;
  estimate;
  widgetIds;
  behaviorIds;
  problems = [];
  activities = new Map;
  afterEnd = new Set;
  leads = new Map;
  planned = new Map;
  endMemo = null;
  constructor(doc, profile, facts, options) {
    this.doc = doc;
    this.profile = profile;
    this.facts = facts;
    assertFinite(facts.startedAtMs, "facts.startedAtMs");
    this.bounded = profile.bounded;
    this.now = facts.nowMs === undefined ? null : this.relative(facts.nowMs, "facts.nowMs");
    this.estimate = options.estimate ?? null;
    this.widgetIds = Object.keys(doc.widgets).sort();
    this.behaviorIds = Object.keys(doc.behaviors).sort();
    this.checkFacts();
    this.chooseActivities();
    this.computeLeads();
  }
  resolve() {
    const widgets = {};
    for (const id of this.widgetIds) {
      const departure = this.departure(id);
      widgets[id] = {
        status: this.status(id),
        enterMs: known(this.enter(id)),
        completeMs: known(this.rawComplete(id)),
        leaveMs: known(departure.leave),
        exitMs: known(departure.exit)
      };
    }
    const behaviors = {};
    for (const id of this.behaviorIds) {
      const behavior = this.doc.behaviors[id];
      if (!this.targetExists(behavior.target)) {
        this.problem(id, "dangling-target");
        continue;
      }
      const window2 = this.behaviorWindow(id, behavior);
      behaviors[id] = { startMs: known(window2.start), endMs: known(window2.end) };
    }
    const canvas = this.canvasDeparture();
    return {
      widgets,
      behaviors,
      canvas: { enterMs: 0, leaveMs: known(canvas.leave), exitMs: known(canvas.exit) },
      endMs: this.bounded ? known(this.end()) : null,
      finishMs: this.bounded ? known(this.finish()) : null,
      revisitAtMs: this.revisitAt(),
      problems: this.problems.sort((a, b) => compareText(a.behavior, b.behavior) || compareText(a.kind, b.kind))
    };
  }
  checkFacts() {
    const widgets = this.facts.widgets ?? {};
    for (const [id, widget] of Object.entries(widgets)) {
      for (const key of ["subscribedAtMs", "renderedAtMs", "completedAtMs"]) {
        if (widget[key] !== undefined) {
          assertFinite(widget[key], `facts.widgets.${id}.${key}`);
        }
      }
      if (widget.subscribedAtMs !== undefined && typeof widget.timed !== "boolean") {
        throw new Error(`timeline: facts.widgets.${id} subscribed without saying whether it is timed`);
      }
      for (const change of widget.visibility ?? []) {
        assertFinite(change.atMs, `facts.widgets.${id}.visibility.atMs`);
      }
    }
    for (const [id, duration] of Object.entries(this.estimate?.durationsMs ?? {})) {
      if (duration !== null && !(Number.isFinite(duration) && duration >= 0)) {
        throw new Error(`timeline: estimate.durationsMs.${id} must be a non-negative number or null`);
      }
    }
  }
  chooseActivities() {
    const byTarget = new Map;
    for (const id of this.behaviorIds) {
      const behavior = this.doc.behaviors[id];
      if (behavior.type !== "activity" || !this.targetExists(behavior.target)) {
        continue;
      }
      if (behavior.target === CANVAS_TARGET) {
        this.problem(id, "invalid-activity");
        continue;
      }
      const ids = byTarget.get(behavior.target) ?? [];
      ids.push(id);
      byTarget.set(behavior.target, ids);
    }
    for (const [target, ids] of byTarget) {
      ids.sort((a, b) => compareOrder(this.doc.behaviors[a], a, this.doc.behaviors[b], b));
      for (const extra of ids.slice(1)) {
        this.problem(extra, "duplicate-activity");
      }
      const id = ids[0];
      const behavior = this.doc.behaviors[id];
      const { anchor, node } = behavior.timing;
      if (!this.profile.anchors.includes(anchor)) {
        this.problem(id, "anchor-not-in-profile");
        continue;
      }
      const selfAnchored = anchor === "enter" || anchor === "exit";
      const badCompletion = anchor === "complete" && (node === undefined || node === target || !(node in this.doc.widgets));
      if (selfAnchored || badCompletion) {
        this.problem(id, "invalid-activity");
        continue;
      }
      this.activities.set(target, behavior);
    }
    this.dropActivityCycles();
    for (const id of this.widgetIds) {
      if (this.waitsOnEnd(id, new Set)) {
        this.afterEnd.add(id);
      }
    }
  }
  dropActivityCycles() {
    const state = new Map;
    const inCycle = new Set;
    const visit = (id, path) => {
      const seen = state.get(id);
      if (seen === "done") {
        return;
      }
      if (seen === "visiting") {
        for (const member of path.slice(path.indexOf(id))) {
          inCycle.add(member);
        }
        return;
      }
      state.set(id, "visiting");
      const next = this.completionDependency(id);
      if (next !== null) {
        visit(next, [...path, id]);
      }
      state.set(id, "done");
    };
    for (const id of this.widgetIds) {
      visit(id, []);
    }
    for (const id of [...inCycle].sort()) {
      const activity = this.activities.get(id);
      if (activity) {
        const behaviorId = this.behaviorIds.find((candidate) => this.doc.behaviors[candidate] === activity);
        if (behaviorId === undefined) {
          throw new Error("timeline: chosen activity is not in the document");
        }
        this.problem(behaviorId, "activity-cycle");
        this.activities.delete(id);
      }
    }
  }
  completionDependency(id) {
    const activity = this.activities.get(id);
    if (!activity || activity.timing.anchor !== "complete" || activity.timing.node === undefined) {
      return null;
    }
    return activity.timing.node;
  }
  waitsOnEnd(id, seen) {
    if (seen.has(id)) {
      return false;
    }
    seen.add(id);
    const activity = this.activities.get(id);
    if (!activity) {
      return false;
    }
    if (activity.timing.anchor === "end") {
      return true;
    }
    const next = this.completionDependency(id);
    return next !== null && this.waitsOnEnd(next, seen);
  }
  computeLeads() {
    for (const id of this.behaviorIds) {
      const behavior = this.doc.behaviors[id];
      if (behavior.type === "activity" || !this.targetExists(behavior.target)) {
        continue;
      }
      const { timing } = behavior;
      let lead = 0;
      if (phaseOf(behavior) === "out") {
        if (typeof timing.durationMs === "number") {
          lead = timing.durationMs - timing.offsetMs;
        }
      } else if (phaseOf(behavior) === null && timing.anchor === "exit" && timing.offsetMs < 0) {
        lead = -timing.offsetMs;
      }
      const current = this.leads.get(behavior.target) ?? 0;
      this.leads.set(behavior.target, Math.max(current, lead));
    }
  }
  plannedEnter(id) {
    if (this.planned.has(id)) {
      return this.planned.get(id);
    }
    let time;
    const activity = this.activities.get(id);
    const activityStart = activity ? this.activityStart(activity) : 0;
    if (this.bounded && !this.doc.widgets[id].visible) {
      time = NEVER;
    } else if (this.bounded) {
      time = activityStart === null ? null : Math.max(0, activityStart);
    } else {
      const shown = this.visibleWindow(id).show;
      time = shown === null || activityStart === null ? null : Math.max(shown, activityStart);
    }
    this.planned.set(id, time);
    return time;
  }
  activityStart(activity) {
    const { anchor, node, offsetMs } = activity.timing;
    switch (anchor) {
      case "start":
        return offsetMs;
      case "end":
        return add(this.end(), offsetMs);
      case "complete":
        return add(this.completeForAnchor(node), offsetMs);
      default:
        throw new Error(`timeline: activity anchored to ${anchor} was not filtered out`);
    }
  }
  activityClose(id) {
    const activity = this.activities.get(id);
    if (!activity || activity.timing.durationMs === "until-exit") {
      return;
    }
    return add(this.activityStart(activity), activity.timing.durationMs);
  }
  enter(id) {
    const planned = this.plannedEnter(id);
    if (planned === null || planned === NEVER) {
      return planned;
    }
    const rendered = this.fact(id, "renderedAtMs");
    if (rendered !== null) {
      return rendered <= planned ? planned : Math.min(rendered, planned + RENDER_WAIT_MS);
    }
    if (this.estimate !== null) {
      return planned;
    }
    return this.passed(planned + RENDER_WAIT_MS) ? planned + RENDER_WAIT_MS : null;
  }
  status(id) {
    const planned = this.plannedEnter(id);
    if (planned === NEVER) {
      return "never";
    }
    const subscribed = this.fact(id, "subscribedAtMs");
    if (subscribed !== null) {
      if (this.bounded && planned !== null && subscribed > planned + SUBSCRIBE_TIMEOUT_MS) {
        return "ignored";
      }
      return this.facts.widgets?.[id]?.timed ? "timed" : "untimed";
    }
    if (this.estimate !== null) {
      return this.estimatedLength(id) === null ? "untimed" : "timed";
    }
    if (this.bounded && planned !== null && this.passed(planned + SUBSCRIBE_TIMEOUT_MS)) {
      return "ignored";
    }
    return "pending";
  }
  estimatedLength(id) {
    const durations = this.estimate?.durationsMs ?? {};
    if (Object.hasOwn(durations, id)) {
      return durations[id];
    }
    const seconds = this.doc.widgets[id].settings.duration;
    if (typeof seconds === "number" && Number.isFinite(seconds) && seconds > 0) {
      return seconds * 1000;
    }
    return null;
  }
  rawComplete(id) {
    const planned = this.plannedEnter(id);
    if (planned === NEVER) {
      return NEVER;
    }
    const completed = this.fact(id, "completedAtMs");
    if (completed !== null) {
      return completed;
    }
    const status = this.status(id);
    if (status === "ignored") {
      return NEVER;
    }
    const subscribed = this.fact(id, "subscribedAtMs");
    if (status === "untimed" && subscribed !== null) {
      return planned === null ? subscribed : Math.max(planned, subscribed);
    }
    if (this.estimate !== null && planned !== null) {
      return planned + (this.estimatedLength(id) ?? 0);
    }
    return null;
  }
  completeForAnchor(id) {
    const raw = this.rawComplete(id);
    if (raw === null && this.bounded && this.passed(MAX_ALERT_MS)) {
      return NEVER;
    }
    return raw;
  }
  departure(id) {
    const planned = this.plannedEnter(id);
    if (planned === null || planned === NEVER) {
      return { leave: planned, exit: planned };
    }
    return this.bounded ? this.alertDeparture(id, planned) : this.sceneDeparture(id, planned);
  }
  alertDeparture(id, planned) {
    const lead = this.leads.get(id) ?? 0;
    const close = this.activityClose(id);
    const end = this.end();
    if (close !== undefined) {
      if (close === null) {
        return { leave: null, exit: null };
      }
      if (!this.afterEnd.has(id) && close > MAX_ALERT_MS) {
        return { leave: end, exit: add(end, lead) };
      }
      return { leave: Math.max(planned, close - lead), exit: close };
    }
    let leave;
    if (this.afterEnd.has(id)) {
      leave = end === null ? null : Math.max(planned, end);
    } else if (this.status(id) === "timed") {
      const completed = this.rawComplete(id);
      if (completed !== null) {
        leave = end === null ? completed : Math.min(completed, end);
      } else {
        leave = end;
      }
    } else {
      leave = end;
    }
    return { leave, exit: add(leave, lead) };
  }
  sceneDeparture(id, planned) {
    const lead = this.leads.get(id) ?? 0;
    const hidden = this.visibleWindow(id).hide;
    const close = this.activityClose(id);
    if (close === null) {
      return { leave: null, exit: null };
    }
    const candidates = [];
    if (hidden !== null) {
      candidates.push({ leave: hidden, exit: hidden + lead });
    }
    if (close !== undefined) {
      candidates.push({ leave: Math.max(planned, close - lead), exit: close });
    }
    if (candidates.length === 0) {
      return { leave: null, exit: null };
    }
    candidates.sort((a, b) => a.exit - b.exit);
    return candidates[0];
  }
  visibleWindow(id) {
    const changes = (this.facts.widgets?.[id]?.visibility ?? []).map((change, index) => ({ at: this.relative(change.atMs, "visibility.atMs"), visible: change.visible, index })).sort((a, b) => a.at - b.at || a.index - b.index);
    let visible = this.doc.widgets[id].visible;
    let show = visible ? 0 : null;
    let hide = null;
    for (const change of changes) {
      if (change.visible && !visible) {
        show = change.at;
        hide = null;
      } else if (!change.visible && visible) {
        hide = change.at;
      }
      visible = change.visible;
    }
    return { show, hide };
  }
  end() {
    if (!this.bounded) {
      return null;
    }
    if (this.endMemo !== null) {
      return this.endMemo.value;
    }
    let unknown = false;
    let latest = 0;
    let anyHolds = false;
    for (const id of this.widgetIds) {
      if (this.afterEnd.has(id)) {
        continue;
      }
      const release = this.release(id);
      if (release === null) {
        unknown = true;
        continue;
      }
      if (release.time === NEVER) {
        continue;
      }
      latest = Math.max(latest, release.time);
      anyHolds = anyHolds || release.holds;
    }
    let value;
    if (!unknown) {
      value = Math.min(MAX_ALERT_MS, anyHolds ? latest : Math.max(latest, UNTIMED_ALERT_MS));
    } else if (latest >= MAX_ALERT_MS || this.passed(MAX_ALERT_MS)) {
      value = MAX_ALERT_MS;
    } else {
      value = null;
    }
    this.endMemo = { value };
    return value;
  }
  release(id) {
    const planned = this.plannedEnter(id);
    if (planned === null) {
      return null;
    }
    if (planned === NEVER) {
      return { time: NEVER, holds: false };
    }
    const close = this.activityClose(id);
    if (close !== undefined) {
      return close === null ? null : { time: close, holds: true };
    }
    const status = this.status(id);
    switch (status) {
      case "pending":
        return null;
      case "ignored":
        return { time: planned + SUBSCRIBE_TIMEOUT_MS, holds: false };
      case "untimed":
        return { time: this.rawComplete(id), holds: false };
      case "timed": {
        const completed = this.rawComplete(id);
        return completed === null ? null : { time: completed, holds: true };
      }
      default:
        throw new Error(`timeline: widget ${id} has unexpected status ${status}`);
    }
  }
  canvasDeparture() {
    if (!this.bounded) {
      return { leave: null, exit: null };
    }
    const end = this.end();
    return { leave: end, exit: add(end, this.leads.get(CANVAS_TARGET) ?? 0) };
  }
  finish() {
    let latest = this.canvasDeparture().exit;
    if (latest === null) {
      return null;
    }
    for (const id of this.widgetIds) {
      const { exit } = this.departure(id);
      if (exit === null) {
        return null;
      }
      if (exit !== NEVER) {
        latest = Math.max(latest, exit);
      }
    }
    return latest;
  }
  revisitAt() {
    if (this.now === null || this.estimate !== null) {
      return null;
    }
    const deadlines = [];
    for (const id of this.widgetIds) {
      const planned = this.plannedEnter(id);
      if (planned === null || planned === NEVER) {
        continue;
      }
      if (this.bounded && this.status(id) === "pending") {
        deadlines.push(planned + SUBSCRIBE_TIMEOUT_MS);
      }
      if (this.enter(id) === null) {
        deadlines.push(planned + RENDER_WAIT_MS);
      }
    }
    if (this.bounded && this.end() === null) {
      deadlines.push(MAX_ALERT_MS);
    }
    const future = deadlines.filter((deadline) => deadline > this.now);
    return future.length === 0 ? null : Math.min(...future);
  }
  behaviorWindow(id, behavior) {
    const { timing, target } = behavior;
    if (behavior.type === "activity") {
      return this.activityWindow(behavior);
    }
    const phase = phaseOf(behavior);
    if (phase === null && !this.profile.anchors.includes(timing.anchor)) {
      this.problem(id, "anchor-not-in-profile");
      return { start: null, end: null };
    }
    const enter = target === CANVAS_TARGET ? 0 : this.enter(target);
    const departure = target === CANVAS_TARGET ? this.canvasDeparture() : this.departure(target);
    if (phase === "in") {
      const start2 = add(enter, timing.offsetMs);
      return { start: start2, end: timing.durationMs === "until-exit" ? departure.exit : add(start2, timing.durationMs) };
    }
    if (phase === "out") {
      if (timing.durationMs === "until-exit") {
        return { start: departure.leave, end: departure.exit };
      }
      const end = add(departure.exit, timing.offsetMs);
      return { start: add(end, -timing.durationMs), end };
    }
    let anchor;
    switch (timing.anchor) {
      case "start":
        anchor = 0;
        break;
      case "end":
        anchor = this.end();
        break;
      case "enter":
        anchor = enter;
        break;
      case "exit":
        anchor = departure.exit;
        break;
      case "complete": {
        const node = timing.node ?? target;
        anchor = node === CANVAS_TARGET || !(node in this.doc.widgets) ? NEVER : this.completeForAnchor(node);
        break;
      }
      default:
        throw new Error(`timeline: unknown anchor ${String(timing.anchor)}`);
    }
    const start = add(anchor, timing.offsetMs);
    return { start, end: timing.durationMs === "until-exit" ? departure.exit : add(start, timing.durationMs) };
  }
  activityWindow(behavior) {
    if (behavior.target === CANVAS_TARGET) {
      return { start: null, end: null };
    }
    const target = behavior.target;
    return { start: this.enter(target), end: this.departure(target).exit };
  }
  targetExists(target) {
    return target === CANVAS_TARGET || Object.hasOwn(this.doc.widgets, target);
  }
  fact(id, key) {
    const value = this.facts.widgets?.[id]?.[key];
    return value === undefined ? null : this.relative(value, key);
  }
  relative(clock, name) {
    assertFinite(clock, name);
    return clock - this.facts.startedAtMs;
  }
  passed(time) {
    return this.now !== null && this.now >= time;
  }
  problem(behavior, kind) {
    this.problems.push({ behavior, kind });
  }
}
function phaseOf(behavior) {
  if (behavior.type !== "transition") {
    return null;
  }
  const phase = behavior.params.phase;
  return phase === "in" || phase === "out" ? phase : null;
}
function compareOrder(a, aId, b, bId) {
  if (a.order !== b.order) {
    return a.order < b.order ? -1 : 1;
  }
  return compareText(aId, bId);
}
function compareText(a, b) {
  if (a === b) {
    return 0;
  }
  return a < b ? -1 : 1;
}
function add(time, ms) {
  return time === null ? null : time + ms;
}
function known(time) {
  return time === null || time === NEVER ? null : time;
}
function assertFinite(value, name) {
  if (typeof value !== "number" || !Number.isFinite(value)) {
    throw new Error(`timeline: ${name} must be a finite number`);
  }
}
// ../shared/clients/typescript/scene/runtime/diff.ts
var LAYERS = ["transition", "effect"];
var EMPTY_LAYERS = { transition: [], effect: [] };
function diffPlans(prev, next) {
  const removals = [];
  const mounts = [];
  const writes = [];
  const cancels = [];
  const starts = [];
  const delegates = [];
  const before = prev?.widgets ?? {};
  for (const id of Object.keys(before)) {
    const after = next.widgets[id];
    if (after === undefined || after.widget !== before[id].widget) {
      removals.push({ op: "unmount", id });
    }
  }
  for (const [id, widget] of Object.entries(next.widgets)) {
    const old = before[id];
    const mounted = old !== undefined && old.widget === widget.widget;
    if (!mounted) {
      mounts.push({ op: "mount", id, widget: widget.widget, box: widget.box, z: widget.z, visible: widget.visible });
    } else {
      if (!sameBox(old.box, widget.box)) {
        writes.push({ op: "setBox", id, box: widget.box });
      }
      if (old.z !== widget.z) {
        writes.push({ op: "setStack", id, z: widget.z });
      }
      if (old.visible !== widget.visible) {
        writes.push({ op: "setVisible", id, visible: widget.visible });
      }
    }
    diffAnimations(id, mounted ? old.animations : EMPTY_LAYERS, widget.animations, cancels, starts);
    diffDelegates(id, mounted ? old : null, widget, delegates);
  }
  diffAnimations(null, prev?.canvas.animations ?? EMPTY_LAYERS, next.canvas.animations, cancels, starts);
  return [...removals, ...mounts, ...writes, ...cancels, ...starts, ...delegates];
}
function diffAnimations(id, prev, next, cancels, starts) {
  for (const layer of LAYERS) {
    const old = prev[layer];
    const now = next[layer];
    let kept = 0;
    while (kept < old.length && kept < now.length && sameAnimation(old[kept], now[kept])) {
      kept += 1;
    }
    for (const animation2 of old.slice(kept)) {
      cancels.push({ op: "cancelAnimation", id, layer, behavior: animation2.behavior });
    }
    for (const animation2 of now.slice(kept)) {
      starts.push({ op: "startAnimation", id, layer, behavior: animation2.behavior, spec: animation2.spec });
    }
  }
}
function diffDelegates(id, prev, next, out) {
  const old = new Map((prev?.delegated ?? []).map((entry) => [entry.behavior, entry]));
  const current = new Set(next.delegated.map((entry) => entry.behavior));
  for (const behavior of old.keys()) {
    if (!current.has(behavior)) {
      out.push({ op: "cancelDelegate", id, behavior });
    }
  }
  for (const entry of next.delegated) {
    const previous = old.get(entry.behavior);
    if (previous === undefined || !sameValue2(previous, entry)) {
      out.push({ op: "delegate", id, delegated: entry });
    }
  }
}
function sameBox(a, b) {
  return a.x === b.x && a.y === b.y && a.width === b.width && a.height === b.height && a.rotation === b.rotation && a.opacity === b.opacity;
}
function sameAnimation(a, b) {
  return a.behavior === b.behavior && sameValue2(a.spec, b.spec);
}
function sameValue2(a, b) {
  if (Object.is(a, b)) {
    return true;
  }
  if (typeof a !== "object" || typeof b !== "object" || a === null || b === null) {
    return false;
  }
  if (Array.isArray(a) !== Array.isArray(b)) {
    return false;
  }
  const aKeys = Object.keys(a);
  const bKeys = Object.keys(b);
  if (aKeys.length !== bKeys.length) {
    return false;
  }
  const bRecord = b;
  const aRecord = a;
  return aKeys.every((key) => Object.hasOwn(bRecord, key) && sameValue2(aRecord[key], bRecord[key]));
}
// ../shared/clients/typescript/scene/runtime/dom.ts
function createDomRenderer(options) {
  const doc = options.document;
  const widgets = new Map;
  let playing = true;
  let origin = timelineNow() - (options.atMs ?? 0);
  let pausedAtMs = 0;
  const canvasTransition = fill(doc.createElement("div"));
  const canvasEffect = fill(doc.createElement("div"));
  const layer = fill(doc.createElement("div"));
  canvasTransition.setAttribute("data-scene-layer", "canvas-transition");
  canvasEffect.setAttribute("data-scene-layer", "canvas-effect");
  layer.setAttribute("data-scene-layer", "widgets");
  canvasEffect.appendChild(layer);
  canvasTransition.appendChild(canvasEffect);
  options.root.appendChild(canvasTransition);
  const canvas = { transition: canvasTransition, effect: canvasEffect, animations: new Map };
  function timelineNow() {
    const now = doc.timeline.currentTime;
    if (typeof now !== "number") {
      throw new Error("runtime: the document timeline is not running");
    }
    return now;
  }
  function* allAnimations() {
    yield* canvas.animations.values();
    for (const widget of widgets.values()) {
      yield* widget.animations.values();
    }
  }
  function wrappersOf(id) {
    if (id === null) {
      return canvas;
    }
    return mustGet(id);
  }
  function mustGet(id) {
    const widget = widgets.get(id);
    if (widget === undefined) {
      throw new Error(`runtime: widget ${id} is not mounted`);
    }
    return widget;
  }
  function writeStyle(widget, property, value) {
    if (widget.written[property] === value) {
      return;
    }
    widget.written[property] = value;
    widget.box.style[property] = value;
  }
  function writeBox(widget, box) {
    writeStyle(widget, "transform", `translate(${box.x}px, ${box.y}px) rotate(${box.rotation}deg)`);
    writeStyle(widget, "width", `${box.width}px`);
    writeStyle(widget, "height", `${box.height}px`);
    writeStyle(widget, "opacity", String(box.opacity));
  }
  function mount(op) {
    if (widgets.has(op.id)) {
      throw new Error(`runtime: widget ${op.id} is already mounted`);
    }
    const box = doc.createElement("div");
    box.setAttribute("data-scene-widget", op.id);
    box.style.position = "absolute";
    box.style.left = "0";
    box.style.top = "0";
    box.style.transformOrigin = "50% 50%";
    const transition = fill(doc.createElement("div"));
    const effect = fill(doc.createElement("div"));
    const slot = fill(doc.createElement("div"));
    effect.appendChild(slot);
    transition.appendChild(effect);
    box.appendChild(transition);
    const widget = {
      box,
      transition,
      effect,
      animations: new Map,
      unmountContent: () => {},
      written: {}
    };
    writeBox(widget, op.box);
    writeStyle(widget, "zIndex", String(op.z));
    writeStyle(widget, "visibility", op.visible ? "" : "hidden");
    layer.appendChild(box);
    widgets.set(op.id, widget);
    widget.unmountContent = options.mountContent(slot, op.id, op.widget);
  }
  function unmount(id) {
    const widget = mustGet(id);
    for (const animation2 of widget.animations.values()) {
      animation2.cancel();
    }
    widget.animations.clear();
    widgets.delete(id);
    widget.unmountContent();
    widget.box.remove();
  }
  function startAnimation(op) {
    const wrappers = wrappersOf(op.id);
    const key = `${op.layer}:${op.behavior}`;
    if (wrappers.animations.has(key)) {
      throw new Error(`runtime: behavior ${op.behavior} is already animating; cancel it first`);
    }
    const animation2 = wrappers[op.layer].animate(domKeyframes(op.spec.keyframes), { ...op.spec.timing });
    if (playing) {
      animation2.startTime = origin;
    } else {
      animation2.pause();
      animation2.currentTime = pausedAtMs;
    }
    wrappers.animations.set(key, animation2);
  }
  function cancelAnimation(op) {
    const wrappers = wrappersOf(op.id);
    const key = `${op.layer}:${op.behavior}`;
    const animation2 = wrappers.animations.get(key);
    if (animation2 === undefined) {
      throw new Error(`runtime: no animation for behavior ${op.behavior} to cancel`);
    }
    animation2.cancel();
    wrappers.animations.delete(key);
  }
  return {
    apply(ops) {
      for (const op of ops) {
        switch (op.op) {
          case "unmount":
            unmount(op.id);
            break;
          case "mount":
            mount(op);
            break;
          case "setBox":
            writeBox(mustGet(op.id), op.box);
            break;
          case "setStack":
            writeStyle(mustGet(op.id), "zIndex", String(op.z));
            break;
          case "setVisible":
            writeStyle(mustGet(op.id), "visibility", op.visible ? "" : "hidden");
            break;
          case "startAnimation":
            startAnimation(op);
            break;
          case "cancelAnimation":
            cancelAnimation(op);
            break;
          case "delegate":
            mustGet(op.id);
            options.onDelegate?.(op.id, { kind: "start", delegated: op.delegated });
            break;
          case "cancelDelegate":
            mustGet(op.id);
            options.onDelegate?.(op.id, { kind: "cancel", behavior: op.behavior });
            break;
          default:
            throw new Error(`runtime: unknown patch op ${JSON.stringify(op)}`);
        }
      }
    },
    seek(ms) {
      if (!Number.isFinite(ms)) {
        throw new Error("runtime: seek needs a finite time");
      }
      if (playing) {
        origin = timelineNow() - ms;
      } else {
        pausedAtMs = ms;
      }
      for (const animation2 of allAnimations()) {
        animation2.currentTime = ms;
      }
    },
    pause() {
      if (!playing) {
        return;
      }
      pausedAtMs = timelineNow() - origin;
      playing = false;
      for (const animation2 of allAnimations()) {
        animation2.pause();
        animation2.currentTime = pausedAtMs;
      }
    },
    play() {
      if (playing) {
        return;
      }
      origin = timelineNow() - pausedAtMs;
      playing = true;
      for (const animation2 of allAnimations()) {
        animation2.startTime = origin;
      }
    },
    timeMs() {
      return playing ? timelineNow() - origin : pausedAtMs;
    },
    boxOf(widgetId) {
      return widgets.get(widgetId)?.box;
    },
    dispose() {
      for (const id of [...widgets.keys()]) {
        unmount(id);
      }
      for (const animation2 of canvas.animations.values()) {
        animation2.cancel();
      }
      canvas.animations.clear();
      canvasTransition.remove();
    }
  };
}
function domKeyframes(frames) {
  return frames.map((frame) => ({ ...frame }));
}
function fill(element) {
  element.style.position = "absolute";
  element.style.left = "0";
  element.style.top = "0";
  element.style.width = "100%";
  element.style.height = "100%";
  return element;
}
// ../shared/clients/typescript/scene/runtime/plan.ts
var RENDERED_TYPES = ["transition", "effect"];
function planFrame(doc, options = {}) {
  const { timeline: timeline2, meta, transient } = options;
  if (timeline2 !== undefined && !(typeof options.atMs === "number" && Number.isFinite(options.atMs))) {
    throw new Error("plan: atMs must be a finite number when a timeline is given");
  }
  const atMs = timeline2 === undefined ? null : options.atMs;
  const ids = Object.keys(doc.widgets).filter((id) => (meta === undefined || Object.hasOwn(meta, id)) && timeline2?.widgets[id]?.status !== "never");
  const zOf = (id) => transient?.[id]?.z ?? doc.widgets[id].z;
  ids.sort((a, b) => compareText2(zOf(a), zOf(b)) || compareText2(a, b));
  const widgets = {};
  const changes = [];
  ids.forEach((id, rank) => {
    const placement = { ...doc.widgets[id], ...transient?.[id] };
    widgets[id] = {
      id,
      widget: placement.widget,
      box: {
        x: placement.x,
        y: placement.y,
        width: placement.width,
        height: placement.height,
        rotation: placement.rotation,
        opacity: placement.opacity
      },
      z: rank,
      visible: timeline2 === undefined ? placement.visible : shownAt(timeline2, id, atMs, changes),
      animations: { transition: [], effect: [] },
      delegated: []
    };
  });
  const canvas = { animations: { transition: [], effect: [] } };
  const skipped = [];
  if (timeline2 !== undefined) {
    for (const [behaviorId, behavior] of sortedBehaviors(doc)) {
      planBehavior(behaviorId, behavior, {
        timeline: timeline2,
        atMs,
        doc,
        widgets,
        canvas,
        skipped,
        changes,
        declaredKinds: options.declaredKinds
      });
    }
  }
  const future = changes.filter((time) => time > atMs);
  return {
    atMs,
    widgets,
    canvas,
    nextChangeMs: future.length === 0 ? null : Math.min(...future),
    skipped
  };
}
function shownAt(timeline2, id, atMs, changes) {
  const resolved = timeline2.widgets[id];
  if (resolved === undefined) {
    throw new Error(`plan: the timeline has no entry for widget ${id}; resolve it for this document`);
  }
  const { enterMs, exitMs } = resolved;
  if (enterMs !== null) {
    changes.push(enterMs);
  }
  if (exitMs !== null) {
    changes.push(exitMs);
  }
  return enterMs !== null && enterMs <= atMs && (exitMs === null || atMs < exitMs);
}
function planBehavior(id, behavior, planning) {
  const { timeline: timeline2, atMs, doc, widgets, canvas, skipped, changes, declaredKinds } = planning;
  if (behavior.type === "activity") {
    return;
  }
  if (!RENDERED_TYPES.includes(behavior.type)) {
    skipped.push({ behavior: id, reason: "unknown-type" });
    return;
  }
  const onCanvas = behavior.target === CANVAS_TARGET;
  if (!onCanvas && !Object.hasOwn(doc.widgets, behavior.target)) {
    skipped.push({ behavior: id, reason: "dangling-target" });
    return;
  }
  const target = onCanvas ? canvas : widgets[behavior.target];
  if (target === undefined) {
    return;
  }
  const window2 = timeline2.behaviors[id];
  if (window2 === undefined || window2.startMs === null) {
    return;
  }
  if (!isHostKind(behavior.type, behavior.kind)) {
    if (onCanvas) {
      skipped.push({ behavior: id, reason: "canvas-delegate" });
      return;
    }
    if (declaredKinds !== undefined && !declaresKind(declaredKinds(behavior.target) ?? NO_DECLARED_KINDS, behavior.type, behavior.kind)) {
      skipped.push({ behavior: id, reason: "undeclared-kind" });
      return;
    }
    changes.push(window2.startMs);
    if (window2.startMs <= atMs) {
      target.delegated.push({
        behavior: id,
        type: behavior.type,
        kind: behavior.kind,
        phase: phaseOf2(behavior),
        startMs: window2.startMs,
        endMs: window2.endMs,
        easing: behavior.timing.easing,
        params: behavior.params
      });
    }
    return;
  }
  if (behavior.type === "transition" && window2.endMs === null) {
    return;
  }
  let spec;
  try {
    spec = compileAnimation(behavior, { startMs: window2.startMs, endMs: window2.endMs });
  } catch {
    skipped.push({ behavior: id, reason: "invalid-params" });
    return;
  }
  if (spec === null) {
    throw new Error(`plan: host kind ${behavior.type}/${behavior.kind} compiled to nothing`);
  }
  target.animations[spec.layer].push({ behavior: id, spec });
}
function sortedBehaviors(doc) {
  return Object.entries(doc.behaviors).sort(([aId, a], [bId, b]) => compareText2(a.order, b.order) || compareText2(aId, bId));
}
function phaseOf2(behavior) {
  if (behavior.type !== "transition") {
    return null;
  }
  const phase = behavior.params.phase;
  return phase === "in" || phase === "out" ? phase : null;
}
function compareText2(a, b) {
  if (a === b) {
    return 0;
  }
  return a < b ? -1 : 1;
}
function fitCanvas(canvas, area) {
  if (!(canvas.width > 0 && canvas.height > 0)) {
    throw new Error("plan: a canvas must have a positive width and height");
  }
  const scale = Math.min(area.width / canvas.width, area.height / canvas.height);
  return {
    scale,
    x: (area.width - canvas.width * scale) / 2,
    y: (area.height - canvas.height * scale) / 2
  };
}
// ../shared/clients/typescript/scene/runtime/preview-protocol.ts
var COMPOSITION_PREVIEW_PROTOCOL = 1;
var PREFIX = "woofx3.composition-preview.";
var PREVIEW_LOAD = "woofx3.composition-preview.load";
var PREVIEW_OVERRIDES = "woofx3.composition-preview.overrides";
var PREVIEW_PLAY = "woofx3.composition-preview.play";
var PREVIEW_PAUSE = "woofx3.composition-preview.pause";
var PREVIEW_SEEK = "woofx3.composition-preview.seek";
var PREVIEW_RESTART = "woofx3.composition-preview.restart";
var PREVIEW_READY = "woofx3.composition-preview.ready";
var PREVIEW_TIMELINE = "woofx3.composition-preview.timeline";
var PREVIEW_PLAYHEAD = "woofx3.composition-preview.playhead";
var PREVIEW_FINISHED = "woofx3.composition-preview.finished";
var PREVIEW_PROBLEMS = "woofx3.composition-preview.problems";
var PREVIEW_LOAD_ID_MAX_LENGTH = 128;
var PROBLEM_KINDS = new Set([
  "invalid-message",
  "invalid-entry",
  "bind",
  "unknown-widget",
  "unframed-widget",
  "frames-unavailable",
  "timeline",
  "plan"
]);
function isPreviewMessage(data) {
  return isPlainObject(data) && typeof data.type === "string" && data.type.startsWith(PREFIX);
}
function parsePreviewCommand(data) {
  if (!isPreviewMessage(data)) {
    return null;
  }
  const message = data;
  try {
    switch (message.type) {
      case PREVIEW_LOAD:
        return parseLoad(message);
      case PREVIEW_OVERRIDES:
        return parseOverridesMessage(message);
      case PREVIEW_PLAY:
        return { ok: true, command: { type: PREVIEW_PLAY }, dropped: [] };
      case PREVIEW_PAUSE:
        return { ok: true, command: { type: PREVIEW_PAUSE }, dropped: [] };
      case PREVIEW_RESTART:
        return { ok: true, command: { type: PREVIEW_RESTART }, dropped: [] };
      case PREVIEW_SEEK:
        if (!isFiniteNumber3(message.ms) || message.ms < 0) {
          return refuse("seek needs a non-negative finite ms");
        }
        return { ok: true, command: { type: PREVIEW_SEEK, ms: message.ms }, dropped: [] };
      default:
        return refuse(`unknown command ${String(message.type)}`);
    }
  } catch (err) {
    return refuse(`malformed message: ${err instanceof Error ? err.message : String(err)}`);
  }
}
function parseLoad(message) {
  if (!isLoadId(message.loadId)) {
    return refuse(`load needs a loadId of 1 to ${PREVIEW_LOAD_ID_MAX_LENGTH} characters`);
  }
  const profile = message.profile;
  if (profile !== "alert" && profile !== "scene") {
    return refuse('load needs a profile of "alert" or "scene"');
  }
  const shaped = profile === "alert" ? alertCompositionOf(message.document) : normalizeComposition(message.document);
  if (shaped === null) {
    return refuse("load needs a composition document");
  }
  const { width, height } = shaped.layout;
  if (!(isFiniteNumber3(width) && width > 0 && isFiniteNumber3(height) && height > 0)) {
    return refuse("the composition's canvas needs a positive width and height");
  }
  if (shaped.inputs !== undefined && !Array.isArray(shaped.inputs)) {
    return refuse("the composition's inputs must be a list");
  }
  const { document: document2, dropped } = playableEntries(TOLERANT_REGISTRY.migrateDocument(shaped));
  let event = null;
  if (message.event !== undefined && message.event !== null) {
    if (!isPlainObject(message.event) || typeof message.event.type !== "string") {
      return refuse("load event needs a type");
    }
    event = { type: message.event.type, data: message.event.data ?? null };
  }
  let inputs = {};
  if (message.inputs !== undefined) {
    if (!isPlainObject(message.inputs)) {
      return refuse("load inputs must be an object of values by input id");
    }
    inputs = message.inputs;
  }
  if (message.autoplay !== undefined && typeof message.autoplay !== "boolean") {
    return refuse("load autoplay must be a boolean");
  }
  return {
    ok: true,
    command: {
      type: PREVIEW_LOAD,
      loadId: message.loadId,
      profile,
      document: document2,
      event,
      inputs,
      autoplay: message.autoplay === true
    },
    dropped
  };
}
function playableEntries(doc) {
  const dropped = [];
  const keep = (collection, entries) => {
    const kept = {};
    for (const [id, entry] of Object.entries(entries)) {
      const reason = TOLERANT_REGISTRY.invalidEntry(collection, entry);
      if (reason === null) {
        kept[id] = entry;
      } else {
        dropped.push({ collection, id, reason });
      }
    }
    return kept;
  };
  const widgets = keep("widgets", doc.widgets);
  const behaviors = keep("behaviors", doc.behaviors);
  return { document: { ...doc, widgets, behaviors }, dropped };
}
var OVERRIDE_NUMBERS = ["x", "y", "width", "height", "rotation"];
function parseOverridesMessage(message) {
  if (message.overrides === null) {
    return { ok: true, command: { type: PREVIEW_OVERRIDES, overrides: null }, dropped: [] };
  }
  if (!isPlainObject(message.overrides)) {
    return refuse("overrides must be an object by widget id, or null");
  }
  const overrides = {};
  for (const [id, raw] of Object.entries(message.overrides)) {
    if (!isPlainObject(raw)) {
      return refuse(`overrides for ${id} must be an object`);
    }
    const override = {};
    for (const key of OVERRIDE_NUMBERS) {
      if (raw[key] !== undefined) {
        const value = raw[key];
        if (!isFiniteNumber3(value)) {
          return refuse(`overrides for ${id}: ${key} must be a finite number`);
        }
        override[key] = value;
      }
    }
    if (override.width !== undefined && override.width < 0 || override.height !== undefined && override.height < 0) {
      return refuse(`overrides for ${id}: a size cannot be negative`);
    }
    if (raw.opacity !== undefined) {
      if (!isFiniteNumber3(raw.opacity) || raw.opacity < 0 || raw.opacity > 1) {
        return refuse(`overrides for ${id}: opacity must be from 0 to 1`);
      }
      override.opacity = raw.opacity;
    }
    if (raw.z !== undefined) {
      if (typeof raw.z !== "string" || !isOrderKey(raw.z)) {
        return refuse(`overrides for ${id}: z must be an order key`);
      }
      override.z = raw.z;
    }
    overrides[id] = override;
  }
  return { ok: true, command: { type: PREVIEW_OVERRIDES, overrides }, dropped: [] };
}
function isLoadId(value) {
  return typeof value === "string" && value.length > 0 && value.length <= PREVIEW_LOAD_ID_MAX_LENGTH;
}
function isFiniteNumber3(value) {
  return typeof value === "number" && Number.isFinite(value);
}
function refuse(error) {
  return { ok: false, error };
}
// ../shared/clients/typescript/scene/runtime/scheduler.ts
function createScheduler(options) {
  const { profile, clock, renderer } = options;
  const startedAtMs = clock.now();
  let doc = options.doc;
  let meta = options.meta;
  let transient;
  const observed = new Map;
  const initialVisible = new Map;
  const currentVisible = new Map;
  let lastTimeline = null;
  let lastPlan = null;
  const reportedSkips = new Set;
  let timer = null;
  let finished = false;
  let disposed = false;
  for (const [id, placement] of Object.entries(doc.widgets)) {
    initialVisible.set(id, placement.visible);
    currentVisible.set(id, placement.visible);
  }
  function factsOf(id) {
    let facts = observed.get(id);
    if (facts === undefined) {
      facts = { visibility: [] };
      observed.set(id, facts);
    }
    return facts;
  }
  function recordVisibility(id, visible, atMs) {
    if (currentVisible.get(id) === visible) {
      return;
    }
    currentVisible.set(id, visible);
    factsOf(id).visibility.push({ atMs, visible });
  }
  function replaceFromNow(next) {
    const now = clock.now();
    for (const id of Object.keys(doc.widgets)) {
      if (!Object.hasOwn(next.widgets, id)) {
        observed.delete(id);
        initialVisible.delete(id);
        currentVisible.delete(id);
      }
    }
    for (const [id, placement] of Object.entries(next.widgets)) {
      if (!initialVisible.has(id)) {
        initialVisible.set(id, false);
        currentVisible.set(id, false);
      }
      recordVisibility(id, placement.visible, now);
    }
  }
  function replaceFromStart(next) {
    for (const [id, before] of Object.entries(doc.widgets)) {
      const after = next.widgets[id];
      const facts = observed.get(id);
      if (after === undefined || after.widget !== before.widget || !sameJson(after.settings, before.settings)) {
        observed.delete(id);
      } else if (facts !== undefined) {
        facts.visibility = [];
      }
    }
    initialVisible.clear();
    currentVisible.clear();
    for (const [id, placement] of Object.entries(next.widgets)) {
      initialVisible.set(id, placement.visible);
      currentVisible.set(id, placement.visible);
    }
  }
  function resolverDocument() {
    const widgets = {};
    for (const [id, placement] of Object.entries(doc.widgets)) {
      const visible = initialVisible.get(id);
      if (visible === undefined) {
        throw new Error(`runtime: widget ${id} has no starting visibility`);
      }
      widgets[id] = visible === placement.visible ? placement : { ...placement, visible };
    }
    return { ...doc, widgets };
  }
  function update() {
    if (disposed) {
      return;
    }
    const now = clock.now();
    const facts = { startedAtMs, nowMs: now, widgets: Object.fromEntries(observed) };
    const timeline2 = resolveTimeline(resolverDocument(), profile, facts, options.estimate === undefined ? {} : { estimate: options.estimate });
    const atMs = now - startedAtMs;
    const plan = planFrame(doc, { timeline: timeline2, atMs, meta, transient, declaredKinds: options.declaredKinds });
    const ops = diffPlans(lastPlan, plan);
    lastTimeline = timeline2;
    lastPlan = plan;
    if (ops.length > 0) {
      renderer.apply(ops);
    }
    reportSkips(plan.skipped);
    schedule(timeline2, plan, atMs);
  }
  function reportSkips(skips) {
    if (options.onSkipped === undefined) {
      return;
    }
    const fresh = skips.filter((skip) => !reportedSkips.has(`${skip.behavior}\x00${skip.reason}`));
    if (fresh.length === 0) {
      return;
    }
    for (const skip of fresh) {
      reportedSkips.add(`${skip.behavior}\x00${skip.reason}`);
    }
    options.onSkipped(fresh);
  }
  function schedule(timeline2, plan, atMs) {
    if (timer !== null) {
      clock.clearTimer(timer.handle);
      timer = null;
    }
    const finishMs = profile.bounded && !finished ? timeline2.finishMs : null;
    if (finishMs !== null && finishMs <= atMs) {
      finished = true;
      options.onFinished?.();
      return;
    }
    const due = [timeline2.revisitAtMs, plan.nextChangeMs, finishMs].filter((time) => time !== null && time > atMs);
    if (due.length === 0 || finished) {
      return;
    }
    timer = { handle: clock.setTimer(startedAtMs + Math.min(...due), onTimer) };
  }
  function onTimer() {
    timer = null;
    update();
  }
  function accepts(id) {
    return !disposed && Object.hasOwn(doc.widgets, id);
  }
  update();
  return {
    widgetSubscribed(id, timed) {
      if (!accepts(id)) {
        return;
      }
      const facts = factsOf(id);
      if (facts.subscribedAtMs !== undefined) {
        return;
      }
      facts.subscribedAtMs = clock.now();
      facts.timed = timed;
      update();
    },
    widgetRendered(id) {
      if (!accepts(id)) {
        return;
      }
      const facts = factsOf(id);
      if (facts.renderedAtMs !== undefined) {
        return;
      }
      facts.renderedAtMs = clock.now();
      update();
    },
    widgetCompleted(id) {
      if (!accepts(id)) {
        return;
      }
      const facts = factsOf(id);
      if (facts.completedAtMs !== undefined) {
        return;
      }
      facts.completedAtMs = clock.now();
      update();
    },
    visibilityChanged(id, visible) {
      if (!accepts(id)) {
        return;
      }
      recordVisibility(id, visible, clock.now());
      update();
    },
    setDocument(next, nextMeta) {
      if (disposed) {
        throw new Error("runtime: setDocument after the scheduler was disposed");
      }
      if (options.documentChanges === "start") {
        replaceFromStart(next);
      } else {
        replaceFromNow(next);
      }
      doc = next;
      if (nextMeta !== undefined) {
        meta = nextMeta;
      }
      update();
    },
    setTransient(next) {
      transient = next;
      update();
    },
    timeline() {
      if (lastTimeline === null) {
        throw new Error("runtime: the scheduler has not resolved yet");
      }
      return lastTimeline;
    },
    plan() {
      if (lastPlan === null) {
        throw new Error("runtime: the scheduler has not planned yet");
      }
      return lastPlan;
    },
    elapsedMs() {
      return clock.now() - startedAtMs;
    },
    resync() {
      if (disposed) {
        throw new Error("runtime: resync after the scheduler was disposed");
      }
      const finishMs = lastTimeline?.finishMs ?? null;
      if (finished && finishMs !== null && clock.now() - startedAtMs < finishMs) {
        finished = false;
      }
      update();
    },
    dispose() {
      disposed = true;
      if (timer !== null) {
        clock.clearTimer(timer.handle);
        timer = null;
      }
    }
  };
}
function sameJson(a, b) {
  return JSON.stringify(a) === JSON.stringify(b);
}
// public/scene-manager/frame-swap.ts
var SWAP_TIMEOUT_MS = 2000;
function swapFrameIn(args) {
  let settled = false;
  let cancelTimer = null;
  let fresh = null;
  const finish = () => {
    if (settled) {
      return;
    }
    if (fresh === null) {
      throw new Error("frame swap: the fresh frame reported painting before it was mounted");
    }
    settled = true;
    cancelTimer?.();
    fresh.reveal();
    args.retire();
    args.swapped(fresh);
  };
  fresh = args.mountFresh(finish);
  cancelTimer = args.schedule(finish, SWAP_TIMEOUT_MS);
  return {
    cancel: () => {
      if (settled) {
        return;
      }
      settled = true;
      cancelTimer?.();
      fresh?.unmount();
    }
  };
}

// public/scene-manager/preview-clock.ts
function createPreviewClock(base) {
  const timers = new Map;
  let nextHandle = 1;
  let running = false;
  let origin = 0;
  let heldMs = 0;
  let armed = null;
  let disposed = false;
  function now() {
    return running ? base.now() - origin : heldMs;
  }
  function disarm() {
    if (armed !== null) {
      base.clearTimer(armed.handle);
      armed = null;
    }
  }
  function arm() {
    disarm();
    if (!running || disposed || timers.size === 0) {
      return;
    }
    let earliest = Number.POSITIVE_INFINITY;
    for (const timer of timers.values()) {
      earliest = Math.min(earliest, timer.atMs);
    }
    armed = { handle: base.setTimer(origin + earliest, fire) };
  }
  function fire() {
    armed = null;
    const at = now();
    const due = [...timers.entries()].filter(([, timer]) => timer.atMs <= at).sort(([, a], [, b]) => a.atMs - b.atMs);
    for (const [handle, timer] of due) {
      if (!running || !timers.delete(handle)) {
        continue;
      }
      timer.callback();
    }
    arm();
  }
  function assertLive() {
    if (disposed) {
      throw new Error("preview clock: used after it was disposed");
    }
  }
  return {
    now,
    setTimer(atMs, callback) {
      assertLive();
      if (!Number.isFinite(atMs)) {
        throw new Error("preview clock: a timer needs a finite time");
      }
      const handle = nextHandle;
      nextHandle += 1;
      timers.set(handle, { atMs, callback });
      arm();
      return handle;
    },
    clearTimer(handle) {
      if (timers.delete(handle)) {
        arm();
      }
    },
    playing() {
      return running;
    },
    play() {
      assertLive();
      if (running) {
        return;
      }
      origin = base.now() - heldMs;
      running = true;
      arm();
    },
    pause() {
      assertLive();
      if (!running) {
        return;
      }
      heldMs = now();
      running = false;
      disarm();
    },
    seek(ms) {
      assertLive();
      if (!(Number.isFinite(ms) && ms >= 0)) {
        throw new Error("preview clock: seek needs a non-negative finite time");
      }
      if (running) {
        origin = base.now() - ms;
      } else {
        heldMs = ms;
      }
      arm();
    },
    dispose() {
      disposed = true;
      running = false;
      disarm();
      timers.clear();
    }
  };
}

// public/scene-manager/scene-update.ts
function planSceneUpdate(current, next) {
  const currentById = new Map(current.map((placement) => [placement.id, placement]));
  const nextIds = new Set(next.map((placement) => placement.id));
  const plan2 = {
    remove: current.filter((placement) => !nextIds.has(placement.id)).map((placement) => placement.id),
    mount: [],
    replace: [],
    place: [],
    order: next.map((placement) => placement.id)
  };
  for (const placement of next) {
    const existing = currentById.get(placement.id);
    if (!existing) {
      plan2.mount.push(placement);
    } else if (sameFrame(existing, placement)) {
      plan2.place.push(placement);
    } else {
      plan2.replace.push(placement);
    }
  }
  return plan2;
}
function sameFrame(a, b) {
  return a.widgetCanonicalId === b.widgetCanonicalId && a.moduleId === b.moduleId && a.hostsSurface === b.hostsSurface && a.frameUrl === b.frameUrl && (a.hostsSurface === "" || sameValue3(a.settings, b.settings));
}
function settingsUpdate(current, next, reads) {
  const keys2 = new Set([...Object.keys(current), ...Object.keys(next)]);
  const changed = [...keys2].filter((key) => !sameValue3(current[key], next[key]));
  if (changed.length === 0) {
    return "none";
  }
  if (reads === null || reads.all || changed.some((key) => reads.keys.has(key))) {
    return "reload";
  }
  return "patch";
}
function sameValue3(a, b) {
  if (a === b) {
    return true;
  }
  if (typeof a !== "object" || typeof b !== "object" || a === null || b === null) {
    return false;
  }
  if (Array.isArray(a) || Array.isArray(b)) {
    return Array.isArray(a) && Array.isArray(b) && a.length === b.length && a.every((item, i) => sameValue3(item, b[i]));
  }
  const aRecord = a;
  const bRecord = b;
  const aKeys = Object.keys(aRecord);
  if (aKeys.length !== Object.keys(bRecord).length) {
    return false;
  }
  return aKeys.every((key) => Object.hasOwn(bRecord, key) && sameValue3(aRecord[key], bRecord[key]));
}

// public/scene-manager/widget-behaviors.ts
function behaviorStateOf(delegated) {
  const durationMs = delegated.endMs === null ? null : Math.max(0, delegated.endMs - delegated.startMs);
  if (delegated.type === "transition") {
    if (delegated.phase === null) {
      return null;
    }
    return {
      type: "transition",
      kind: delegated.kind,
      phase: delegated.phase,
      durationMs,
      easing: delegated.easing,
      params: delegated.params
    };
  }
  if (delegated.type === "effect") {
    return { type: "effect", kind: delegated.kind, durationMs, easing: delegated.easing, params: delegated.params };
  }
  return null;
}
function entranceOf(doc, widgetId, declares) {
  const entrances = Object.entries(doc.behaviors).filter(([, behavior2]) => behavior2.type === "transition" && behavior2.target === widgetId && behavior2.params.phase === "in" && !isHostKind(behavior2.type, behavior2.kind) && declares(behavior2.type, behavior2.kind)).sort(([aId, a], [bId, b]) => compareText3(a.order, b.order) || compareText3(aId, bId));
  const first = entrances[0];
  if (first === undefined) {
    return null;
  }
  const [, behavior] = first;
  return {
    type: "transition",
    kind: behavior.kind,
    phase: "in",
    durationMs: typeof behavior.timing.durationMs === "number" ? behavior.timing.durationMs : null,
    easing: behavior.timing.easing,
    params: behavior.params
  };
}

class BehaviorRelay {
  send;
  playing = new Map;
  constructor(send) {
    this.send = send;
  }
  handle(widgetId, request) {
    if (request.kind === "start") {
      this.start(widgetId, request.delegated);
    } else {
      this.cancel(widgetId, request.behavior);
    }
  }
  forget(widgetId) {
    this.playing.delete(widgetId);
  }
  ongoing(widgetId) {
    return [...this.playing.get(widgetId)?.values() ?? []].filter(({ state }) => state.type === "effect" && state.durationMs === null).map(({ state }) => state);
  }
  start(widgetId, delegated) {
    const state = behaviorStateOf(delegated);
    if (state === null) {
      console.warn("[scene-manager] a widget behavior the protocol cannot carry; skipped", {
        widgetId,
        behavior: delegated.behavior
      });
      return;
    }
    let widget = this.playing.get(widgetId);
    if (widget === undefined) {
      widget = new Map;
      this.playing.set(widgetId, widget);
    }
    const previous = widget.get(delegated.behavior);
    widget.set(delegated.behavior, { state, startMs: delegated.startMs });
    if (previous !== undefined && previous.startMs === delegated.startMs && sameExceptDuration(previous.state, state)) {
      return;
    }
    this.send(widgetId, state);
  }
  cancel(widgetId, behavior) {
    const widget = this.playing.get(widgetId);
    if (widget === undefined || !widget.delete(behavior)) {
      return;
    }
    this.send(widgetId, null);
    for (const type of ["transition", "effect"]) {
      const latest = [...widget.values()].filter(({ state }) => state.type === type).sort((a, b) => b.startMs - a.startMs)[0];
      if (latest !== undefined) {
        this.send(widgetId, latest.state);
      }
    }
  }
}
function sameExceptDuration(a, b) {
  return a.type === b.type && a.kind === b.kind && a.phase === b.phase && a.easing === b.easing && sameValue3(a.params, b.params);
}
function compareText3(a, b) {
  if (a === b) {
    return 0;
  }
  return a < b ? -1 : 1;
}

// public/scene-manager/composition-preview.ts
var PLAYHEAD_REPORT_MS = 100;
function createCompositionPreview(options) {
  let loaded = null;
  let playback = null;
  let transient;
  let generation = 0;
  let ticker = null;
  let lastTimeline = "";
  let lastProblems = "";
  let disposed = false;
  options.post({ type: PREVIEW_READY, protocol: COMPOSITION_PREVIEW_PROTOCOL });
  function handle(data) {
    if (disposed) {
      return;
    }
    const parsed = parsePreviewCommand(data);
    if (parsed === null) {
      return;
    }
    if (!parsed.ok) {
      postProblems(null, [{ kind: "invalid-message", detail: parsed.error }]);
      return;
    }
    const { command } = parsed;
    switch (command.type) {
      case PREVIEW_LOAD:
        load(command, parsed.dropped);
        break;
      case PREVIEW_OVERRIDES:
        transient = command.overrides ?? undefined;
        playback?.scheduler.setTransient(transient);
        break;
      case PREVIEW_PLAY:
        play();
        break;
      case PREVIEW_PAUSE:
        pause();
        break;
      case PREVIEW_SEEK:
        seek(command.ms);
        break;
      case PREVIEW_RESTART:
        restart();
        break;
      default:
        throw new Error(`composition preview: unhandled command ${JSON.stringify(command)}`);
    }
  }
  async function load(command, dropped) {
    generation += 1;
    const current = generation;
    const problems = dropped.map(({ id, reason }) => ({ kind: "invalid-entry", id, detail: reason }));
    const bound = bindInputs(command.document, command.inputs ?? {});
    if (!bound.ok) {
      clear();
      postProblems(command.loadId, [...problems, ...bindProblems(bound.report)]);
      return;
    }
    let resolution;
    try {
      resolution = await options.resolveFrames(bound.document);
    } catch (err) {
      resolution = {
        widgets: {},
        problems: [{ kind: "frames-unavailable", detail: err instanceof Error ? err.message : String(err) }]
      };
    }
    if (current !== generation || disposed) {
      return;
    }
    const next = {
      loadId: command.loadId,
      profile: command.profile,
      doc: bound.document,
      event: command.event ?? null,
      frames: resolution.widgets,
      problems: [...problems, ...resolution.problems]
    };
    const run = playback;
    const previous = loaded;
    if (run !== null && previous !== null && updatesInPlace(previous, next)) {
      loaded = next;
      lastTimeline = "";
      run.update(next);
      transient = undefined;
      run.scheduler.setTransient(undefined);
      reportTimeline();
      reportPlayhead();
      if (command.autoplay === true) {
        play();
      }
      return;
    }
    clear();
    loaded = next;
    startPlayback(command.autoplay === true);
  }
  function clear() {
    stopPlayback();
    loaded = null;
    transient = undefined;
    lastTimeline = "";
  }
  function startPlayback(autoplay) {
    let source = mustBeLoaded();
    options.fitStage(canvasOf(source.doc));
    const clock = createPreviewClock(options.baseClock);
    const frames = new Map;
    const slots = new Map;
    const handed = new Map;
    const swaps = new Map;
    const relay = new BehaviorRelay((widgetId, state) => frames.get(widgetId)?.sendBehavior(state));
    let run = null;
    const fact = (report) => {
      if (run === null || playback !== run || !run.measuring) {
        return;
      }
      report(run.scheduler);
      reportTimeline();
    };
    const mountInto = (slot, widgetId, swapping, rendered) => {
      const meta = source.frames[widgetId];
      const placement = source.doc.widgets[widgetId];
      if (meta === undefined || placement === undefined) {
        throw new Error(`composition preview: widget ${widgetId} was planned without a frame`);
      }
      let subscribed = false;
      const frame = options.mountFrame(slot, {
        widgetId,
        widgetCanonicalId: placement.widget,
        meta,
        settings: placement.settings,
        surface: PROFILES[source.profile].surface,
        entrance: swapping ? null : entranceOf(source.doc, widgetId, (type, kind) => declaresKind(meta.behaviorKinds, type, kind)),
        event: source.event,
        swapping
      }, {
        subscribed: (timed) => {
          subscribed = true;
          fact((scheduler3) => scheduler3.widgetSubscribed(widgetId, timed));
        },
        rendered: rendered ?? (() => fact((scheduler3) => scheduler3.widgetRendered(widgetId))),
        completed: () => {
          if (subscribed) {
            fact((scheduler3) => scheduler3.widgetCompleted(widgetId));
          }
        }
      });
      handed.set(widgetId, placement.settings);
      if (run?.started) {
        frame.release();
      }
      return frame;
    };
    const renderer = createDomRenderer({
      document: options.document,
      root: options.stage,
      atMs: 0,
      mountContent: (slot, widgetId) => {
        slots.set(widgetId, slot);
        frames.set(widgetId, mountInto(slot, widgetId, false));
        return () => {
          swaps.get(widgetId)?.cancel();
          swaps.delete(widgetId);
          frames.get(widgetId)?.unmount();
          frames.delete(widgetId);
          slots.delete(widgetId);
          handed.delete(widgetId);
          relay.forget(widgetId);
        };
      },
      onDelegate: (widgetId, request) => relay.handle(widgetId, request)
    });
    renderer.pause();
    renderer.seek(0);
    const scheduler2 = createScheduler({
      doc: source.doc,
      profile: PROFILES[source.profile],
      clock,
      renderer,
      meta: source.frames,
      declaredKinds: (widgetId) => source.frames[widgetId]?.behaviorKinds,
      estimate: { durationsMs: mediaLengthEstimates(source.doc) },
      onFinished: () => finish(),
      documentChanges: "start"
    });
    const swapIn = (widgetId) => {
      const slot = slots.get(widgetId);
      const old = frames.get(widgetId);
      if (slot === undefined || old === undefined) {
        return;
      }
      swaps.get(widgetId)?.cancel();
      swaps.set(widgetId, swapFrameIn({
        mountFresh: (painted) => mountInto(slot, widgetId, true, painted),
        retire: () => old.unmount(),
        swapped: (fresh) => {
          swaps.delete(widgetId);
          frames.set(widgetId, fresh);
          for (const state of relay.ongoing(widgetId)) {
            fresh.sendBehavior(state);
          }
          fact((current) => current.widgetRendered(widgetId));
        },
        schedule: (callback, ms) => {
          const handle2 = options.baseClock.setTimer(options.baseClock.now() + ms, callback);
          return () => options.baseClock.clearTimer(handle2);
        }
      }));
    };
    const updateSettings = (widgetId) => {
      const frame = frames.get(widgetId);
      const before = handed.get(widgetId);
      const placement = source.doc.widgets[widgetId];
      const meta = source.frames[widgetId];
      if (frame === undefined || before === undefined || placement === undefined || meta === undefined) {
        return;
      }
      const reads = swaps.has(widgetId) ? null : frame.settingsReads();
      const decision = settingsUpdate(before, placement.settings, reads);
      if (decision === "none") {
        return;
      }
      if (decision === "patch") {
        handed.set(widgetId, placement.settings);
        frame.sendSettings(placement.settings, meta.mediaUrls);
        return;
      }
      swapIn(widgetId);
    };
    run = {
      clock,
      renderer,
      scheduler: scheduler2,
      frames,
      started: false,
      measuring: true,
      finished: false,
      update: (next) => {
        const plan2 = planSceneUpdate(placementsOf(source), placementsOf(next));
        const before = source;
        source = next;
        options.fitStage(canvasOf(next.doc));
        scheduler2.setDocument(next.doc, next.frames);
        for (const placement of plan2.replace) {
          if (before.doc.widgets[placement.id]?.widget === placement.widgetCanonicalId) {
            swapIn(placement.id);
          }
        }
        for (const placement of plan2.place) {
          updateSettings(placement.id);
        }
      }
    };
    playback = run;
    if (transient !== undefined) {
      scheduler2.setTransient(transient);
    }
    reportTimeline();
    reportPlayhead();
    if (autoplay) {
      play();
    }
  }
  function stopPlayback() {
    stopTicker();
    if (playback === null) {
      return;
    }
    const stopping = playback;
    playback = null;
    stopping.scheduler.dispose();
    stopping.renderer.dispose();
    stopping.clock.dispose();
  }
  function play() {
    const run = playback;
    if (run === null || run.clock.playing()) {
      return;
    }
    const durationMs = run.scheduler.timeline().finishMs;
    if (run.finished && durationMs !== null && run.clock.now() >= durationMs) {
      seek(0);
    }
    run.clock.play();
    run.renderer.play();
    if (!run.started) {
      run.started = true;
      for (const frame of run.frames.values()) {
        frame.release();
      }
    }
    startTicker();
    reportPlayhead();
  }
  function pause() {
    const run = playback;
    if (run === null || !run.clock.playing()) {
      return;
    }
    holdAtPlayhead(run);
    reportPlayhead();
  }
  function holdAtPlayhead(run) {
    run.clock.pause();
    run.renderer.pause();
    run.renderer.seek(run.clock.now());
    if (run.started) {
      run.measuring = false;
    }
    stopTicker();
  }
  function seek(ms) {
    const run = playback;
    if (run === null) {
      return;
    }
    run.measuring = false;
    run.clock.seek(ms);
    run.renderer.seek(ms);
    run.scheduler.resync();
    if (playback !== run) {
      return;
    }
    if (run.scheduler.timeline().finishMs === null || ms < run.scheduler.timeline().finishMs) {
      run.finished = false;
    }
    replayDelegations(run, ms);
    reportTimeline();
    reportPlayhead();
  }
  function restart() {
    if (loaded === null) {
      return;
    }
    stopPlayback();
    startPlayback(true);
  }
  function finish() {
    const run = playback;
    if (run === null) {
      return;
    }
    run.finished = true;
    if (run.clock.playing()) {
      holdAtPlayhead(run);
    }
    const current = mustBeLoaded();
    options.post({ type: PREVIEW_FINISHED, loadId: current.loadId, ms: run.clock.now() });
    reportPlayhead();
  }
  function replayDelegations(run, ms) {
    for (const [widgetId, widget] of Object.entries(run.scheduler.plan().widgets)) {
      const frame = run.frames.get(widgetId);
      if (frame === undefined || widget.delegated.length === 0) {
        continue;
      }
      frame.sendBehavior(null);
      for (const type of ["transition", "effect"]) {
        const latest = widget.delegated.filter((delegated) => delegated.type === type).sort((a, b) => b.startMs - a.startMs)[0];
        const state = latest === undefined ? null : stateFrom(latest, ms);
        if (state !== null) {
          frame.sendBehavior(state);
        }
      }
    }
  }
  function startTicker() {
    stopTicker();
    const tick = () => {
      ticker = null;
      if (playback === null || !playback.clock.playing()) {
        return;
      }
      reportPlayhead();
      ticker = { handle: options.baseClock.setTimer(options.baseClock.now() + PLAYHEAD_REPORT_MS, tick) };
    };
    ticker = { handle: options.baseClock.setTimer(options.baseClock.now() + PLAYHEAD_REPORT_MS, tick) };
  }
  function stopTicker() {
    if (ticker !== null) {
      options.baseClock.clearTimer(ticker.handle);
      ticker = null;
    }
  }
  function reportPlayhead() {
    if (playback === null || loaded === null) {
      return;
    }
    options.post({
      type: PREVIEW_PLAYHEAD,
      loadId: loaded.loadId,
      ms: playback.clock.now(),
      playing: playback.clock.playing()
    });
  }
  function reportTimeline() {
    if (playback === null || loaded === null) {
      return;
    }
    const timeline2 = playback.scheduler.timeline();
    const serialized = JSON.stringify(timeline2);
    if (serialized !== lastTimeline) {
      lastTimeline = serialized;
      options.post({
        type: PREVIEW_TIMELINE,
        loadId: loaded.loadId,
        timeline: timeline2,
        durationMs: PROFILES[loaded.profile].bounded ? timeline2.finishMs : null
      });
    }
    postProblems(loaded.loadId, [
      ...loaded.problems,
      ...timeline2.problems.map(({ behavior, kind }) => ({ kind: "timeline", id: behavior, detail: kind })),
      ...playback.scheduler.plan().skipped.map(({ behavior, reason }) => ({ kind: "plan", id: behavior, detail: reason }))
    ]);
  }
  function postProblems(loadId, problems) {
    const serialized = JSON.stringify([loadId, problems]);
    if (serialized === lastProblems) {
      return;
    }
    lastProblems = serialized;
    options.post({ type: PREVIEW_PROBLEMS, loadId, problems });
  }
  function mustBeLoaded() {
    if (loaded === null) {
      throw new Error("composition preview: nothing is loaded");
    }
    return loaded;
  }
  return {
    handle,
    dispose() {
      disposed = true;
      generation += 1;
      stopPlayback();
    }
  };
}
function stateFrom(delegated, ms) {
  const state = behaviorStateOf(delegated);
  if (state === null || delegated.endMs === null) {
    return state;
  }
  return { ...state, durationMs: Math.max(0, delegated.endMs - ms) };
}
function bindProblems(report) {
  return [
    ...report.missing.map((input) => ({ kind: "bind", id: input, detail: "missing input" })),
    ...report.unknownReferences.map(({ input }) => ({ kind: "bind", id: input, detail: "refers to an input it does not declare" })),
    ...report.malformed.map((path) => ({ kind: "bind", detail: `malformed input reference at ${path.join(".")}` }))
  ];
}
function updatesInPlace(previous, next) {
  return previous.profile === next.profile && JSON.stringify(previous.event) === JSON.stringify(next.event);
}
function canvasOf(doc) {
  return { width: doc.layout.width, height: doc.layout.height };
}
function placementsOf(loaded) {
  return Object.entries(loaded.doc.widgets).flatMap(([id, placement]) => {
    const meta = loaded.frames[id];
    if (meta === undefined) {
      return [];
    }
    return [
      {
        id,
        widgetCanonicalId: placement.widget,
        moduleId: "",
        position: { x: placement.x, y: placement.y, width: placement.width, height: placement.height },
        settings: placement.settings,
        hostsSurface: "",
        frameUrl: meta.frameUrl,
        behaviorKinds: meta.behaviorKinds
      }
    ];
  });
}

// public/scene-manager/asset-loader.ts
var ASSET_READ_PREFIX = "/assets/read/";
var ASSET_RETAIN_MS = 60000;
var MAX_DEPTH = 32;
var ELEMENT_LOADED_TYPE = /^(image|video|audio|font)(\/|$)/;

class AssetLoadError extends Error {
  code;
  constructor(code, path) {
    super(`asset ${path}: ${code}`);
    this.code = code;
    this.name = "AssetLoadError";
  }
}
function moduleIdOfWidget(canonicalId) {
  const marker = canonicalId.lastIndexOf(":widget:");
  if (marker <= 0) {
    return null;
  }
  const moduleId = canonicalId.slice(0, marker).split(":")[0] ?? "";
  return moduleId === "" ? null : moduleId;
}
function assetInScope(path, moduleId) {
  if (moduleId === "") {
    return false;
  }
  const segments = path.split("/");
  if (segments[0] !== "" || segments[1] !== "assets" || segments.length < 5) {
    return false;
  }
  const decoded = [];
  for (const segment of segments.slice(2)) {
    let value;
    try {
      value = decodeURIComponent(segment);
    } catch {
      return false;
    }
    if (value === "" || value === "." || value === ".." || value.includes("/") || value.includes("\\")) {
      return false;
    }
    decoded.push(value);
  }
  if (decoded[0] === "user") {
    return true;
  }
  return decoded[0] === "modules" && decoded[1] === moduleId;
}
function readAheadAssetPaths(settings, pageOrigin) {
  const paths = new Set;
  collect2(settings, pageOrigin, paths, 0);
  return [...paths];
}
function collect2(value, pageOrigin, paths, depth) {
  if (depth > MAX_DEPTH || typeof value !== "object" || value === null) {
    return;
  }
  if (Array.isArray(value)) {
    for (const item of value) {
      collect2(item, pageOrigin, paths, depth + 1);
    }
    return;
  }
  const record = value;
  if (typeof record.id === "string" && record.id !== "" && record.source !== "url" && typeof record.url === "string" && !(typeof record.type === "string" && ELEMENT_LOADED_TYPE.test(record.type))) {
    const path = engineAssetPath(record.url, pageOrigin);
    if (path !== null) {
      paths.add(path);
    }
    return;
  }
  for (const item of Object.values(record)) {
    collect2(item, pageOrigin, paths, depth + 1);
  }
}

class AssetCache {
  retainMs;
  entries = new Map;
  fetchFn;
  constructor(fetchFn, retainMs = ASSET_RETAIN_MS) {
    this.retainMs = retainMs;
    this.fetchFn = fetchFn ?? globalThis.fetch.bind(globalThis);
  }
  load(path) {
    const held = this.entries.get(path);
    if (held !== undefined) {
      return held;
    }
    const reading = this.read(path);
    this.entries.set(path, reading);
    const forget = () => {
      if (this.entries.get(path) === reading) {
        this.entries.delete(path);
      }
    };
    reading.then(() => setTimeout(forget, this.retainMs), forget);
    return reading;
  }
  size() {
    return this.entries.size;
  }
  readAhead(paths, moduleId) {
    for (const path of paths) {
      if (assetInScope(path, moduleId)) {
        this.load(path).catch(() => {});
      }
    }
  }
  scopedTo(moduleId) {
    return (path) => {
      if (!assetInScope(path, moduleId)) {
        return Promise.reject(new AssetLoadError("out_of_scope", path));
      }
      return this.load(path);
    };
  }
  async read(path) {
    let response;
    try {
      response = await this.fetchFn(`${ASSET_READ_PREFIX}${path.slice("/assets/".length)}`, {
        credentials: "same-origin"
      });
    } catch (err) {
      console.warn("[scene-manager] asset read failed", { path }, err);
      throw new AssetLoadError("unavailable", path);
    }
    if (response.status === 404) {
      throw new AssetLoadError("not_found", path);
    }
    if (!response.ok) {
      console.warn("[scene-manager] asset read refused", { path, status: response.status });
      throw new AssetLoadError("unavailable", path);
    }
    let bytes;
    try {
      bytes = await response.arrayBuffer();
    } catch (err) {
      console.warn("[scene-manager] asset read cut short", { path }, err);
      throw new AssetLoadError("unavailable", path);
    }
    return { contentType: response.headers.get("Content-Type") ?? "", bytes };
  }
}

// public/scene-manager/media-url.ts
var MAX_DEPTH2 = 32;
function isPlainObject2(value) {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
function isAbsoluteHttpUrl(value) {
  let url;
  try {
    url = new URL(value);
  } catch {
    return false;
  }
  return (url.protocol === "https:" || url.protocol === "http:") && url.hostname !== "";
}
function externalMediaUrl(value) {
  if (!isPlainObject2(value) || value.source !== "url" || typeof value.url !== "string" || !isAbsoluteHttpUrl(value.url)) {
    return null;
  }
  return value.url;
}
function rewriteExternalMedia(value, replace) {
  return rewrite(value, replace, 0);
}
function rewrite(value, replace, depth) {
  if (depth > MAX_DEPTH2 || typeof value !== "object" || value === null) {
    return value;
  }
  if (Array.isArray(value)) {
    let changed = false;
    const next2 = value.map((item) => {
      const rewritten = rewrite(item, replace, depth + 1);
      changed ||= rewritten !== item;
      return rewritten;
    });
    return changed ? next2 : value;
  }
  const record = value;
  const external = externalMediaUrl(record);
  if (external !== null) {
    const replaced = replace(external);
    return replaced === undefined || replaced === external ? record : { ...record, url: replaced };
  }
  let next = null;
  for (const [key, item] of Object.entries(record)) {
    const rewritten = rewrite(item, replace, depth + 1);
    if (rewritten !== item) {
      next ??= { ...record };
      next[key] = rewritten;
    }
  }
  return next ?? record;
}
var MEDIA_REFRESH_MARGIN_MS = 6 * 60 * 60 * 1000;
var MAX_MEDIA_REFRESH_RETRY_MS = 30 * 60000;
function replaceMediaUrls(value, urls) {
  if (urls.size === 0) {
    return value;
  }
  return rewriteExternalMedia(value, (url) => urls.get(url));
}

// public/scene-manager/page-clock.ts
var PAGE_CLOCK = {
  now: () => performance.now(),
  setTimer: (atMs, callback) => setTimeout(callback, Math.max(0, atMs - performance.now())),
  clearTimer: (handle) => clearTimeout(handle)
};

// public/scene-manager/widget-bridge.ts
class WidgetBridge {
  instanceId;
  nonce;
  callbacks;
  iframe = null;
  moduleId = null;
  initialized = false;
  shimStorageSubs = new Map;
  shimSubToKey = new Map;
  shimEventSubs = new Set;
  readKeys = new Set;
  readAll = false;
  documentGeneration = 0;
  constructor(instanceId, nonce, callbacks) {
    this.instanceId = instanceId;
    this.nonce = nonce;
    this.callbacks = callbacks;
  }
  attach(iframe) {
    this.iframe = iframe;
  }
  onFrameLoad() {
    this.documentGeneration += 1;
    this.initialized = false;
    this.moduleId = null;
    this.readKeys.clear();
    this.readAll = false;
    this.shimStorageSubs.clear();
    this.shimSubToKey.clear();
    this.shimEventSubs.clear();
  }
  handleMessage(event) {
    if (!this.iframe || event.source !== this.iframe.contentWindow) {
      return;
    }
    const data = event.data;
    if (typeof data !== "object" || data === null) {
      return;
    }
    const msg = data;
    if (msg.proto !== WIDGET_PROTOCOL) {
      return;
    }
    if (msg.nonce !== this.nonce) {
      return;
    }
    const type = typeof msg.type === "string" ? msg.type : "";
    if (!type) {
      return;
    }
    if (type === "hello") {
      const v = msg.v;
      const incomingModuleId = typeof msg.moduleId === "string" ? msg.moduleId : "";
      if (v !== PROTOCOL_VERSION) {
        this.sendReject(`unsupported protocol version ${v}`);
        return;
      }
      this.moduleId = incomingModuleId;
      this.initialized = true;
      this.sendInit({});
      return;
    }
    if (!isWidgetProtocolEnvelope(data)) {
      return;
    }
    switch (type) {
      case "storage.get": {
        if (!this.initialized || !this.moduleId) {
          return;
        }
        const id = typeof msg.id === "string" ? msg.id : "";
        const key = typeof msg.key === "string" ? msg.key : "";
        const value = this.callbacks.onStorageGet(this.moduleId, key);
        this.post({ type: "storage.value", id, key, value });
        return;
      }
      case "asset.load": {
        if (!this.initialized) {
          return;
        }
        const id = typeof msg.id === "string" ? msg.id : "";
        const path = typeof msg.path === "string" ? msg.path : "";
        if (!id) {
          return;
        }
        this.answerAssetLoad(id, path);
        return;
      }
      case "storage.subscribe": {
        if (!this.initialized || !this.moduleId) {
          return;
        }
        const key = typeof msg.key === "string" ? msg.key : "";
        const subId = typeof msg.subId === "string" ? msg.subId : "";
        const storageKey = `${this.moduleId}:${key}`;
        let subIds = this.shimStorageSubs.get(storageKey);
        if (!subIds) {
          subIds = new Set;
          this.shimStorageSubs.set(storageKey, subIds);
        }
        subIds.add(subId);
        this.shimSubToKey.set(subId, storageKey);
        this.callbacks.onStorageSubscribe(this.moduleId, key, this.instanceId);
        return;
      }
      case "storage.unsubscribe": {
        if (!this.initialized || !this.moduleId) {
          return;
        }
        const subId = typeof msg.subId === "string" ? msg.subId : "";
        const storageKey = this.shimSubToKey.get(subId);
        if (!storageKey) {
          return;
        }
        this.shimSubToKey.delete(subId);
        const subIds = this.shimStorageSubs.get(storageKey);
        if (subIds) {
          subIds.delete(subId);
          if (subIds.size === 0) {
            this.shimStorageSubs.delete(storageKey);
          }
        }
        const colonIdx = storageKey.indexOf(":");
        const key = colonIdx >= 0 ? storageKey.slice(colonIdx + 1) : storageKey;
        this.callbacks.onStorageUnsubscribe(this.moduleId, key, this.instanceId);
        return;
      }
      case "events.subscribe": {
        if (!this.initialized) {
          return;
        }
        const subId = typeof msg.subId === "string" ? msg.subId : "";
        if (!subId) {
          return;
        }
        this.shimEventSubs.add(subId);
        const queue = isEventQueueConfig(msg.queue) ? msg.queue : undefined;
        this.callbacks.onEventsSubscribe(subId, queue);
        return;
      }
      case "events.unsubscribe": {
        if (!this.initialized) {
          return;
        }
        const subId = typeof msg.subId === "string" ? msg.subId : "";
        this.shimEventSubs.delete(subId);
        this.callbacks.onEventsUnsubscribe(subId);
        return;
      }
      case "event.complete": {
        if (!this.initialized) {
          return;
        }
        const subId = typeof msg.subId === "string" ? msg.subId : "";
        const eventId = typeof msg.eventId === "string" ? msg.eventId : "";
        if (!subId || !eventId) {
          return;
        }
        this.callbacks.onEventComplete(subId, eventId);
        return;
      }
      case "settings.reads": {
        if (!this.initialized) {
          return;
        }
        if (msg.all === true) {
          this.readAll = true;
        }
        if (Array.isArray(msg.keys)) {
          for (const key of msg.keys) {
            if (typeof key === "string") {
              this.readKeys.add(key);
            }
          }
        }
        return;
      }
      case "rendered": {
        this.callbacks.onRendered?.();
        return;
      }
      case "status.report": {
        if (!this.initialized) {
          return;
        }
        this.callbacks.onStatusReport({
          instanceId: this.instanceId,
          key: typeof msg.key === "string" ? msg.key : "",
          value: msg.value,
          ts: typeof msg.ts === "string" ? msg.ts : new Date().toISOString()
        });
        return;
      }
      default:
        return;
    }
  }
  sendInit(settings) {
    this.post({
      type: "init",
      settings,
      capabilities: ["storage", "events", "status", "settings", "assets"]
    });
  }
  sendReject(reason) {
    this.post({
      type: "init.reject",
      reason,
      supportedVersions: [PROTOCOL_VERSION]
    });
  }
  sendStorageValue(key, value) {
    if (this.moduleId) {
      this.sendStorageChanged(this.moduleId, key, value);
    }
  }
  sendStorageChanged(moduleId, key, value) {
    if (!this.initialized) {
      return;
    }
    const storageKey = `${moduleId}:${key}`;
    const subIds = this.shimStorageSubs.get(storageKey);
    const occurredAt = new Date().toISOString();
    if (subIds && subIds.size > 0) {
      for (const subId of subIds) {
        this.post({ type: "storage.changed", subId, key, value, occurredAt });
      }
    } else {
      this.post({ type: "storage.changed", subId: storageKey, key, value, occurredAt });
    }
  }
  sendEvent(subId, event) {
    if (!this.initialized || !this.shimEventSubs.has(subId)) {
      return false;
    }
    this.post({ type: "event.deliver", subId, event });
    return true;
  }
  settingsReads() {
    return this.initialized ? { all: this.readAll, keys: this.readKeys } : null;
  }
  sendSettings(settings) {
    if (this.initialized) {
      this.post({ type: "settings.changed", settings });
    }
  }
  sendBehavior(behavior) {
    this.post({ type: "behavior", behavior });
  }
  dispose() {
    this.post({ type: "dispose", reason: "scene-manager-dispose" });
    this.callbacks.onDispose();
  }
  detach() {
    this.documentGeneration += 1;
    this.iframe = null;
    this.initialized = false;
    this.moduleId = null;
    this.readKeys.clear();
    this.readAll = false;
    this.shimStorageSubs.clear();
    this.shimSubToKey.clear();
    this.shimEventSubs.clear();
  }
  answerAssetLoad(id, path) {
    const generation = this.documentGeneration;
    this.callbacks.onAssetLoad(path).then((asset) => {
      if (generation === this.documentGeneration) {
        this.post({ type: "asset.value", id, contentType: asset.contentType, bytes: asset.bytes });
      }
    }, (err) => {
      if (!(err instanceof AssetLoadError)) {
        console.warn("[scene-manager] asset load failed unexpectedly", { path }, err);
      }
      if (generation === this.documentGeneration) {
        this.post({ type: "asset.error", id, code: err instanceof AssetLoadError ? err.code : "unavailable" });
      }
    });
  }
  post(payload) {
    const win = this.iframe?.contentWindow;
    if (!win) {
      return;
    }
    win.postMessage({
      proto: WIDGET_PROTOCOL,
      v: PROTOCOL_VERSION,
      nonce: this.nonce,
      ...payload
    }, "*");
  }
}
function isEventQueueConfig(value) {
  return typeof value === "object" && value !== null;
}
function createFrameLoadHandler(bridge) {
  let loadCount = 0;
  return () => {
    loadCount += 1;
    if (loadCount > 1) {
      bridge.onFrameLoad();
    }
  };
}

// public/scene-manager/composition-preview-page.ts
var FRAMES_PATH = "/preview/composition/frames";
var REFRESH_PATH = "/preview/composition/session/refresh";
var REFRESH_INTERVAL_MS = 50000;
function generateNonce() {
  const bytes = new Uint8Array(16);
  crypto.getRandomValues(bytes);
  return btoa(String.fromCharCode(...bytes)).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}
function isRecord2(value) {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
function stringRecord(value) {
  if (!isRecord2(value)) {
    return {};
  }
  return Object.fromEntries(Object.entries(value).filter((entry) => typeof entry[1] === "string"));
}
function parseFrameResolution(body) {
  if (!isRecord2(body) || !isRecord2(body.widgets)) {
    throw new Error("the engine's framing answer is malformed");
  }
  const widgets = {};
  for (const [id, raw] of Object.entries(body.widgets)) {
    if (!isRecord2(raw) || typeof raw.frameUrl !== "string" || !raw.frameUrl.startsWith("/frames/")) {
      continue;
    }
    widgets[id] = {
      frameUrl: raw.frameUrl,
      linkedResources: stringRecord(raw.linkedResources),
      mediaUrls: stringRecord(raw.mediaUrls),
      behaviorKinds: isDeclaredBehaviorKinds(raw.behaviorKinds) ? raw.behaviorKinds : NO_DECLARED_KINDS
    };
  }
  const problems = [];
  for (const raw of Array.isArray(body.problems) ? body.problems : []) {
    if (isRecord2(raw) && (raw.kind === "unknown-widget" || raw.kind === "unframed-widget") && typeof raw.id === "string") {
      problems.push({ kind: raw.kind, id: raw.id });
    }
  }
  return { widgets, problems };
}
async function resolveFrames(doc) {
  const widgets = Object.entries(doc.widgets).map(([id, placement]) => ({
    id,
    widget: placement.widget,
    settings: placement.settings
  }));
  const response = await fetch(FRAMES_PATH, {
    method: "POST",
    credentials: "same-origin",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ widgets })
  });
  if (!response.ok) {
    throw new Error(`the engine refused to frame the widgets (${response.status})`);
  }
  return parseFrameResolution(await response.json());
}
function mountFrame(bridges, assets, slot, spec, facts) {
  const instanceId = `preview.${spec.widgetId}`;
  const moduleId = moduleIdOfWidget(spec.widgetCanonicalId) ?? "";
  const nonce = generateNonce();
  const iframe = document.createElement("iframe");
  iframe.className = "widget-frame";
  if (spec.swapping) {
    iframe.style.opacity = "0";
  }
  iframe.setAttribute("sandbox", "allow-scripts");
  const event = {
    type: spec.surface === "alert" ? "alert" : spec.event?.type ?? "preview",
    source: "scene-manager",
    time: new Date().toISOString(),
    data: spec.surface === "alert" ? spec.event : spec.event?.data ?? null,
    eventId: `preview-${nonce}`
  };
  const waiting = [];
  let released = false;
  const bridge = new WidgetBridge(instanceId, nonce, {
    onStorageGet: () => null,
    onStorageSubscribe: () => {},
    onStorageUnsubscribe: () => {},
    onStatusReport: () => {},
    onAssetLoad: assets.scopedTo(moduleId),
    onEventsSubscribe: (subId, queue) => {
      facts.subscribed(queue?.autoComplete === false);
      if (spec.event === null) {
        return;
      }
      if (released) {
        bridge.sendEvent(subId, event);
      } else {
        waiting.push(subId);
      }
    },
    onEventsUnsubscribe: (subId) => {
      const at = waiting.indexOf(subId);
      if (at >= 0) {
        waiting.splice(at, 1);
      }
    },
    onEventComplete: () => facts.completed(),
    onDispose: () => {},
    onRendered: () => facts.rendered()
  });
  iframe.addEventListener("load", createFrameLoadHandler(bridge));
  const boot = encodePlacementBoot({
    nonce,
    instanceId,
    settings: replaceMediaUrls(spec.settings, new Map(Object.entries(spec.meta.mediaUrls))),
    linkedResources: spec.meta.linkedResources,
    surface: spec.surface,
    ...spec.entrance === null ? {} : { behavior: spec.entrance }
  });
  iframe.src = `${spec.meta.frameUrl}#${boot}`;
  assets.readAhead(readAheadAssetPaths(spec.settings, location.origin), moduleId);
  bridges.add(bridge);
  slot.appendChild(iframe);
  bridge.attach(iframe);
  return {
    sendBehavior: (state) => bridge.sendBehavior(state),
    release: () => {
      if (released) {
        return;
      }
      released = true;
      for (const subId of waiting.splice(0)) {
        bridge.sendEvent(subId, event);
      }
    },
    settingsReads: () => bridge.settingsReads(),
    sendSettings: (settings, mediaUrls) => bridge.sendSettings(replaceMediaUrls(settings, new Map(Object.entries(mediaUrls)))),
    reveal: () => {
      iframe.style.opacity = "";
    },
    unmount: () => {
      bridge.dispose();
      bridge.detach();
      bridges.delete(bridge);
      iframe.remove();
    }
  };
}
function main() {
  const viewport = document.getElementById("viewport");
  const stage = document.getElementById("stage");
  if (!viewport || !stage || window.parent === window) {
    return;
  }
  const bridges = new Set;
  const assets = new AssetCache;
  let parentOrigin = null;
  let canvas = null;
  const fitStage = () => {
    if (canvas === null) {
      return;
    }
    stage.style.width = `${canvas.width}px`;
    stage.style.height = `${canvas.height}px`;
    const fit = fitCanvas(canvas, { width: viewport.clientWidth, height: viewport.clientHeight });
    stage.style.transform = `translate(${fit.x}px, ${fit.y}px) scale(${fit.scale})`;
  };
  const preview = createCompositionPreview({
    document,
    stage,
    fitStage: (size) => {
      canvas = size;
      fitStage();
    },
    baseClock: PAGE_CLOCK,
    resolveFrames,
    mountFrame: (slot, spec, facts) => mountFrame(bridges, assets, slot, spec, facts),
    post: (report) => window.parent.postMessage(report, parentOrigin ?? "*")
  });
  window.addEventListener("message", (event) => {
    if (event.source === window.parent) {
      if (isPreviewMessage(event.data) && event.origin !== "null") {
        parentOrigin = event.origin;
      }
      preview.handle(event.data);
      return;
    }
    for (const bridge of bridges) {
      bridge.handleMessage(event);
    }
  });
  window.addEventListener("resize", fitStage);
  setInterval(() => {
    fetch(REFRESH_PATH, { method: "POST", credentials: "same-origin" }).catch(() => {});
  }, REFRESH_INTERVAL_MS);
}
if (typeof window !== "undefined" && typeof document !== "undefined") {
  main();
}
export {
  parseFrameResolution
};
