#!/usr/bin/env bun
/**
 * Drives a running engine through its single public port: everything a
 * deployed engine has to serve on one origin, plus the registration token
 * that stops a public engine being claimed by whoever finds it.
 *
 * Run by .github/scripts/engine-image-check.sh, which starts the container
 * and sets the environment below. Standalone against any engine:
 *
 *   BASE_URL=http://127.0.0.1:8080 REGISTRATION_TOKEN=… EXPECTED_VERSION=… \
 *     bun .github/scripts/engine-edge-check.ts
 *
 * Every check prints "ok" or "FAIL" with its name; the exit code is non-zero
 * if any failed.
 */
import type { Woofx3EngineApi } from "../../shared/clients/typescript/api/api";
import {
  createEngineBrowserSession,
  createEngineGatewaySession,
  createEngineSession,
} from "../../shared/clients/typescript/api/client";

const BASE_URL = required("BASE_URL");
const REGISTRATION_TOKEN = required("REGISTRATION_TOKEN");
const EXPECTED_VERSION = process.env.EXPECTED_VERSION ?? "ci";
const SSE_HOLD_SECONDS = Number(process.env.SSE_HOLD_SECONDS ?? "70");

function required(name: string): string {
  const value = process.env[name];
  if (!value) {
    console.error(`engine-edge-check: ${name} is required`);
    process.exit(2);
  }
  return value;
}

let failures = 0;

async function check(name: string, run: () => Promise<void>): Promise<void> {
  try {
    await run();
    console.log(`  ok    ${name}`);
  } catch (err) {
    failures++;
    console.error(`  FAIL  ${name}`);
    console.error(`        ${err instanceof Error ? err.message : String(err)}`);
  }
}

function assert(condition: unknown, message: string): asserts condition {
  if (!condition) {
    throw new Error(message);
  }
}

function assertEqual(actual: unknown, expected: unknown, what: string): void {
  assert(actual === expected, `${what}: expected ${JSON.stringify(expected)}, got ${JSON.stringify(actual)}`);
}

/** The error a refused registration rejects with; see REGISTRATION_REFUSED. */
function isRefusal(err: unknown): boolean {
  const name = (err as { name?: string } | null)?.name ?? "";
  const message = err instanceof Error ? err.message : String(err);
  return name === "RegistrationRefused" || /registration token/i.test(message);
}

// --- the gateway, on /api through the edge --------------------------------

await check("capnweb HTTP batch: gateway.ping() on /api", async () => {
  const { status } = await createEngineGatewaySession(BASE_URL).ping();
  assertEqual(status, "ok", "ping status");
});

await check("registerClient is refused without the registration token", async () => {
  const refused = await createEngineGatewaySession(BASE_URL)
    .registerClient("engine-image-check", { userId: "check-user" })
    .then(
      () => null,
      (err: unknown) => err
    );
  assert(refused !== null, "registration succeeded without a token");
  assert(isRefusal(refused), `expected a refusal, got: ${refused}`);
});

await check("registerClient is refused with the wrong registration token", async () => {
  const refused = await createEngineGatewaySession(BASE_URL)
    .registerClient("engine-image-check", { userId: "check-user", registrationToken: "not-the-token" })
    .then(
      () => null,
      (err: unknown) => err
    );
  assert(refused !== null, "registration succeeded with a wrong token");
  assert(isRefusal(refused), `expected a refusal, got: ${refused}`);
});

let credentials: { clientId: string; clientSecret: string; applicationId: string } | null = null;

await check("registerClient succeeds with the registration token", async () => {
  credentials = await createEngineGatewaySession(BASE_URL).registerClient("engine-image-check", {
    userId: "check-user",
    registrationToken: REGISTRATION_TOKEN,
  });
  assert(credentials.clientId.length > 0, "no clientId returned");
  assert(credentials.clientSecret.length > 0, "no clientSecret returned");
  assert(credentials.applicationId.length > 0, "no applicationId returned");
});

if (credentials === null) {
  console.error("engine-edge-check: cannot continue without client credentials");
  process.exit(1);
}
const { clientId, clientSecret } = credentials;

/** A fresh authenticated session: an HTTP batch is consumed by one call. */
function api(): Woofx3EngineApi {
  return createEngineSession<Woofx3EngineApi>(BASE_URL, clientId, clientSecret);
}

await check("the engine reports the version it was built with", async () => {
  const info = await api().getEngineInfo();
  assertEqual(info.version, EXPECTED_VERSION, "getEngineInfo version");
});

