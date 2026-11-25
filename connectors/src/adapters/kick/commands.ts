import {
  isKickApiCommand,
  KICKAPI_SUBJECT,
  type KickApiCommand,
  type KickUserInfo,
  type KickUserTarget,
  kickApiResultType,
  type RewardOption,
  type TimeoutResult,
  type UpdateStreamResult,
} from "@woofx3/common/cloudevents/Kick/commands";
import {
  encodePlatformApiError,
  encodePlatformApiReply,
  type PlatformApiReplyCode,
  type PlatformApiReplyDeps,
} from "@woofx3/common/cloudevents/PlatformApi/reply";
import type { Logger } from "../../host/deps";
import type { KickBroadcaster } from "./application";
import {
  describeKickFailure,
  type KickApi,
  type KickApiFailure,
  type KickChannel,
  type KickResult,
} from "./lib/kick-api";
import { kickBan, kickSlugCandidates } from "./lib/moderation";

/** Kick allows at most this many custom tags on a stream. */
export const KICK_MAX_TAGS = 10;

/** One command's outcome: a result for the reply's `data`, or a refusal with its code when it has one. */
export type CommandOutcome =
  | { ok: true; value: unknown }
  | { ok: false; error: string; code: PlatformApiReplyCode | undefined };

type Handler = (api: KickApi, broadcaster: KickBroadcaster, args: Record<string, unknown>) => Promise<CommandOutcome>;

function ok(value: unknown): CommandOutcome {
  return { ok: true, value };
}

function invalid(error: string): CommandOutcome {
  return { ok: false, error, code: "invalid_arguments" };
}

/** The reply code for each Kick error status a caller can act on; others are uncoded. */
const STATUS_CODES: Readonly<Partial<Record<number, PlatformApiReplyCode>>> = {
  400: "invalid_arguments",
  422: "invalid_arguments",
  401: "unauthorized",
  403: "missing_scope",
  429: "rate_limited",
};

/** Kick's refusal with the reply code a caller can act on. */
function failed(failure: KickApiFailure): CommandOutcome {
  const error = describeKickFailure(failure);
  if (failure.kind === "not_linked") {
    return { ok: false, error, code: "not_linked" };
  }
  if (failure.kind !== "http") {
    return { ok: false, error, code: undefined };
  }
  return { ok: false, error, code: STATUS_CODES[failure.status] };
}

function text(value: unknown): string {
  return typeof value === "string" ? value.trim() : "";
}

/** `{ userId }` (digits) or `{ userName }` (a display name or slug), exactly one. */
function target(args: Record<string, unknown>): KickUserTarget | string {
  const userId = text(args.userId);
  const userName = text(args.userName).replace(/^@+/, "");
  if ((userId === "") === (userName === "")) {
    return "name the user by exactly one of userId or userName";
  }
  if (userId !== "") {
    return /^\d+$/.test(userId) ? { userId } : "userId is a Kick user id, digits only";
  }
  return { userName };
}

/** The channel `who` names; null when Kick has none. A name is asked for under each slug it may be. */
async function channelOf(api: KickApi, who: KickUserTarget): Promise<KickResult<KickChannel | null>> {
  if ("userId" in who) {
    const found = await api.channels({ ids: [who.userId] });
    return found.ok ? { ok: true, value: found.value[0] ?? null } : found;
  }
  const candidates = kickSlugCandidates(who.userName);
  const found = await api.channels({ slugs: candidates });
  if (!found.ok) {
    return found;
  }
  const bySlug = new Map(found.value.map((channel) => [channel.slug.toLowerCase(), channel]));
  const match = candidates.map((slug) => bySlug.get(slug)).find((channel) => channel !== undefined);
  return { ok: true, value: match ?? null };
}

const getUser: Handler = async (api, _broadcaster, args) => {
  const who = target(args);
  if (typeof who === "string") {
    return invalid(`getUser: ${who}`);
  }
  const channel = await channelOf(api, who);
  if (!channel.ok) {
    return failed(channel.error);
  }
  if (channel.value === null) {
    return invalid(`getUser: Kick has no channel ${"userId" in who ? who.userId : who.userName}`);
  }
  const users = await api.users([channel.value.broadcasterUserId]);
  if (!users.ok) {
    return failed(users.error);
  }
  const user = users.value[0];
  const { stream } = channel.value;
  const info: KickUserInfo = {
    userId: channel.value.broadcasterUserId,
    login: channel.value.slug,
    displayName: user?.name ?? channel.value.slug,
    description: channel.value.description,
    profileImageUrl: user?.profilePicture ?? "",
    title: channel.value.title,
    categoryId: channel.value.category === null ? "" : String(channel.value.category.id),
    categoryName: channel.value.category?.name ?? "",
    tags: stream.tags,
    language: stream.language ?? "",
    isLive: stream.isLive,
    viewerCount: stream.viewerCount,
    streamStartedAt: stream.startedAt ?? "",
  };
  return ok(info);
};

