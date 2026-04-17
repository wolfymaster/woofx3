import type { AccessTokenWithUserId } from "@twurple/auth";
import fs from "fs/promises";
import type { TwitchContext } from "./types";

export async function getBroadcasterId(ctx: TwitchContext, username: string): Promise<string> {
  ctx.logger.info("getBroadcastId", { username });
  const url = `${ctx.apiUrl}users?login=${username}`;
  const response = await fetch(url, {
    headers: {
      "Client-Id": ctx.clientId,
      Authorization: `Bearer ${ctx.accessToken}`,
    },
  });

  const data = await response.json();

  if (data.error) {
    throw new Error("Received error from twitch api: " + data.message);
  }

  return data.data[0].id;
}

export async function readTokenFromFile(fileName: string): Promise<AccessTokenWithUserId> {
  const contents = await fs.readFile(fileName, { encoding: "utf-8" });
  const token: AccessTokenWithUserId = JSON.parse(contents);
  return token;
}
