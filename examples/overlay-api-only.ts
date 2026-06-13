/**
 * overlay-api-only.ts — API-only overlay flow example (WP-6, AC-3).
 *
 * Demonstrates the full browser-source overlay flow using only the
 * woofx3 Cap'n Web RPC over WebSocket — no Convex, no UI required.
 *
 * Prerequisites:
 *   - The engine (api/) is running at ENGINE_URL (default: http://127.0.0.1:8080)
 *   - The spotify_sr module is installed (or any module with a widget)
 *
 * Usage:
 *   bun run examples/overlay-api-only.ts
 *
 * Environment variables:
 *   ENGINE_URL              Engine base URL (default: http://127.0.0.1:8080)
 *   WOOFX3_CLIENT_ID        Existing client id (skips registerClient if set)
 *   WOOFX3_CLIENT_SECRET    Existing client secret (required if CLIENT_ID set)
 *   WOOFX3_ACCOUNT_ID       Account id for scene creation (required)
 *   WOOFX3_USER_ID          User id to attribute client registration to
 *
 * The script:
 *   1. Registers a client (or reuses CLIENT_ID / CLIENT_SECRET from env)
 *   2. Lists available widgets — finds spotify_sr:widget:now_playing or
 *      falls back to the first available widget
 *   3. Creates a scene with the widget placed at {x:0, y:0, w:400, h:150}
 *   4. Mints an overlay token and prints the browser-source URL
 *   5. Demonstrates token revocation (which blanks the overlay without
 *      deleting the scene)
 *
 * The browser-source URL is routed through the api's /overlay/{token}/
 * proxy — streamware's port is never exposed to the browser directly.
 */

import {
  createEngineGatewaySession,
  createEngineBrowserSession,
  engineApiUrl,
} from "../shared/clients/typescript/api/client";
import type { Woofx3EngineApi } from "../shared/clients/typescript/api/api";
import type { ApiGatewayContract } from "../shared/clients/typescript/api/rpc";

// ---------------------------------------------------------------------------
// Config
// ---------------------------------------------------------------------------

const ENGINE_URL = process.env.ENGINE_URL ?? "http://127.0.0.1:8080";
const CLIENT_ID = process.env.WOOFX3_CLIENT_ID ?? "";
const CLIENT_SECRET = process.env.WOOFX3_CLIENT_SECRET ?? "";
const ACCOUNT_ID = process.env.WOOFX3_ACCOUNT_ID ?? "";
const USER_ID = process.env.WOOFX3_USER_ID ?? "example-user";

// The engine's Api class implements mintOverlayToken / revokeOverlayToken
// but the shared Woofx3EngineApi interface does not yet declare them
// (they post-date the contract). We extend the type locally so this
// script gets full type coverage without modifying shared types.
interface OverlayApi extends Woofx3EngineApi {
  mintOverlayToken(input: {
    sceneId: string;
    label?: string;
  }): Promise<{
    tokenId: string;
    token: string;
    sceneId: string;
    applicationId: string;
    label: string;
    status: string;
    createdAt: string;
    url: string;
  }>;

  revokeOverlayToken(input: {
    tokenId: string;
  }): Promise<{ tokenId: string; status: string }>;
}

// ---------------------------------------------------------------------------
// Step 1: Authenticate (register or reuse credentials)
// ---------------------------------------------------------------------------

async function getCredentials(): Promise<{ clientId: string; clientSecret: string }> {
  if (CLIENT_ID && CLIENT_SECRET) {
    console.log(`[auth] Reusing existing client: ${CLIENT_ID}`);
    return { clientId: CLIENT_ID, clientSecret: CLIENT_SECRET };
  }

  console.log("[auth] Registering new client...");
  const gateway = createEngineGatewaySession(ENGINE_URL);
  const result = await gateway.registerClient("overlay-api-example", { userId: USER_ID });
  console.log(`[auth] Registered client: ${result.clientId}`);
  console.log(
    `       Set WOOFX3_CLIENT_ID=${result.clientId} WOOFX3_CLIENT_SECRET=${result.clientSecret} to reuse.`
  );
  return { clientId: result.clientId, clientSecret: result.clientSecret };
}

// ---------------------------------------------------------------------------
// Step 2: Open a long-lived WebSocket session
//
// HTTP batch sessions (newHttpBatchRpcSession) are consumed on the first
// await — only one call per session. Since this script makes multiple
// sequential API calls we use the WebSocket session which stays alive
// across calls. See shared/clients/typescript/api/client.ts for details.
// ---------------------------------------------------------------------------

function openSession(clientId: string, clientSecret: string): { api: OverlayApi; dispose(): void } {
  const session = createEngineBrowserSession<OverlayApi>(ENGINE_URL, clientId, clientSecret);
  return { api: session.api, dispose: session.dispose };
}

// ---------------------------------------------------------------------------
// Step 3: Find the widget canonical id
//
// widgetCanonicalId format: `{moduleKey}:widget:{manifestId}`
// For spotify_sr's now_playing widget that is:
//   `spotify_sr:widget:now_playing`
// ---------------------------------------------------------------------------