const updateStream: Handler = async (api, _broadcaster, args) => {
  const title = text(args.title);
  const categoryName = text(args.category);
  if (args.tags !== undefined && !(Array.isArray(args.tags) && args.tags.every((t) => typeof t === "string"))) {
    return invalid("updateStream: tags is a list of strings");
  }
  const tags =
    args.tags === undefined ? undefined : (args.tags as string[]).map((t) => t.trim()).filter((t) => t !== "");
  if (tags !== undefined && tags.length > KICK_MAX_TAGS) {
    return invalid(`updateStream: Kick allows at most ${KICK_MAX_TAGS} tags`);
  }
  if (title === "" && categoryName === "" && tags === undefined) {
    return invalid("updateStream: give a title, a category or tags to change");
  }
  const result: UpdateStreamResult = {};
  let categoryId: number | undefined;
  if (categoryName !== "") {
    const category = await api.findCategory(categoryName);
    if (!category.ok) {
      return failed(category.error);
    }
    if (category.value === null) {
      return invalid(`updateStream: Kick has no category named like ${categoryName}`);
    }
    categoryId = category.value.id;
    result.categoryId = String(category.value.id);
    result.categoryName = category.value.name;
  }
  const updated = await api.updateChannel({
    ...(title === "" ? {} : { title }),
    ...(categoryId === undefined ? {} : { categoryId }),
    ...(tags === undefined ? {} : { tags }),
  });
  if (!updated.ok) {
    return failed(updated.error);
  }
  if (title !== "") {
    result.title = title;
  }
  if (tags !== undefined) {
    result.tags = tags;
  }
  return ok(result);
};

const timeout: Handler = async (api, broadcaster, args) => {
  const who = target(args);
  if (typeof who === "string") {
    return invalid(`timeout: ${who}`);
  }
  const seconds = args.durationSeconds;
  if (typeof seconds !== "number") {
    return invalid("timeout: durationSeconds is a number of seconds");
  }
  const reason = text(args.reason);
  const checked = kickBan(seconds, reason === "" ? undefined : reason);
  if (!checked.ok || checked.durationMinutes === undefined) {
    return invalid(`timeout: ${checked.ok ? "a timeout needs a duration" : checked.error}`);
  }
  const minutes = checked.durationMinutes;
  let userId: string;
  if ("userId" in who) {
    userId = who.userId;
  } else {
    const channel = await channelOf(api, who);
    if (!channel.ok) {
      return failed(channel.error);
    }
    if (channel.value === null) {
      return invalid(`timeout: Kick has no user ${who.userName}`);
    }
    userId = channel.value.broadcasterUserId;
  }
  if (userId === broadcaster.userId) {
    return invalid("timeout: the broadcaster cannot be timed out");
  }
  const banned = await api.ban({
    broadcasterUserId: broadcaster.userId,
    userId,
    durationMinutes: minutes,
    ...(reason === "" ? {} : { reason }),
  });
  if (!banned.ok) {
    return failed(banned.error);
  }
  const applied: TimeoutResult = { userId, durationSeconds: minutes * 60 };
  return ok(applied);
};

const listRewards: Handler = async (api) => {
  const rewards = await api.rewards();
  if (!rewards.ok) {
    return failed(rewards.error);
  }
  const options: RewardOption[] = rewards.value.map((reward) => ({ value: reward.id, label: reward.title }));
  return ok(options);
};

/** The `kickapi` dispatch table: one handler per command. */
export const KICK_API_HANDLERS: Readonly<Record<KickApiCommand, Handler>> = {
  getUser,
  updateStream,
  timeout,
  listRewards,
};

/** A request on `kickapi`: `{ command, args? }`, bare or as a CloudEvent's `data`. */
function readRequest(body: Uint8Array): { command: string; args: Record<string, unknown> } | string {
  let parsed: unknown;
  try {
    parsed = JSON.parse(new TextDecoder().decode(body));
  } catch {
    return "Invalid request payload";
  }
  const isRecord = (value: unknown): value is Record<string, unknown> =>
    typeof value === "object" && value !== null && !Array.isArray(value);
  if (!isRecord(parsed)) {
    return "Missing command";
  }
  const record = typeof parsed.command === "string" ? parsed : isRecord(parsed.data) ? parsed.data : null;
  if (record === null || typeof record.command !== "string" || record.command === "") {
    return "Missing command";
  }
  if (record.args === undefined) {
    return { command: record.command, args: {} };
  }
  if (!isRecord(record.args)) {
    return `${record.command}: args must be an object`;
  }
  return { command: record.command, args: record.args };
}

/** One `kickapi` request, answered in the platform api reply envelope. */
export async function answerKickApiRequest(
  body: Uint8Array,
  run: { api: KickApi; broadcaster: KickBroadcaster },
  deps: PlatformApiReplyDeps & { logger: Logger }
): Promise<Uint8Array> {
  const request = readRequest(body);
  if (typeof request === "string") {
    return encodePlatformApiError(KICKAPI_SUBJECT, request, undefined, deps);
  }
  if (!isKickApiCommand(request.command)) {
    deps.logger.warn("kickapi: unknown command", { command: request.command });
    return encodePlatformApiError(KICKAPI_SUBJECT, `Unknown command: ${request.command}`, undefined, deps);
  }
  const outcome = await KICK_API_HANDLERS[request.command](run.api, run.broadcaster, request.args);
  if (!outcome.ok) {
    deps.logger.warn("kickapi: refused", { command: request.command, err: outcome.error });
    return encodePlatformApiError(KICKAPI_SUBJECT, outcome.error, outcome.code, deps);
  }
  return encodePlatformApiReply(KICKAPI_SUBJECT, kickApiResultType(request.command), outcome.value, deps);
}
