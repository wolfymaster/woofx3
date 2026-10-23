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
