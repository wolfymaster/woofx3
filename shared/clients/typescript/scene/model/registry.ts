// The type registry: what a valid entry of each collection of a composition
// looks like, and how each of its fields is edited.
//
// A collection (`widgets`, `behaviors`) fixes the fields every one of its
// entries has and the grain each field is edited at. The sync layer's diff,
// validation and field-wise copy all read the grain from here, so they agree
// on what one change to an entry is. An entity type (`widget`, `transition`,
// `effect`, `activity`) adds what depends on the entry's type: which kinds
// and params it takes, its timing limits, its defaults, and how an entry
// stored in an older shape is brought up to date.
//
// Placements are all of the one entity type `widget`, whatever widget they
// show, but some widgets constrain how their box is edited. Those rules are
// the widget's traits (`WidgetTraits`), keyed by canonical widget id: the
// bundled widgets' are built in, and `createRegistry` takes more, so a
// module's widgets can declare theirs the same way.
//
// A registry runs in one of two modes:
//
// - `strict`, for the engine, which is authoritative: an entry of a type it
//   does not know, or carrying a field or param it does not know, is refused,
//   so nothing is stored that no part of this engine can play or edit.
// - `tolerant`, for editors and overlays: an entry of an unknown type is kept
//   as it is, and a known one may carry fields this build does not know. An
//   older client editing a document a newer engine wrote then never strips
//   what it cannot read, and renders nothing for what it does not know. What
//   a tolerant client sends is still checked by the strict engine.

import { assert, isCompositionShape, isPlainObject, sameValue } from "./composition";
import { BUILTIN_COLLECTIONS, BUILTIN_TYPES, BUILTIN_WIDGET_TRAITS, ENTRY_ID_MAX_LENGTH } from "./entity-types";
import type { BehaviorDocument, BehaviorId, CompositionDocument } from "./types";

export type RegistryMode = "strict" | "tolerant";

export type CollectionName = "widgets" | "behaviors";

export const COLLECTIONS: readonly CollectionName[] = ["widgets", "behaviors"];

/** A JSON Schema (draft 2020-12) object. */
export type JsonSchema = Record<string, unknown>;

/**
 * How one field of an entry changes, which is the shape of the json0
 * components that may reach into it:
 *
 * - `fixed`: only with its entry; replacing the entry is the only way to
 *   change it (a behavior's `type`, on which every other field depends).
 * - `value`: replaced whole.
 * - `text`: replaced whole, or changed by text splices that merge with
 *   concurrent ones.
 * - `freeform`: an object changed key by key at any depth, with text in it
 *   spliced (a widget's own settings).
 * - `keyed`: an object changed key by key at any depth, every value
 *   replaced whole: its values are tokens, which a merged splice would turn
 *   into a value neither side wrote.
 * - `struct`: an object with fixed fields (`subfields`), each replaced whole,
 *   and an optional one inserted or removed.
 */
export type FieldGrain = "fixed" | "value" | "text" | "freeform" | "keyed" | "struct";

export interface SubfieldSpec {
  optional: boolean;
  valid(value: unknown): boolean;
  schema: JsonSchema;
}

export interface FieldSpec {
  grain: FieldGrain;
  /**
   * Whether `value` may stand as this field of an entry of any type. In
   * `tolerant` mode a struct may carry subfields this build does not know.
   */
  valid(value: unknown, mode: RegistryMode): boolean;
  /** For a `struct` only. */
  subfields?: Readonly<Record<string, SubfieldSpec>>;
  schema: JsonSchema;
}

export interface CollectionDefinition {
  name: CollectionName;
  /** What one entry is called in messages. */
  noun: string;
  /** The fields every entry has. */
  fields: Readonly<Record<string, FieldSpec>>;
  /** The type of an entry, or null when it names none. */
  typeOf(entry: Record<string, unknown>): string | null;
}

export interface EntryMigration {
  entry: Record<string, unknown>;
  behaviors?: Record<BehaviorId, BehaviorDocument>;
}

/** Who plays a behavior kind: the overlay on the widget's box, or the widget itself. */
export type KindExecutor = "host" | "widget";

/**
 * One type of entry. `invalid` sees only entries whose collection fields
 * are all present and valid, so it checks only what depends on the type.
 */
export interface EntityType {
  collection: CollectionName;
  name: string;
  invalid(entry: Record<string, unknown>, mode: RegistryMode): string | null;
  /** `seed` with every field it lacks filled in; nested fields are filled in key by key. */
  withDefaults(seed: Record<string, unknown>): Record<string, unknown>;
  /**
   * An entry stored in an older shape, in the current one, with any
   * behaviors split out of it; absent when the type has had no other shape.
   */
  migrate?(entry: Record<string, unknown>, id: string): EntryMigration;
  /** Who plays `kind`, or null when this type does not take it. Behavior types only. */
  executorOf?(kind: string): KindExecutor | null;
  /** The constraints this type adds to its collection's entry schema. */
  schema(mode: RegistryMode): JsonSchema;
}

