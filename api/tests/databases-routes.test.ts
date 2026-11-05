import { describe, expect, test } from "bun:test";
import { DATABASE_LIMITS, ENGINE_CAPABILITIES } from "@woofx3/api";
import { EngineEventType } from "@woofx3/api/webhooks";
import type * as database_record from "@woofx3/db/database_record.pb";
import { RPC_METHODS } from "../src/api-session";
import { parseDatabaseRecordChanged } from "../src/database-record-handlers";
import { DbError } from "../src/db-client";
import { databasesRoutes } from "../src/routes/databases";

const storedRow: database_record.DatabaseRecord = {
  id: "row-1",
  databaseId: "woofx3:database:games",
  revision: 2n,
  createdAt: { seconds: 1_793_000_000n, nanos: 0 },
  updatedAt: { seconds: 1_793_000_100n, nanos: 0 },
  valuesJson: `{"game":"Celeste","score":12,"won":true}`,
};

/** The routes touch only `db`, so that is all the host needs. */
function call<T>(name: keyof typeof databasesRoutes, db: Record<string, unknown>, ...args: unknown[]): Promise<T> {
  const route = databasesRoutes[name] as unknown as (...args: unknown[]) => Promise<T>;
  return route.call({ db }, ...args);
}

const unreachable = () => {
  throw new Error("an invalid request reached the db");
};

