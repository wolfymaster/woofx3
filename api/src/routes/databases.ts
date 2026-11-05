import {
  DATABASE_LIMITS,
  DATABASE_SORT_CREATED_AT,
  type DatabaseRecord,
  type DatabaseRecordCreate,
  type DatabaseRecordCreateResult,
  type DatabaseRecordDeleteResult,
  type DatabaseRecordPage,
  type DatabaseRecordsQuery,
  type DatabaseRecordUpdate,
  type DatabaseRecordUpdateResult,
  type DatabaseValue,
} from "@woofx3/api";
import type * as database_record from "@woofx3/db/database_record.pb";
import { z } from "zod";
import { DbError } from "../db-client";
import { routeModule } from "./context";
import { timestampToIso } from "./helpers";

// The db service checks every value against the database's columns; these
// schemas only keep what cannot be a valid request from crossing the boundary.

const databaseId = z.string().min(1).max(255);
const recordId = z.string().min(1).max(64);
const columnId = z.string().regex(/^[A-Za-z0-9_-]{1,64}$/);
const pageLimit = z.number().int().min(1).max(DATABASE_LIMITS.pageSize);
const pageOffset = z.number().int().min(0).max(DATABASE_LIMITS.records);
const cell = z.union([z.string(), z.number().finite(), z.boolean(), z.null()]);
const values = z
  .record(columnId, cell)
  .refine((v) => Object.keys(v).length <= DATABASE_LIMITS.columns, "too many columns");

export const recordsQuerySchema = z.object({
  databaseId,
  sortBy: z.union([z.literal(DATABASE_SORT_CREATED_AT), columnId]).optional(),
  direction: z.enum(["asc", "desc"]).optional(),
  offset: pageOffset.optional(),
  limit: pageLimit,
});

export const recordCreateSchema = z.object({
  databaseId,
  values,
  insertKey: z.string().min(1).max(DATABASE_LIMITS.insertKey).optional(),
});

export const recordUpdateSchema = z.object({
  databaseId,
  recordId,
  values,
  expectedRevision: z.number().int().min(1).optional(),
});

/** Names each problem by path and code only: zod's messages can quote the value, which may be a viewer's text. */
function refusalOf(error: z.ZodError): Error {
  const problems = error.issues.map((issue) => `${issue.path.join(".") || "request"}: ${issue.code}`);
  return new Error(`invalid database request: ${problems.join("; ")}`);
}

function parse<T>(schema: z.ZodType<T>, input: unknown): T {
  const parsed = schema.safeParse(input);
  if (!parsed.success) {
    throw refusalOf(parsed.error);
  }
  return parsed.data;
}

export function recordFromProto(record: database_record.DatabaseRecord): DatabaseRecord {
  const decoded: unknown = JSON.parse(record.valuesJson || "{}");
  const values: Record<string, DatabaseValue> = {};
  if (decoded !== null && typeof decoded === "object" && !Array.isArray(decoded)) {
    for (const [id, value] of Object.entries(decoded)) {
      if (typeof value === "string" || typeof value === "number" || typeof value === "boolean") {
        values[id] = value;
      }
    }
  }
  return {
    id: record.id,
    databaseId: record.databaseId,
    revision: Number(record.revision),
    createdAt: timestampToIso(record.createdAt),
    updatedAt: timestampToIso(record.updatedAt),
    values,
  };
}

function pageFromProto(response: { records: database_record.DatabaseRecord[]; total: bigint }): DatabaseRecordPage {
  return { records: response.records.map(recordFromProto), total: Number(response.total) };
}

/** The stored row of a create that answered with one; every outcome but FULL does. */
function storedRecord(response: database_record.CreateDatabaseRecordResponse): DatabaseRecord {
  if (!response.record) {
    throw new Error(`db.createDatabaseRecord answered ${response.outcome} without the row`);
  }
  return recordFromProto(response.record);
}

export function createResultOf(response: database_record.CreateDatabaseRecordResponse): DatabaseRecordCreateResult {
  switch (response.outcome) {
    case "CREATE_DATABASE_RECORD_OUTCOME_CREATED":
      return { status: "created", record: storedRecord(response) };
    case "CREATE_DATABASE_RECORD_OUTCOME_DUPLICATE":
      return { status: "duplicate", record: storedRecord(response) };
    case "CREATE_DATABASE_RECORD_OUTCOME_FULL":
      return { status: "full" };
    default:
      throw new Error(`db.createDatabaseRecord answered outcome ${response.outcome}`);
  }
}

export const databasesRoutes = routeModule({
  async listDatabaseRecords(query: DatabaseRecordsQuery): Promise<DatabaseRecordPage> {
    const parsed = parse(recordsQuerySchema, query);
    const response = await this.db.listDatabaseRecords({
      databaseId: parsed.databaseId,
      sortBy: parsed.sortBy === undefined || parsed.sortBy === DATABASE_SORT_CREATED_AT ? "" : parsed.sortBy,
      descending: parsed.direction === "desc",
      offset: parsed.offset ?? 0,
      limit: parsed.limit,
    });
    return pageFromProto(response);
  },

  async getDatabaseRecord(database: string, record: string): Promise<DatabaseRecord | null> {
    const found = await this.db.getDatabaseRecord(parse(databaseId, database), parse(recordId, record));
    return found ? recordFromProto(found) : null;
  },

  async createDatabaseRecord(create: DatabaseRecordCreate): Promise<DatabaseRecordCreateResult> {
    const parsed = parse(recordCreateSchema, create);
    const response = await this.db.createDatabaseRecord({
      databaseId: parsed.databaseId,
      typedValuesJson: JSON.stringify(parsed.values),
      insertKey: parsed.insertKey,
    });
    return createResultOf(response);
  },

  async updateDatabaseRecord(update: DatabaseRecordUpdate): Promise<DatabaseRecordUpdateResult> {
    const parsed = parse(recordUpdateSchema, update);
    try {
      const response = await this.db.updateDatabaseRecord({
        databaseId: parsed.databaseId,
        recordId: parsed.recordId,
        typedValuesJson: JSON.stringify(parsed.values),
        expectedRevision: parsed.expectedRevision === undefined ? undefined : BigInt(parsed.expectedRevision),
      });
      if (!response.updated || !response.record) {
        return { status: "missing" };
      }
      return { status: "updated", record: recordFromProto(response.record) };
    } catch (err) {
      if (err instanceof DbError && err.code === "aborted") {
        return { status: "conflict" };
      }
      throw err;
    }
  },

  async deleteDatabaseRecord(database: string, record: string): Promise<DatabaseRecordDeleteResult> {
    const deleted = await this.db.deleteDatabaseRecord(parse(databaseId, database), parse(recordId, record));
    return deleted ? { status: "deleted" } : { status: "missing" };
  },

  async listPublicDatabaseRecords(database: string, offset: number, limit: number): Promise<DatabaseRecordPage> {
    const response = await this.db.listPublicDatabaseRecords({
      databaseId: parse(databaseId, database),
      offset: parse(pageOffset, offset),
      limit: parse(pageLimit, limit),
    });
    return pageFromProto(response);
  },
});
