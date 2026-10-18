import type { AuthorizationResponse } from "./commands";
import type { DatabaseClient } from "./services/database";

export async function canUse(user: string, cmd: string, db: DatabaseClient): Promise<AuthorizationResponse> {
  const hasPermission = await db.hasPermission({
    username: user.trim().toLowerCase(),
    resource: `command/${cmd}`,
    action: "read",
  });

  return {
    granted: hasPermission.code === "OK",
    message: hasPermission.code === "OK" ? "" : `${user}.... YOU CAN'T DO THAT`,
  };
}

export function sleep(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
