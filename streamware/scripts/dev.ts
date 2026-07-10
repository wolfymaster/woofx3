/**
 * Dev orchestrator: spawns the Bun backend (--watch) and Vite's
 * production-build watcher in parallel, prefixes each output line, and
 * forwards SIGINT/SIGTERM to each child's whole process group so vite +
 * its esbuild helper exit cleanly on Ctrl-C.
 *
 * Note: streamware's HTTP server (port 9101) serves the prebuilt
 * `ui/dist` directory — not the vite dev server. Running `vite build
 * --watch` rebuilds `ui/dist` on every edit under `ui/src` so changes
 * land in the same path OBS / browser sources load from. Use a separate
 * `bun run dev:ui` (vite dev server on 5173) if you want HMR previews
 * outside the overlay flow.
 */
import { spawn, type ChildProcessWithoutNullStreams } from "node:child_process";

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
  // `vite build --watch` rebuilds ui/dist on file changes so the
  // streamware HTTP server (which serves dist/) always picks up edits.
  // Invoked via node directly (no `bunx` wrapper) so the process tree
  // stays flat and the whole vite+esbuild group is killed together when
  // we signal the child's pgid on shutdown.
  start("ui    ", "\x1b[35m", ["node", viteBin, "build", "--watch"], `${repoRoot}/ui`),
];

let shuttingDown = false;
let forceKillTimer: ReturnType<typeof setTimeout> | undefined;

/**
 * Send `signal` to process group `pgid` via the POSIX `-PGID` convention
 * (negating the pid tells `process.kill` to target the whole group).
 */
function killPgrp(pgid: number, signal: NodeJS.Signals): boolean {
  try {
    process.kill(-pgid, signal);
    return true;
  } catch (err) {
    const code = (err as NodeJS.ErrnoException).code;
    if (code === "ESRCH") {
      // Group is already gone.
      return true;
    }
    process.stdout.write(`[dev] failed to send ${signal} to process group ${pgid}: ${(err as Error).message}\n`);
    return false;
  }
}

function killAll(signal: NodeJS.Signals): void {
  for (const c of children) {
    if (!killPgrp(c.pgid, signal)) {
      try {
        c.proc.kill(signal);
      } catch {
        // already gone
      }
    }
  }
}

function shutdown(signal: NodeJS.Signals): void {
  if (shuttingDown) {
    // The graceful attempt didn't finish the job — a repeat signal means
    // don't wait around, force it.
    process.stdout.write(`[dev] received ${signal} while already shutting down, forcing SIGKILL\n`);
    clearTimeout(forceKillTimer);
    killAll("SIGKILL");
    return;
  }
  shuttingDown = true;
  killAll(signal);
  // Backstop: force-kill anything still alive after a grace period.
  forceKillTimer = setTimeout(() => {
    killAll("SIGKILL");
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