await check("capnweb WebSocket: an authenticated call on /api", async () => {
  const session = createEngineBrowserSession<Woofx3EngineApi>(BASE_URL, clientId, clientSecret);
  try {
    const info = await session.api.getEngineInfo();
    assert(typeof info.overlayPublicUrl === "string", "no overlayPublicUrl over the WebSocket");
  } finally {
    session.dispose();
  }
});

// --- sceneManager, on everything that is not /api -------------------------

await check("sceneManager answers /health through the edge", async () => {
  const response = await fetch(`${BASE_URL}/health`);
  assertEqual(response.status, 200, "GET /health status");
});

await check("sceneManager serves its own static files through the edge", async () => {
  const response = await fetch(`${BASE_URL}/assets/widget-host-shim.js`);
  assertEqual(response.status, 200, "GET /assets/widget-host-shim.js status");
});

let overlay: { sceneId: string; url: string } | null = null;

await check("an overlay page renders through the edge", async () => {
  const scene = await api().createScene({ name: `image-check-${Date.now()}` });
  const minted = await api().mintOverlayToken({ sceneId: scene.id });
  const response = await fetch(minted.url, { redirect: "manual" });
  assertEqual(response.status, 200, `GET ${minted.url} status`);
  const body = await response.text();
  assert(body.includes("<!doctype html") || body.includes("<!DOCTYPE html"), "the overlay page is not HTML");
  assert(response.headers.get("set-cookie") !== null, "the overlay page minted no session cookie");
  overlay = { sceneId: scene.id, url: minted.url };
});

await check(`the SSE stream stays open past ${SSE_HOLD_SECONDS}s`, async () => {
  assert(overlay !== null, "no overlay page to stream events for");
  // The stream is authorized by the session cookie the overlay page set.
  const page = await fetch(overlay.url, { redirect: "manual" });
  const cookie = (page.headers.get("set-cookie") ?? "").split(";")[0] ?? "";
  assert(cookie.length > 0, "no session cookie to open the stream with");

  const response = await fetch(`${BASE_URL}/scene/${overlay.sceneId}/events`, { headers: { cookie } });
  assertEqual(response.status, 200, "GET /scene/{id}/events status");
  assert(response.body !== null, "the event stream has no body");

  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  const first = await reader.read();
  assert(!first.done, "the event stream closed immediately");
  assert(decoder.decode(first.value).includes("event: hello"), "the stream did not open with its hello event");

  // Read until the hold elapses. A stream that is buffered or reaped
  // somewhere on the path ends early; one that is fine keeps delivering
  // heartbeat comments.
  const deadline = Date.now() + SSE_HOLD_SECONDS * 1000;
  let heartbeats = 0;
  while (Date.now() < deadline) {
    const timeout = Math.max(1000, deadline - Date.now());
    const next = await Promise.race([
      reader.read(),
      new Promise<{ done: boolean; value?: Uint8Array }>((resolve) =>
        setTimeout(() => resolve({ done: false, value: undefined }), timeout)
      ),
    ]);
    assert(!next.done, `the event stream closed after ${SSE_HOLD_SECONDS}s had not yet elapsed`);
    if (next.value && decoder.decode(next.value).includes(":")) {
      heartbeats++;
    }
  }
  await reader.cancel();
  assert(heartbeats > 0, "the stream sent no heartbeat while it was held open");
});

// --- an upload, through the edge and back ---------------------------------

await check("an asset uploads through the edge and is served back", async () => {
  const bytes = new TextEncoder().encode(`engine-image-check ${new Date().toISOString()}`);
  const grant = await api().requestUploadUrl({
    name: `image-check-${Date.now()}.txt`,
    contentType: "text/plain",
    size: bytes.byteLength,
  });
  assert(grant.uploadUrl.length > 0, "no upload url in the grant");

  const headers = new Headers();
  for (const header of grant.headers) {
    headers.set(header.name, header.value);
  }
  const upload = await fetch(grant.uploadUrl, { method: grant.method, headers, body: bytes });
  assert(upload.ok, `PUT ${grant.uploadUrl} answered ${upload.status}: ${await upload.text()}`);

  const resource = await api().completeUpload(grant.resource.id, bytes.byteLength);
  assertEqual(resource.status, "ready", "resource status after completeUpload");
  assert(resource.url !== null, "a ready resource has no url");

  const served = await fetch(resource.url, { redirect: "follow" });
  assertEqual(served.status, 200, `GET ${resource.url} status`);
  assertEqual(await served.text(), new TextDecoder().decode(bytes), "the served bytes");
});

if (failures > 0) {
  console.error(`engine-edge-check: ${failures} check(s) failed`);
  process.exit(1);
}
console.log("engine-edge-check: every check passed");
