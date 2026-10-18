/**
 * Connects to a live message bus the way the engine's TypeScript services do,
 * once without a token and once with it, and exits non-zero unless only the
 * second is admitted. Run by TestEveryClientAuthenticates in services/nats:
 *
 *   bun test/token-probe.ts <ws-url> <token>
 */
import { wsconnect } from "@nats-io/nats-core";
import NATSClient from "../src/client";

const [url, token] = process.argv.slice(2);
if (!url || !token) {
  console.error("usage: bun test/token-probe.ts <ws-url> <token>");
  process.exit(2);
}

let anonymousAdmitted = false;
try {
  const anonymous = await wsconnect({ servers: url, name: "token-probe-anonymous", reconnect: false });
  anonymousAdmitted = true;
  await anonymous.close();
} catch {
  // Rejected, as it should be.
}
if (anonymousAdmitted) {
  console.error("a client without the token was admitted");
  process.exit(1);
}

const quiet = { info() {}, warn() {}, debug() {}, error: console.error };
const client = new NATSClient({ url, name: "token-probe", token }, quiet);
// connect resolves only once the server has answered the CONNECT, so an
// unaccepted token fails here.
await client.connect();
await client.close();
console.log("ok");
