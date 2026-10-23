import type { TwitchApiCommand } from "@woofx3/common/cloudevents/Twitch/commands";
import { z } from "zod";
import type TwitchApi from "./twitch";
import type { TwitchApiCall } from "./twitch";

/**
 * What one `twitchapi` command answered. `invalid_arguments` is args of the
 * wrong shape, refused before the command runs; a refusal from the command
 * itself (Twitch's, or a value out of Twitch's range) is thrown instead.
 */
export type TwitchApiOutcome = { ok: true; value: unknown } | { ok: false; code: "invalid_arguments"; error: string };

/** Runs one command for the dispatcher: checks `args`, then calls the command. */
export type TwitchApiHandler = (api: TwitchApi, args: unknown, call: TwitchApiCall) => Promise<TwitchApiOutcome>;

/**
 * Binds a command to the shape of its args. The schemas check types only;
 * each command still checks the values Twitch would refuse (lengths, ranges,
 * an empty user), with messages in its own words. Unknown fields are dropped
 * rather than refused, so a caller sending a field this version does not know
 * still gets its command run.
 */
function command<Schema extends z.ZodType>(
  schema: Schema,
  run: (api: TwitchApi, args: z.output<Schema>, call: TwitchApiCall) => Promise<unknown>
): TwitchApiHandler {
  return async (api, args, call) => {
    const parsed = schema.safeParse(args);
    if (!parsed.success) {
      return { ok: false, code: "invalid_arguments", error: describeIssues(parsed.error) };
    }
    return { ok: true, value: await run(api, parsed.data, call) };
  };
}

function describeIssues(error: z.ZodError): string {
  return error.issues
    .map((issue) => {
      const path = issue.path.join(".");
      return path ? `${path}: ${issue.message}` : issue.message;
    })
    .join("; ");
}

const noArgs = z.object({});

const userRef = z.object({ userId: z.string().optional(), userName: z.string().optional() });

/**
 * Every `twitchapi` command, keyed by name, so a new command cannot be listed
 * without a handler and a request can only ever reach these.
 */
export const TWITCH_API_HANDLERS: Record<TwitchApiCommand, TwitchApiHandler> = {
  clip: command(noArgs, (api, args) => api.clip(args)),
  listChannelPointRewards: command(noArgs, (api, args) => api.listChannelPointRewards(args)),
  shoutout: command(userRef, (api, args) => api.shoutout(args)),
  addChannelModerator: command(z.object({ userId: z.string() }), (api, args) => api.addChannelModerator(args)),
  timeout: command(userRef.extend({ durationSeconds: z.number(), reason: z.string().optional() }), (api, args) =>
    api.timeout(args)
  ),
  updateStream: command(
    z.object({
      title: z.string().optional(),
      category: z.string().optional(),
      categoryId: z.string().optional(),
      tags: z.array(z.string()).optional(),
    }),
    (api, args) => api.updateStream(args)
  ),
  createMarker: command(z.object({ description: z.string().optional() }), (api, args) => api.createMarker(args)),
  searchCategories: command(z.object({ query: z.string(), first: z.number().optional() }), (api, args) =>
    api.searchCategories(args)
  ),
  getStreamInfo: command(noArgs, (api, args) => api.getStreamInfo(args)),
  getUser: command(userRef, (api, args) => api.getUser(args)),
  getAdSchedule: command(noArgs, (api, args) => api.getAdSchedule(args)),
  snoozeNextAd: command(noArgs, (api, args) => api.snoozeNextAd(args)),
  // Helix's args are checked against the declared operation inside `helix`,
  // which refuses them with `invalid_arguments` in its own words.
  helix: command(z.unknown(), (api, args, call) => api.helix(args, call)),
};
