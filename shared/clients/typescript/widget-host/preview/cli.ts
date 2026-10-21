#!/usr/bin/env bun
// `woofx3-widget-preview [module-dir] [--port N]`: preview a module's widgets
// from its folder, with no engine running.

import { resolve } from "node:path";
import { parseArgs } from "node:util";
import { buildPreviewBundles } from "./bundles";
import { readPreviewModule } from "./module";
import { type PreviewLog, PreviewServer } from "./server";

/** Where the preview listens unless told otherwise: this machine only. */
export const DEFAULT_HOSTNAME = "127.0.0.1";
export const DEFAULT_PORT = 4400;

const USAGE = "usage: woofx3-widget-preview [module-dir] [--port N] [--host ADDRESS]";

const log: PreviewLog = {
  info: (message) => console.log(message),
  warn: (message) => console.warn(`warning: ${message}`),
};

function fail(message: string): never {
  console.error(message);
  process.exit(1);
}

async function main(): Promise<void> {
  const { values, positionals } = parseArgs({
    args: Bun.argv.slice(2),
    options: {
      port: { type: "string" },
      host: { type: "string" },
      help: { type: "boolean", short: "h" },
    },
    allowPositionals: true,
  });
  if (values.help) {
    console.log(USAGE);
    return;
  }
  if (positionals.length > 1) {
    fail(USAGE);
  }
  const port = values.port === undefined ? DEFAULT_PORT : Number(values.port);
  if (!Number.isInteger(port) || port < 0 || port > 65535) {
    fail(`--port must be a port number, got ${values.port}`);
  }
  const moduleDir = resolve(positionals[0] ?? ".");
  const read = await readPreviewModule(moduleDir);
  if (!read.ok) {
    fail(read.error);
  }

  const server = PreviewServer.start({
    moduleDir,
    hostname: values.host ?? DEFAULT_HOSTNAME,
    port,
    bundles: await buildPreviewBundles(),
    log,
  });
  log.info(`previewing ${read.module.name} (${read.module.widgets.length} widgets) at ${server.url}`);

  const stop = (): void => {
    server.stop().then(
      () => process.exit(0),
      (err: unknown) => fail(`stopping the preview failed: ${err instanceof Error ? err.message : err}`)
    );
  };
  process.once("SIGINT", stop);
  process.once("SIGTERM", stop);
}

await main();