async function findWidget(api: OverlayApi): Promise<{
  widgetCanonicalId: string;
  name: string;
}> {
  const catalog = await api.getAvailableWidgets();
  const widgets = catalog.widgets;

  if (widgets.length === 0) {
    throw new Error(
      "No widgets registered. Install at least one module with a widget " +
        "(e.g. spotify_sr) before running this example."
    );
  }

  // Prefer spotify_sr now_playing; fall back to whatever is first.
  const preferred = widgets.find(
    (w) => w.manifestId === "now_playing" && w.createdByRef?.startsWith("spotify_sr")
  );
  const chosen = preferred ?? widgets[0]!;

  // `createdByRef` is the moduleKey; manifestId is the per-module widget id.
  // Canonical id: `{moduleKey}:widget:{manifestId}` (design §3.1).
  const moduleKey = chosen.createdByRef ?? chosen.createdByType;
  const canonicalId = `${moduleKey}:widget:${chosen.manifestId}`;

  console.log(`[widget] Using widget: ${chosen.name} (${canonicalId})`);
  return { widgetCanonicalId: canonicalId, name: chosen.name };
}

// ---------------------------------------------------------------------------
// Step 4: Create a scene with the widget placed at the given bounds
// ---------------------------------------------------------------------------

async function createSceneWithWidget(
  api: OverlayApi,
  accountId: string,
  widgetCanonicalId: string
): Promise<string> {
  // WidgetInstance shape (shared/clients/typescript/api/api.ts WidgetInstance).
  // We generate a stable but arbitrary instance id; the engine never reads it.
  const instanceId = `widget-${Date.now()}`;

  const widgetInstance = {
    id: instanceId,
    widgetDefinitionRef: widgetCanonicalId,
    label: "now playing",
    position: { x: 0, y: 0 },
    size: { width: 400, height: 150 },
    settings: {},
    zIndex: 0,
    visible: true,
  };

  const result = await api.createScene({
    name: "Overlay Example Scene",
    accountId,
    description: "Created by overlay-api-only.ts example",
    widgetsJson: JSON.stringify([widgetInstance]),
    layoutJson: JSON.stringify({ width: 1920, height: 1080 }),
  });

  console.log(`[scene] Created scene: ${result.id}`);
  return result.id;
}

// ---------------------------------------------------------------------------
// Step 5: Mint an overlay token and print the browser-source URL
// ---------------------------------------------------------------------------

async function mintToken(
  api: OverlayApi,
  sceneId: string
): Promise<{ tokenId: string; url: string }> {
  const result = await api.mintOverlayToken({
    sceneId,
    label: "example-token",
  });

  console.log(`[token] Minted token: ${result.tokenId}`);
  console.log(`[token] Status:       ${result.status}`);
  console.log(`[token] Browser-source URL:`);
  console.log(`          ${result.url}`);
  console.log();
  console.log(
    "  Add this URL as a Browser Source in OBS. The overlay renders through"
  );
  console.log(
    "  the api proxy (/overlay/{token}/) — streamware's port is never exposed."
  );

  return { tokenId: result.tokenId, url: result.url };
}

// ---------------------------------------------------------------------------
// Step 6: Revoke the token (blanks the overlay without deleting the scene)
// ---------------------------------------------------------------------------

async function revokeToken(api: OverlayApi, tokenId: string): Promise<void> {
  const result = await api.revokeOverlayToken({ tokenId });
  console.log(`[token] Revoked token: ${result.tokenId} -> status=${result.status}`);
  console.log(
    "  The overlay is now blank. The scene still exists and a new token can be minted."
  );
}

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------

async function main(): Promise<void> {
  console.log(`woofx3 overlay-api-only example`);
  console.log(`Engine: ${engineApiUrl(ENGINE_URL)}`);
  console.log();

  if (!ACCOUNT_ID) {
    throw new Error(
      "WOOFX3_ACCOUNT_ID is required. " +
        "Set it to an account id that already exists in the engine."
    );
  }

  // Step 1: credentials
  const { clientId, clientSecret } = await getCredentials();

  // Step 2: open long-lived session
  const { api, dispose } = openSession(clientId, clientSecret);

  try {
    // Step 3: verify connectivity
    const ping = await api.ping();
    console.log(`[engine] ping -> ${ping.status} (instance: ${ping.instanceId})`);

    // Step 4: find a widget
    const { widgetCanonicalId } = await findWidget(api);

    // Step 5: create scene
    const sceneId = await createSceneWithWidget(api, ACCOUNT_ID, widgetCanonicalId);

    // Step 6: mint overlay token
    const { tokenId, url } = await mintToken(api, sceneId);

    void url; // The URL has been printed above; no further use in this script.

    // Step 7: demonstrate revocation
    // In production: call this when the stream ends or the operator
    // explicitly invalidates the credential.
    console.log();
    console.log("[demo] Revoking token to demonstrate AC-2 (blanks overlay, scene survives)...");
    await revokeToken(api, tokenId);

    console.log();
    console.log("[done] Full overlay flow complete.");
    console.log(
      `       Scene ${sceneId} still exists — mint a new token any time to restore the overlay.`
    );
  } finally {
    dispose();
  }
}

main().catch((err: unknown) => {
  console.error("[fatal]", err instanceof Error ? err.message : String(err));
  process.exit(1);
});