describe("database routes", () => {
  test("are reachable over RPC and gated by a capability", () => {
    for (const method of Object.keys(databasesRoutes)) {
      expect(RPC_METHODS).toContain(method as (typeof RPC_METHODS)[number]);
    }
    expect(ENGINE_CAPABILITIES.databases).toBe("databases.records");
  });

  test("listDatabaseRecords maps the query and the rows", async () => {
    let request: database_record.ListDatabaseRecordsRequest | undefined;
    const page = await call<{ records: unknown[]; total: number }>(
      "listDatabaseRecords",
      {
        listDatabaseRecords: async (req: database_record.ListDatabaseRecordsRequest) => {
          request = req;
          return { records: [storedRow], total: 7n };
        },
      },
      { databaseId: "woofx3:database:games", sortBy: "score", direction: "desc", limit: 50 }
    );
    expect(request).toMatchObject({ sortBy: "score", descending: true, offset: 0, limit: 50 });
    expect(page.total).toBe(7);
    expect(page.records[0]).toEqual({
      id: "row-1",
      databaseId: "woofx3:database:games",
      revision: 2,
      createdAt: new Date(1_793_000_000_000).toISOString(),
      updatedAt: new Date(1_793_000_100_000).toISOString(),
      values: { game: "Celeste", score: 12, won: true },
    });
  });

  test("createdAt sorts by creation time", async () => {
    let request: database_record.ListDatabaseRecordsRequest | undefined;
    await call(
      "listDatabaseRecords",
      {
        listDatabaseRecords: async (req: database_record.ListDatabaseRecordsRequest) => {
          request = req;
          return { records: [], total: 0n };
        },
      },
      { databaseId: "d", sortBy: "createdAt", limit: 1 }
    );
    expect(request?.sortBy).toBe("");
  });

  const invalidQueries: [string, unknown][] = [
    ["no database", { limit: 10 }],
    ["a page over the limit", { databaseId: "d", limit: DATABASE_LIMITS.pageSize + 1 }],
    ["a negative offset", { databaseId: "d", limit: 10, offset: -1 }],
    ["a sort column that is not an id", { databaseId: "d", limit: 10, sortBy: "a b" }],
  ];
  for (const [name, query] of invalidQueries) {
    test(`listDatabaseRecords refuses ${name}`, async () => {
      await expect(call("listDatabaseRecords", { listDatabaseRecords: unreachable }, query)).rejects.toThrow(
        "invalid database request"
      );
    });
  }

  test("createDatabaseRecord sends typed values and answers each outcome", async () => {
    let request: database_record.CreateDatabaseRecordRequest | undefined;
    const created = await call(
      "createDatabaseRecord",
      {
        createDatabaseRecord: async (req: database_record.CreateDatabaseRecordRequest) => {
          request = req;
          return { outcome: "CREATE_DATABASE_RECORD_OUTCOME_CREATED", record: storedRow };
        },
      },
      { databaseId: "d", values: { game: "Celeste", score: 12, vod: null }, insertKey: "k" }
    );
    expect(request?.typedValuesJson).toBe(`{"game":"Celeste","score":12,"vod":null}`);
    expect(request?.insertKey).toBe("k");
    expect(created).toMatchObject({ status: "created", record: { id: "row-1" } });

    const full = await call(
      "createDatabaseRecord",
      { createDatabaseRecord: async () => ({ outcome: "CREATE_DATABASE_RECORD_OUTCOME_FULL" }) },
      { databaseId: "d", values: {} }
    );
    expect(full).toEqual({ status: "full" });

    const duplicate = await call(
      "createDatabaseRecord",
      {
        createDatabaseRecord: async () => ({ outcome: "CREATE_DATABASE_RECORD_OUTCOME_DUPLICATE", record: storedRow }),
      },
      { databaseId: "d", values: {} }
    );
    expect(duplicate).toMatchObject({ status: "duplicate" });
  });

  test("createDatabaseRecord refuses values that cannot be cells", async () => {
    for (const values of [{ game: ["x"] }, { game: { a: 1 } }, { "bad id": "x" }, { n: Number.POSITIVE_INFINITY }]) {
      await expect(
        call("createDatabaseRecord", { createDatabaseRecord: unreachable }, { databaseId: "d", values })
      ).rejects.toThrow("invalid database request");
    }
  });

  test("updateDatabaseRecord answers updated, missing and conflict", async () => {
    let request: database_record.UpdateDatabaseRecordRequest | undefined;
    const updated = await call(
      "updateDatabaseRecord",
      {
        updateDatabaseRecord: async (req: database_record.UpdateDatabaseRecordRequest) => {
          request = req;
          return { updated: true, record: storedRow };
        },
      },
      { databaseId: "d", recordId: "row-1", values: { score: 13 }, expectedRevision: 2 }
    );
    expect(request?.expectedRevision).toBe(2n);
    expect(updated).toMatchObject({ status: "updated", record: { revision: 2 } });

    const missing = await call(
      "updateDatabaseRecord",
      { updateDatabaseRecord: async () => ({ updated: false }) },
      { databaseId: "d", recordId: "row-9", values: {} }
    );
    expect(missing).toEqual({ status: "missing" });

    const conflict = await call(
      "updateDatabaseRecord",
      {
        updateDatabaseRecord: async () => {
          throw new DbError("updateDatabaseRecord", "aborted", "the record changed since it was read");
        },
      },
      { databaseId: "d", recordId: "row-1", values: {}, expectedRevision: 1 }
    );
    expect(conflict).toEqual({ status: "conflict" });
  });

  test("a refused value keeps the db's message, which names the column", async () => {
    await expect(
      call(
        "createDatabaseRecord",
        {
          createDatabaseRecord: async () => {
            throw new DbError("createDatabaseRecord", "invalid_argument", "values Score must be a number");
          },
        },
        { databaseId: "d", values: { score: "x" } }
      )
    ).rejects.toThrow("Score must be a number");
  });

  test("deleteDatabaseRecord and getDatabaseRecord answer a missing row", async () => {
    const deleted = await call<unknown>(
      "deleteDatabaseRecord",
      { deleteDatabaseRecord: async () => false },
      "d",
      "row-1"
    );
    expect(deleted).toEqual({ status: "missing" });
    expect(await call<unknown>("getDatabaseRecord", { getDatabaseRecord: async () => null }, "d", "row-1")).toBeNull();
  });
});

describe("parseDatabaseRecordChanged", () => {
  const data = {
    databaseId: "woofx3:database:games",
    recordId: "row-1",
    op: "created",
    revision: 1,
    createdAt: "2026-11-04T12:00:00Z",
    publicValues: { game: "Celeste" },
  };

  test("projects the outbox row onto the webhook", () => {
    expect(parseDatabaseRecordChanged({ type: "database.record.changed", data })).toEqual({
      type: EngineEventType.DATABASE_RECORD_CHANGED,
      ...data,
      op: "created",
    });
  });

  test("keeps a delete's null values", () => {
    expect(
      parseDatabaseRecordChanged({ data: { ...data, op: "deleted", publicValues: null } })?.publicValues
    ).toBeNull();
  });

  test("drops a row missing what a consumer needs", () => {
    for (const broken of [
      { ...data, recordId: "" },
      { ...data, op: "moved" },
      { ...data, revision: 0 },
      { ...data, publicValues: { game: ["x"] } },
    ]) {
      expect(parseDatabaseRecordChanged({ data: broken })).toBeNull();
    }
  });
});
