import { createMessageBus } from "@woofx3/messagebus";

const env = process.env;

function getNATSConfig() {
  const url = env.WOOFX3_MESSAGEBUS_URL ?? env.NATS_URL ?? "tls://connect.ngs.global";
  const jwt = env.WOOFX3_MESSAGEBUS_JWT ?? env.NATS_USER_JWT ?? "";
  const nkeySeed = env.WOOFX3_MESSAGEBUS_NKEY ?? env.NATS_NKEY_SEED ?? "";

  console.log(url, jwt, nkeySeed);

  return {
    name: "BarkLoader",
    url,
    ...(jwt && nkeySeed && { jwt, nkeySeed }),
  };
}

let client: Awaited<ReturnType<typeof createMessageBus>> | null = null;

export default async function getNatsClient() {
  if (client) {
    return client;
  }
  client = await createMessageBus(getNATSConfig(), console);
  await client.connect();
  return client;
}

export function encodePublish(data: unknown): Uint8Array {
  return new TextEncoder().encode(JSON.stringify(data));
}
