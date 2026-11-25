import { randomBytes } from "node:crypto";
import type { SharedLogger } from "@woofx3/common/logging";
import { DEFAULT_LOG_ACCESS_TOKENS_CONFIG, LogAccessTokens } from "./LogAccessTokens";
import { DEFAULT_LOGS_HTTP_CONFIG, LogsHttp } from "./LogsHttp";
import { DEFAULT_LOG_STORE_CONFIG, LogStore } from "./LogStore";
import { abortableSleep } from "./abortable-sleep";

const TOKEN_KEY_BYTES = 32;

/** Builds the engine's log store, its access tokens and the HTTP routes that serve them. */
export function createLogs(options: { directory: string; logger: SharedLogger }): {
  store: LogStore;
  tokens: LogAccessTokens;
  http: LogsHttp;
} {
  const store = new LogStore({ ...DEFAULT_LOG_STORE_CONFIG, directory: options.directory });
  const tokens = new LogAccessTokens(randomBytes(TOKEN_KEY_BYTES), Date.now, DEFAULT_LOG_ACCESS_TOKENS_CONFIG);
  const http = new LogsHttp({
    store,
    tokens,
    logger: options.logger,
    config: DEFAULT_LOGS_HTTP_CONFIG,
    now: () => new Date(),
    sleep: abortableSleep,
  });
  return { store, tokens, http };
}
