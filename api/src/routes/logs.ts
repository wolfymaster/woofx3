import type { LogAccess, LogAccessScope, LogFileInfo, LogLevel, LogPage, LogQuery } from "@woofx3/api";
import { routeModule } from "./context";

function optionalString(name: string, value: unknown): string | undefined {
  if (value === undefined || value === null) {
    return undefined;
  }
  if (typeof value !== "string") {
    throw new Error(`${name} must be a string`);
  }
  return value;
}

function optionalStrings(name: string, value: unknown): string[] | undefined {
  if (value === undefined || value === null) {
    return undefined;
  }
  if (!Array.isArray(value) || value.some((item) => typeof item !== "string")) {
    throw new Error(`${name} must be a list of strings`);
  }
  return value as string[];
}

/** The query as the contract types it, refusing anything else: it arrives from a client. */
function readLogQuery(raw: unknown): LogQuery {
  if (typeof raw !== "object" || raw === null) {
    throw new Error("query must be an object");
  }
  const fields = raw as Record<string, unknown>;
  const limit = fields.limit;
  if (limit !== undefined && limit !== null && typeof limit !== "number") {
    throw new Error("limit must be a number");
  }
  return {
    levels: optionalStrings("levels", fields.levels) as LogLevel[] | undefined,
    services: optionalStrings("services", fields.services),
    from: optionalString("from", fields.from),
    to: optionalString("to", fields.to),
    text: optionalString("text", fields.text),
    cursor: optionalString("cursor", fields.cursor),
    limit: limit ?? undefined,
  };
}

export const logsRoutes = routeModule({
  async listLogFiles(): Promise<LogFileInfo[]> {
    if (!this.logStore) {
      throw new Error("The log store is unavailable");
    }
    return this.logStore.listFiles();
  },

  async queryLogs(query: LogQuery): Promise<LogPage> {
    if (!this.logStore) {
      throw new Error("The log store is unavailable");
    }
    return this.logStore.query(readLogQuery(query));
  },

  async createLogAccess(scope: LogAccessScope): Promise<LogAccess> {
    if (!this.logAccessTokens) {
      throw new Error("Log access is unavailable");
    }
    return this.logAccessTokens.issue(scope);
  },
});
