import type { PlatformId } from "@woofx3/api/platform-gateway";

/**
 * Who said a chat line: the platform and that platform's id for the account.
 * Every piece of in-memory per-viewer state is keyed by it. A display name
 * is not an identity: two accounts can show the same one, and a viewer can
 * change theirs mid-stream.
 */
export interface ViewerKey {
  platform: PlatformId;
  platformUserId: string;
}

export function viewerKey(platform: PlatformId, platformUserId: string): ViewerKey {
  if (platformUserId.trim() === "") {
    throw new Error(`a ${platform} viewer needs a non-blank platform user id`);
  }
  return { platform, platformUserId };
}

/** The key as one string, for Map keys. Platform ids contain no ":", so two viewers never share one. */
export function viewerKeyString(key: ViewerKey): string {
  return `${key.platform}:${key.platformUserId}`;
}

/**
 * The name a viewer's permission and group rows are keyed by in db-proxy, per
 * platform. Twitch keeps the bare login, so the rows that existed before any
 * other platform still match. Kick keys by `kick:<user id>`: a Kick account
 * named like a Twitch moderator never inherits that moderator's grants, and a
 * Kick viewer who renames keeps theirs instead of leaving them to whoever
 * takes the old name next. Platform ids contain no ":", so no Twitch login
 * looks prefixed.
 */
const PERMISSION_SUBJECTS: Readonly<Record<PlatformId, (login: string, platformUserId: string) => string>> = {
  twitch: (login) => login,
  kick: (_login, platformUserId) => `kick:${platformUserId}`,
};

export function permissionSubject(platform: PlatformId, login: string, platformUserId: string): string {
  return PERMISSION_SUBJECTS[platform](login, platformUserId);
}