/**
 * How a widget's box is edited, beyond what every placement allows. These
 * constrain editing only: a stored placement is valid whatever its box.
 */
export interface WidgetTraits {
  /** A resize keeps the box's aspect unless the user asks otherwise. */
  keepsAspect: boolean;
  /**
   * The box's height follows its text (`settings.text` at
   * `settings.fontSize`) whenever either changes, unless the same edit sets
   * the height.
   */
  heightFollowsText: boolean;
}

/** The traits of a widget that declares none. */
export const DEFAULT_WIDGET_TRAITS: Readonly<WidgetTraits> = { keepsAspect: false, heightFollowsText: false };

export class TypeRegistry {
  readonly mode: RegistryMode;
  private readonly collections: ReadonlyMap<CollectionName, CollectionDefinition>;
  private readonly types: ReadonlyMap<string, EntityType>;
  private readonly traits: ReadonlyMap<string, Readonly<WidgetTraits>>;

  constructor(
    mode: RegistryMode,
    collections: readonly CollectionDefinition[],
    types: readonly EntityType[],
    widgetTraits: Readonly<Record<string, Partial<WidgetTraits>>> = {}
  ) {
    const byName = new Map<CollectionName, CollectionDefinition>();
    for (const collection of collections) {
      assert(!byName.has(collection.name), `collection ${collection.name} is defined once`);
      byName.set(collection.name, collection);
    }
    const byKey = new Map<string, EntityType>();
    for (const type of types) {
      assert(byName.has(type.collection), `type ${type.name} belongs to a defined collection`);
      const key = typeKey(type.collection, type.name);
      assert(!byKey.has(key), `type ${key} is registered once`);
      byKey.set(key, type);
    }
    this.mode = mode;
    this.collections = byName;
    this.types = byKey;
    this.traits = new Map(
      Object.entries(widgetTraits).map(([widgetId, traits]) => [widgetId, { ...DEFAULT_WIDGET_TRAITS, ...traits }])
    );
  }

  /** How a placement of `widgetId` is edited; a widget that declares nothing has the defaults. */
  widgetTraits(widgetId: string): Readonly<WidgetTraits> {
    return this.traits.get(widgetId) ?? DEFAULT_WIDGET_TRAITS;
  }

  isCollection(name: unknown): name is CollectionName {
    return typeof name === "string" && this.collections.has(name as CollectionName);
  }

  collection(name: CollectionName): CollectionDefinition {
    const collection = this.collections.get(name);
    assert(collection !== undefined, `collection ${name} is defined`);
    return collection;
  }

  /** The collections, in the order a document lists them. */
  collectionNames(): CollectionName[] {
    return [...this.collections.keys()];
  }

  field(collection: CollectionName, field: string): FieldSpec | undefined {
    const fields = this.collection(collection).fields;
    return Object.hasOwn(fields, field) ? fields[field] : undefined;
  }

  type(collection: CollectionName, name: string): EntityType | undefined {
    return this.types.get(typeKey(collection, name));
  }

  typesOf(collection: CollectionName): EntityType[] {
    return [...this.types.values()].filter((type) => type.collection === collection);
  }

  /** Who plays a behavior's kind, or null when its type is unknown or does not take the kind. */
  executorOf(type: string, kind: string): KindExecutor | null {
    return this.type("behaviors", type)?.executorOf?.(kind) ?? null;
  }

  /** Whether `value` has exactly the collection's fields, whatever their values. */
  hasExactFields(collection: CollectionName, value: unknown): value is Record<string, unknown> {
    if (!isPlainObject(value)) {
      return false;
    }
    const fields = this.collection(collection).fields;
    const keys = Object.keys(value);
    return keys.length === Object.keys(fields).length && keys.every((key) => Object.hasOwn(fields, key));
  }

