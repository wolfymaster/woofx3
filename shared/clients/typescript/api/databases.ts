// Databases: tables a streamer owns, one resource instance of the bundled
// `database` kind each. The engine's db service owns the rows and checks every
// write against the instance's `columns` setting; clients only ask.

/** The canonical kind of a database resource instance. */
export const DATABASE_KIND = "woofx3:database";

/** The instance setting holding a database's column definitions. */
export const DATABASE_COLUMNS_SETTING = "columns";

/**
 * Integrity bounds of every database on every engine, not plan entitlements.
 * Must match DefaultDatabaseLimits and the cell limits in
 * db/app/services/database_columns.go and database_values.go.
 */
export const DATABASE_LIMITS = {
  columns: 32,
  records: 10_000,
  pageSize: 100,
  label: 100,
  selectOptions: 50,
  text: 5000,
  url: 2048,
  insertKey: 255,
} as const;

export const DATABASE_COLUMN_TYPES = ["text", "number", "boolean", "date", "url", "select"] as const;

export type DatabaseColumnType = (typeof DATABASE_COLUMN_TYPES)[number];

export interface DatabaseColumnOption {
  value: string;
  label: string;
}

/**
 * One entry of the `columns` setting. `id` never changes once a column
 * exists; `public` columns are the only ones the public user page can show.
 */
export interface DatabaseColumn {
  id: string;
  label: string;
  type: DatabaseColumnType;
  public: boolean;
  /** `select` only. */
  options?: DatabaseColumnOption[];
}

/** A cell: text for text, date (`YYYY-MM-DD`), url and select columns. */
export type DatabaseValue = string | number | boolean;

export interface DatabaseRecord {
  id: string;
  /** The database's canonical id. */
  databaseId: string;
  /** Starts at 1 and grows by one per change. */
  revision: number;
  /** ISO 8601. */
  createdAt: string;
  updatedAt: string;
  /** Cells by column id; an empty cell is absent. */
  values: Record<string, DatabaseValue>;
}

/** What a sort orders by: a column id, or creation time. */
export const DATABASE_SORT_CREATED_AT = "createdAt";

export interface DatabaseRecordsQuery {
  databaseId: string;
  /** A column id or DATABASE_SORT_CREATED_AT. Defaults to creation time. */
  sortBy?: string;
  /** Defaults to "asc". Empty cells sort last either way. */
  direction?: "asc" | "desc";
  offset?: number;
  /** 1 to DATABASE_LIMITS.pageSize. */
  limit: number;
}

export interface DatabaseRecordPage {
  records: DatabaseRecord[];
  total: number;
}

/** Cells to write by column id. `null` empties a cell on update. */
export type DatabaseValuesInput = Record<string, DatabaseValue | null>;

export interface DatabaseRecordCreate {
  databaseId: string;
  values: DatabaseValuesInput;
  /** Idempotency key: a repeat answers `duplicate` with the first row. */
  insertKey?: string;
}

export type DatabaseRecordCreateResult =
  | { status: "created"; record: DatabaseRecord }
  | { status: "duplicate"; record: DatabaseRecord }
  /** The database holds DATABASE_LIMITS.records rows; nothing was written. */
  | { status: "full" };

export interface DatabaseRecordUpdate {
  databaseId: string;
  recordId: string;
  /** Only these cells change. */
  values: DatabaseValuesInput;
  /** Write only while the row holds this revision. */
  expectedRevision?: number;
}

export type DatabaseRecordUpdateResult =
  | { status: "updated"; record: DatabaseRecord }
  | { status: "missing" }
  /** The row holds another revision than `expectedRevision`; nothing was written. */
  | { status: "conflict" };

export type DatabaseRecordDeleteResult = { status: "deleted" } | { status: "missing" };

/**
 * Data of the `database.record.changed` webhook. Carries only the columns
 * public when the row changed; `publicValues` is null on delete. `revision`
 * orders one row's changes: drop one older than what is held. Must match
 * databaseRecordChangedEvent in db/app/services/database_record_service.go.
 */
export interface DatabaseRecordChange {
  databaseId: string;
  recordId: string;
  op: "created" | "updated" | "deleted";
  revision: number;
  createdAt: string;
  publicValues: Record<string, DatabaseValue> | null;
}

/**
 * A row as the db proxy's DatabaseRecordService sends it: the fields of its
 * `DatabaseRecord` message, read structurally so this package needs no
 * generated client.
 */
export interface DatabaseRecordWire {
  id: string;
  databaseId: string;
  revision: bigint;
  createdAt?: { seconds: bigint; nanos: number } | null;
  updatedAt?: { seconds: bigint; nanos: number } | null;
  valuesJson: string;
}

function isoOf(timestamp: { seconds: bigint; nanos: number } | null | undefined): string {
  if (!timestamp) {
    return new Date(0).toISOString();
  }
  return new Date(Number(timestamp.seconds) * 1000 + Math.floor(timestamp.nanos / 1_000_000)).toISOString();
}

/**
 * A row from the db proxy as clients read it. Cells that are not a string,
 * number or boolean are dropped: the db service never stores one, so one here
 * is a row from a build that broke that rule, not data to pass on.
 */
export function databaseRecordFromWire(wire: DatabaseRecordWire): DatabaseRecord {
  const decoded: unknown = JSON.parse(wire.valuesJson || "{}");
  const values: Record<string, DatabaseValue> = {};
  if (decoded !== null && typeof decoded === "object" && !Array.isArray(decoded)) {
    for (const [id, value] of Object.entries(decoded)) {
      if (typeof value === "string" || typeof value === "number" || typeof value === "boolean") {
        values[id] = value;
      }
    }
  }
  return {
    id: wire.id,
    databaseId: wire.databaseId,
    revision: Number(wire.revision),
    createdAt: isoOf(wire.createdAt),
    updatedAt: isoOf(wire.updatedAt),
    values,
  };
}
