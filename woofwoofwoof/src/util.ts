import { HasPermission } from "@woofx3/db/permission.pb";
import type { AuthorizationResponse } from "./commands";

export async function canUse(user: string, cmd: string): Promise<AuthorizationResponse> {
  const hasPermission = await HasPermission(
    {
      username: user.trim().toLowerCase(),
      resource: `command/${cmd}`,
      action: "read",
    },
    {
      baseURL: process.env.DATABASE_PROXY_URL || "",
    }
  );

  return {
    granted: hasPermission.code === "OK",
    message: hasPermission.code === "OK" ? "" : `${user}.... YOU CAN'T DO THAT`,
  };
}

// function that parses string into seconds with format 2m 30s
export function parseTime(duration: string): number {
  // Initialize variables for storing parsed values
  let minutes = 0;
  let seconds = 0;

  // Use a RegExp to match one or more digits before 'm' or 's', optionally followed by spaces.
  const matches = duration.match(/(\d+)\s*[ms]/g);

  if (matches) {
    for (const match of matches) {
      // Get the number part and the unit from each match.
      const num = parseInt(match, 10);
      const unit = match.includes("m") ? "m" : "s";

      // Add to the respective variable based on the unit.
      if (unit === "m") {
        minutes += num;
      } else {
        seconds += num;
      }
    }
  }

  // Convert minutes and seconds to total seconds
  return minutes * 60 + seconds;
}

export function sleep(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