  /** Why `value` is not a valid entry of `collection`, or null when it is. */
  invalidEntry(collection: CollectionName, value: unknown): string | null {
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
    for (const [field, spec] of Object.entries(definition.fields)) {
      if (!Object.hasOwn(value, field)) {
        return `a ${definition.noun} needs ${field}`;
      }
      if (!spec.valid(value[field], this.mode)) {
        return `invalid ${definition.noun} ${field}`;
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

  isEntry(collection: CollectionName, value: unknown): value is Record<string, unknown> {
    return this.invalidEntry(collection, value) === null;
  }

  /** Why `value` may not replace `field` of an entry, or null when it may. The whole entry is checked after. */
  invalidField(collection: CollectionName, field: string, value: unknown): string | null {
    const definition = this.collection(collection);
    const spec = this.field(collection, field);
    if (spec === undefined) {
      return `a ${definition.noun} has no field ${field}`;
    }
    if (spec.grain === "fixed") {
      return `a ${definition.noun}'s ${field} changes only with the whole ${definition.noun}`;
    }
    return spec.valid(value, this.mode) ? null : `invalid ${definition.noun} ${field}`;
  }

  /**
   * Why a component may not change subfield `subfield` of struct field
   * `field`, or null when it may. `inserts` and `removes` say what the
   * component does; a required subfield is only ever replaced.
   */
  invalidSubfield(
    collection: CollectionName,
    field: string,
    subfield: string,
    change: { inserts: boolean; removes: boolean; value: unknown }
  ): string | null {
    const spec = this.field(collection, field);
    if (spec === undefined || spec.grain !== "struct" || spec.subfields === undefined) {
      return `${field} has no fields of its own`;
    }
    const sub = Object.hasOwn(spec.subfields, subfield) ? spec.subfields[subfield] : undefined;
    if (sub === undefined) {
      return `${field} has no field ${subfield}`;
    }
    if (!sub.optional && !(change.inserts && change.removes)) {
      return `${field}.${subfield} can only be replaced`;
    }
    if (change.inserts && !sub.valid(change.value)) {
      return `invalid ${field}.${subfield}`;
    }
    return null;
  }

  /**
   * Why layout key `key` may not be set to `value`, or null when it may;
   * `value` undefined means the key is removed. The canvas size is a
   * positive, finite number and is never removed: the editor's geometry and
   * the overlay's scaling divide by it. The background is a string. Any
   * other key is the caller's own and takes any JSON value. The same in
   * both modes, as no build can draw a canvas without a size.
   */
  invalidLayoutKey(key: string, value: unknown): string | null {
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

  /**
   * Why `after`, an edit of `before`, is not a valid composition, or null
   * when it is. Every layout key and every entry added or changed must be
   * valid, entries under an id the sync layer takes. What the edit left as
   * it was is not checked again: an entry that is invalid already (merged
   * from concurrent edits, or kept by a tolerant client from a newer
   * engine), or a canvas stored without a size, must not block every edit
   * elsewhere in the document.
   */
  invalidEdit(before: CompositionDocument, after: CompositionDocument): string | null {
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
      const was = before[collection] as Record<string, unknown>;
      const is = after[collection] as Record<string, unknown>;
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

  /**
   * A new entry of `type` from `seed`, every field it lacks filled with the
   * type's default. Throws when the result is not a valid entry: a seed must
   * give what has no default (a widget's id and size, a behavior's target).
   */
  create(collection: CollectionName, type: string, seed: Record<string, unknown>): Record<string, unknown> {
    const built = this.tryCreate(collection, type, seed);
    assert(built.ok, `a new ${type} is valid: ${built.ok ? "" : built.detail}`);
    return built.entry;
  }

  /**
   * As `create`, but a seed that does not make a valid entry is refused with
   * the reason instead of thrown: for seeds that carry what a user chose (a
   * behavior's kind and params), which are not a programmer's mistake.
   */
  tryCreate(
    collection: CollectionName,
    type: string,
    seed: Record<string, unknown>
  ): { ok: true; entry: Record<string, unknown> } | { ok: false; detail: string } {
    const entityType = this.type(collection, type);
    if (entityType === undefined) {
      return { ok: false, detail: `there is no ${this.collection(collection).noun} type ${type}` };
    }
    const entry = entityType.withDefaults(seed);
    const invalid = this.invalidEntry(collection, entry);
    return invalid === null ? { ok: true, entry } : { ok: false, detail: invalid };
  }

  /**
   * `doc` with every entry in the current shape of its type. An entry whose
   * type is unknown or has had no other shape is left as it is. A behavior
   * split out of an entry is added unless one with its id exists, which
   * means the same entry was migrated before.
   */
  migrateDocument(doc: CompositionDocument): CompositionDocument {
    const next: CompositionDocument = { ...doc, widgets: { ...doc.widgets }, behaviors: { ...doc.behaviors } };
    for (const collection of this.collectionNames()) {
      const entries = next[collection] as Record<string, unknown>;
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

const CANVAS_SIZE_KEYS: ReadonlySet<string> = new Set(["width", "height"]);

function typeKey(collection: CollectionName, name: string): string {
  return `${collection}/${name}`;
}

/**
 * A registry of the built-in types and widget traits, plus `extra` ones. A
 * widget's traits are declared once: extra traits may not redefine a
 * bundled widget's.
 */
export function createRegistry(
  mode: RegistryMode,
  extra: readonly EntityType[] = [],
  extraWidgetTraits: Readonly<Record<string, Partial<WidgetTraits>>> = {}
): TypeRegistry {
  for (const widgetId of Object.keys(extraWidgetTraits)) {
    assert(!Object.hasOwn(BUILTIN_WIDGET_TRAITS, widgetId), `widget ${widgetId} declares its traits once`);
  }
  return new TypeRegistry(mode, BUILTIN_COLLECTIONS, [...BUILTIN_TYPES, ...extra], {
    ...BUILTIN_WIDGET_TRAITS,
    ...extraWidgetTraits,
  });
}

/** The registry the engine validates with. */
export const STRICT_REGISTRY: TypeRegistry = createRegistry("strict");

/** The registry editors and overlays validate their own changes with. */
export const TOLERANT_REGISTRY: TypeRegistry = createRegistry("tolerant");
