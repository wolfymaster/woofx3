// The scene editor, end to end, under a seeded deterministic simulation (see
// world.ts). Each seed runs random editing against network cuts, database
// and framing failures, restarts and crashes, then heals and checks that
// every editor converged, nothing was applied twice or lost without being
// reported, and the database holds what the server held.
//
// SIM_SEEDS=n runs n seeds (default 300); SIM_SEED=s replays one seed and
// prints its trace. A failure names its seed.

import { expect, test } from "bun:test";
import { SimulationFailure, World } from "./world";

const SEEDS = Number(process.env.SIM_SEEDS ?? 300);
const ONLY = process.env.SIM_SEED === undefined ? null : Number(process.env.SIM_SEED);
const EVENTS = Number(process.env.SIM_EVENTS ?? 300);
/**
 * Seeds that once found a bug; they always run. 29: rebased text merged
 * character by character instead of last writer wins. 71: a failed write at
 * shutdown was not retried.
 */
const PINNED: number[] = [29, 71];

async function exercise(world: World): Promise<void> {
  await world.runChaos();
  await world.heal(120_000);
  world.checkConverged();
  world.checkTokens();
  world.checkReports();
  await world.checkReload();
  world.checkTokens();
}

test(
  "scene editor simulation",
  async () => {
    const stats = { seeds: 0, steps: 0, graceful: 0, crashes: 0, lossyRebases: 0, historyLost: 0, tokens: 0 };
    const seeds = ONLY !== null ? [ONLY] : [...PINNED, ...Array.from({ length: SEEDS }, (_, i) => i + 1)];
    for (const seed of seeds) {
      const world = new World({
        seed,
        clients: 2 + (seed % 3),
        events: EVENTS,
        traceLines: ONLY === null ? 400 : Number.POSITIVE_INFINITY,
      });
      try {
        await exercise(world);
      } catch (err) {
        const kind = err instanceof SimulationFailure ? "property" : "error";
        console.error(
          `${world.traceTail()}\nscene editor simulation: seed ${seed} failed (${kind}): ${err instanceof Error ? err.stack : String(err)}`
        );
        throw new Error(
          `seed ${seed}: ${err instanceof Error ? err.message : String(err)} (replay with SIM_SEED=${seed})`
        );
      }
      if (ONLY !== null) {
        console.log(world.traceTail());
      }
      stats.seeds++;
      stats.steps += world.scheduler.steps;
      stats.graceful += world.restarts.graceful;
      stats.crashes += world.restarts.crash;
      stats.lossyRebases += world.lossyRebase ? 1 : 0;
      stats.historyLost += world.allReports().filter((report) => report.reason === "history_lost").length;
      stats.tokens += world.committedTokens.size;
    }
    console.log(`scene editor simulation: ${JSON.stringify(stats)}`);
    expect(seeds.length).toBeGreaterThan(0);
  },
  30 * 60 * 1000
);
