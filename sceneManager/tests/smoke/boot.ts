// A whole scene manager, started the way server.ts starts one: its own
// composition root, its own HTTP server on a port the OS picks, and a real
// message bus. Only what lies outside the service is stood in for: the db
// proxy (fake-db.ts), barkloader (fake-barkloader.ts) and OBS, which is
// pointed at a port nothing listens on, as on an engine whose OBS is closed.

import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { OPEN_REQUEST_GUARD_POLICY } from "@woofx3/common/http/request-guard";
import SceneManager from "../../src/application";
import type { SceneManagerRuntimeConfig } from "../../src/config";
import { type FakeBarkloader, startFakeBarkloader } from "./fake-barkloader";
import { createFakeDb, type FakeDb } from "./fake-db";

export interface LogLine {
  level: "debug" | "info" | "warn" | "error";
  message: string;
  meta?: unknown;
}

export interface BootedSceneManager {
  baseUrl: string;
  db: FakeDb;
  barkloader: FakeBarkloader;
  logs: LogLine[];
  stop(): Promise<void>;
}

const START_TIMEOUT_MS = 20_000;

/** A start that failed, with what the scene manager logged on the way. */
export class BootFailure extends Error {
  constructor(
    readonly cause: unknown,
    readonly logs: LogLine[]
  ) {
    super(`smoke: the scene manager did not start: ${cause instanceof Error ? cause.message : String(cause)}`);
  }
}

/** `port` 0 (the default) lets the OS choose. */
export async function bootSceneManager(busUrl: string, options: { port?: number } = {}): Promise<BootedSceneManager> {
  const scratch = mkdtempSync(join(tmpdir(), "woofx3-smoke-sm-"));
  const db = createFakeDb();
  const barkloader = startFakeBarkloader();
  const logs: LogLine[] = [];
  const line = (level: LogLine["level"]) => (message: string, meta?: unknown) => {
    logs.push({ level, message, meta });
  };
  const logger = { debug: line("debug"), info: line("info"), warn: line("warn"), error: line("error") };

  const runtimeConfig: SceneManagerRuntimeConfig = {
    port: options.port ?? 0,
    bindHost: "127.0.0.1",
    tokenSecret: "smoke-token-secret-0123456789abcdef",
    rootDir: scratch,
    publicDir: resolve(import.meta.dir, "../../public"),
    fontCacheDir: join(scratch, "fonts"),
    databaseProxyUrl: "http://127.0.0.1:1",
    dbProxyToken: "smoke-db-proxy-token-0123456789abcdef",
    barkloaderUrl: barkloader.url,
    mediaProxySecret: "smoke-media-secret-0123456789abcdef",
    requestGuard: OPEN_REQUEST_GUARD_POLICY,
    obs: { host: "127.0.0.1", port: "1" },
    nats: { url: busUrl, name: "scene-manager-smoke" },
  };
  const app = new SceneManager(runtimeConfig);
  const ctx = {
    runtimeConfig,
    config: { config: {}, getConfig: () => undefined },
    services: { db: { client: db.client } },
    logger,
  } as unknown as Parameters<SceneManager["run"]>[0];

  let failed: unknown = null;
  void app.run(ctx).catch((err) => {
    failed = err;
  });
  const deadline = Date.now() + START_TIMEOUT_MS;
  while (app.listeningPort() === null) {
    if (failed !== null || Date.now() > deadline) {
      const cause = failed ?? new Error("it did not start listening");
      await app.terminate(ctx).catch(() => {});
      barkloader.stop();
      rmSync(scratch, { recursive: true, force: true });
      throw new BootFailure(cause, logs);
    }
    await Bun.sleep(20);
  }

  return {
    baseUrl: `http://127.0.0.1:${app.listeningPort()}`,
    db,
    barkloader,
    logs,
    async stop() {
      await app.terminate(ctx);
      barkloader.stop();
      rmSync(scratch, { recursive: true, force: true });
    },
  };
}
