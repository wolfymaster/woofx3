// The engine's real message bus (services/nats, an embedded nats-server) on
// free ports in a scratch directory. It is a Go program: the binary named by
// WOOFX3_MESSAGEBUS_BIN is used when set (CI builds one), otherwise it is
// built with `go build` when Go is on the PATH. Without either the bus cannot
// run, and `startMessageBus` says why instead of starting it.

import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";

export interface MessageBus {
  /** The WebSocket URL a client connects to. */
  url: string;
  stop(): Promise<void>;
}

export type MessageBusStart = { ok: true; bus: MessageBus } | { ok: false; reason: string };

const SERVICE_DIR = resolve(import.meta.dir, "../../../services/nats");
const READY_TIMEOUT_MS = 30_000;

function freePort(): number {
  const listener = Bun.listen({ hostname: "127.0.0.1", port: 0, socket: { data() {} } });
  const port = listener.port;
  listener.stop(true);
  return port;
}

async function binary(scratch: string): Promise<string | { reason: string }> {
  const given = process.env.WOOFX3_MESSAGEBUS_BIN;
  if (given) {
    return given;
  }
  if (Bun.which("go") === null) {
    return { reason: "WOOFX3_MESSAGEBUS_BIN is unset and Go is not on the PATH" };
  }
  const out = join(scratch, "messagebus");
  const build = Bun.spawn(["go", "build", "-o", out, "."], { cwd: SERVICE_DIR, stdout: "pipe", stderr: "pipe" });
  if ((await build.exited) !== 0) {
    return { reason: `go build failed: ${await new Response(build.stderr).text()}` };
  }
  return out;
}

async function listening(port: number): Promise<boolean> {
  try {
    const conn = await Bun.connect({ hostname: "127.0.0.1", port, socket: { data() {} } });
    conn.end();
    return true;
  } catch {
    return false;
  }
}

export async function startMessageBus(): Promise<MessageBusStart> {
  const scratch = mkdtempSync(join(tmpdir(), "woofx3-smoke-bus-"));
  const bin = await binary(scratch);
  if (typeof bin !== "string") {
    rmSync(scratch, { recursive: true, force: true });
    return { ok: false, reason: bin.reason };
  }
  // An empty config keeps the bus from reading the checkout's .woofx3.json.
  const conf = join(scratch, ".woofx3.json");
  writeFileSync(conf, "{}");
  const wsPort = freePort();
  let proc: Bun.Subprocess<"ignore", "ignore", "pipe">;
  try {
    proc = Bun.spawn([bin, "-conf", conf], {
      cwd: scratch,
      env: {
        ...process.env,
        ROOT_PATH: scratch,
        WOOFX3_MESSAGEBUS_HOST: "127.0.0.1",
        WOOFX3_MESSAGEBUS_SERVER_LISTENING_PORT: "-1",
        WOOFX3_MESSAGEBUS_WEBSOCKET_PORT: String(wsPort),
      },
      stdout: "ignore",
      stderr: "pipe",
    });
  } catch (err) {
    rmSync(scratch, { recursive: true, force: true });
    return {
      ok: false,
      reason: `the message bus could not be started: ${err instanceof Error ? err.message : String(err)}`,
    };
  }
  const stop = async () => {
    proc.kill("SIGTERM");
    await proc.exited;
    rmSync(scratch, { recursive: true, force: true });
  };
  const deadline = Date.now() + READY_TIMEOUT_MS;
  while (!(await listening(wsPort))) {
    if (proc.exitCode !== null || Date.now() > deadline) {
      const stderr = await new Response(proc.stderr).text().catch(() => "");
      await stop();
      return { ok: false, reason: `the message bus did not start: ${stderr.slice(0, 500)}` };
    }
    await Bun.sleep(50);
  }
  // The port was free when chosen, not reserved: whatever answers must be
  // the bus, which is still running.
  if (proc.exitCode !== null) {
    await stop();
    return { ok: false, reason: `port ${wsPort} answered, but the message bus had exited` };
  }
  return { ok: true, bus: { url: `ws://127.0.0.1:${wsPort}`, stop } };
}
