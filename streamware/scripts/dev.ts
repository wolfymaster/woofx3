/**
 * Dev orchestrator: spawns the Bun backend (--watch) and Vite in
 * parallel, prefixes each output line, and forwards SIGINT/SIGTERM to
 * each child's whole process group so vite + its esbuild helper exit
 * cleanly on Ctrl-C.
 */
import { spawn, spawnSync, type ChildProcessWithoutNullStreams } from "node:child_process";

interface Child {
  name: string;
  prefix: string;
  proc: ChildProcessWithoutNullStreams;
  pgid: number;
}

const RESET = "\x1b[0m";

function tag(name: string, color: string): string {
  return `${color}[${name}]${RESET}`;
}

function pipe(stream: NodeJS.ReadableStream, prefix: string): void {
  let buf = "";
  stream.setEncoding("utf8");
  stream.on("data", (chunk: string) => {
    buf += chunk;
    let idx = buf.indexOf("\n");
    while (idx !== -1) {
      process.stdout.write(`${prefix} ${buf.slice(0, idx)}\n`);
      buf = buf.slice(idx + 1);
      idx = buf.indexOf("\n");
    }
  });
  stream.on("end", () => {
    if (buf.length > 0) {
      process.stdout.write(`${prefix} ${buf}\n`);
    }
  });
}

function start(name: string, color: string, cmd: string[], cwd: string): Child {
  const proc = spawn(cmd[0], cmd.slice(1), {
    cwd,
    detached: true, // Make this child its own process-group leader.
    stdio: ["ignore", "pipe", "pipe"],
    env: { ...process.env, FORCE_COLOR: "1" },
  }) as ChildProcessWithoutNullStreams;
  const prefix = tag(name, color);
  pipe(proc.stdout, prefix);
  pipe(proc.stderr, prefix);
  proc.on("error", (err) => {
    process.stdout.write(`${prefix} spawn error: ${err.message}\n`);
  });
  return { name, prefix, proc, pgid: proc.pid! };
}

const here = import.meta.dir;
const repoRoot = `${here}/..`;
const viteBin = `${repoRoot}/ui/node_modules/vite/bin/vite.js`;

const children: Child[] = [
  // Bun runs the server directly with --watch (no `run` wrapper).
  start("server", "\x1b[36m", ["bun", "--watch", "src/server.ts"], repoRoot),
  // Vite is invoked via node directly (no `bunx` wrapper) so the
  // process tree stays flat and the whole vite+esbuild group is killed
  // together when we signal the child's pgid on shutdown.
  start("ui    ", "\x1b[35m", ["node", viteBin], `${repoRoot}/ui`),
];

let shuttingDown = false;
/**
 * Send `signal` to process group `pgid`. Bun's `process.kill` rejects
 * negative pids, so we shell out to `/bin/kill` which natively
 * understands the POSIX `-PGID` process-group convention.
 */
function killPgrp(pgid: number, signal: NodeJS.Signals): boolean {
  const result = spawnSync("kill", [`-${signal}`, `-${pgid}`], { stdio: "ignore" });
  return result.status === 0;
}

function shutdown(signal: NodeJS.Signals): void {
  if (shuttingDown) {
    return;
  }
  shuttingDown = true;
  for (const c of children) {
    if (!killPgrp(c.pgid, signal)) {
      try {
        c.proc.kill(signal);
      } catch {
        // already gone
      }
    }
  }
  // Backstop: force-kill anything still alive after a grace period.
  setTimeout(() => {
    for (const c of children) {
      killPgrp(c.pgid, "SIGKILL");
    }
  }, 3_000).unref();
}

process.on("SIGINT", () => shutdown("SIGINT"));
process.on("SIGTERM", () => shutdown("SIGTERM"));

const exits = await Promise.all(
  children.map(
    (c) =>
      new Promise<{ name: string; code: number | null; signal: NodeJS.Signals | null }>((resolve) => {
        c.proc.on("exit", (code, signal) => {
          resolve({ name: c.name.trim(), code, signal });
        });
      }),
  ),
);

const summary = exits.map((e) => `${e.name}=${e.code ?? e.signal ?? "?"}`).join(", ");
console.log(`\n[dev] all processes exited (${summary})`);
process.exit(0);
