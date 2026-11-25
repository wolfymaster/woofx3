import { KICK_TOKEN_SUBJECT } from "@woofx3/common/cloudevents/Kick/token";
import { INTEGRATION_TOKEN_UPDATED_SUBJECT } from "@woofx3/common/integrations/integration-settings";
import type { KickConfig } from "../../config/kick";
import type { Adapter, AdapterContext, AdapterManifest, AdapterModule } from "../../host/adapter";
import type { Clock } from "../../host/deps";
import type { LinkState } from "../../host/link-readers";
import KickApplication from "./application";

export interface KickAdapterDeps {
  config: KickConfig;
  clock: Clock;
  fetch: typeof fetch;
}

/**
 * Kick as a host adapter: runs while Kick is linked and enabled. Each start
 * builds a fresh KickApplication, so nothing from an earlier run leaks into
 * the next one.
 */
export class KickAdapter implements Adapter {
  readonly manifest: AdapterManifest;
  private run: KickApplication | undefined;

  constructor(private readonly deps: KickAdapterDeps) {
    this.manifest = {
      id: "kick",
      publishes: [],
      subscribes: [INTEGRATION_TOKEN_UPDATED_SUBJECT],
      requests: [KICK_TOKEN_SUBJECT],
      serves: [],
    };
  }

  desired(link: LinkState): boolean {
    return link.connected && link.enabled;
  }

  async start(ctx: AdapterContext, signal: AbortSignal): Promise<void> {
    if (this.run !== undefined) {
      throw new Error("the kick adapter is already running; the host never starts it twice");
    }
    const run = new KickApplication(this.deps, ctx);
    this.run = run;
    await run.start(signal);
  }

  async stop(): Promise<void> {
    const run = this.run;
    this.run = undefined;
    await run?.stop();
  }

  detail(): Record<string, unknown> {
    const broadcaster = this.run?.broadcaster;
    return { broadcasterId: broadcaster?.userId ?? null, slug: broadcaster?.slug ?? null };
  }
}

/** The registry entry's module: one adapter for the life of the process. */
export function kickAdapterModule(deps: KickAdapterDeps): AdapterModule {
  return { create: () => new KickAdapter(deps) };
}
