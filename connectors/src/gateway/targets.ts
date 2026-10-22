import { EgressActionId, type GatewayRequest, type PlatformId, type Target } from "@woofx3/api/platform-gateway";
import type { LinkState } from "../host/link-readers";

/** What resolving a target needs to know about the platforms, at the moment of the request. */
export interface TargetView {
  /** Platforms whose adapter is loaded. */
  readonly platforms: readonly PlatformId[];
  supports(platform: PlatformId, action: EgressActionId): boolean;
  /** The platform's last link state, null before the host first read it. */
  link(platform: PlatformId): LinkState | null;
}

/**
 * The platforms a request goes to (`deliver`) and those reported as
 * `unsupported` without being asked, or why the target is refused.
 */
export type TargetResolution =
  | { ok: true; deliver: PlatformId[]; unsupported: PlatformId[] }
  | { ok: false; problem: string };

/**
 * - all: every linked and enabled platform. Those that cannot perform the
 *   action are reported unsupported; unlinked and disabled ones are left out.
 * - platforms: exactly the named ones. Naming one that cannot perform the
 *   action, or naming one twice, refuses the request: the caller chose it.
 * - origin: the platform the triggering event came from. One that cannot
 *   perform the action is reported unsupported, since the event chose it.
 */
export function resolveTarget(target: Target, action: EgressActionId, view: TargetView): TargetResolution {
  switch (target.kind) {
    case "all": {
      const deliver: PlatformId[] = [];
      const unsupported: PlatformId[] = [];
      for (const platform of view.platforms) {
        const link = view.link(platform);
        if (!(link?.connected && link.enabled)) {
          continue;
        }
        if (view.supports(platform, action)) {
          deliver.push(platform);
        } else {
          unsupported.push(platform);
        }
      }
      return { ok: true, deliver, unsupported };
    }
    case "platforms": {
      const deliver: PlatformId[] = [];
      for (const [index, platform] of target.ids.entries()) {
        if (deliver.includes(platform)) {
          return { ok: false, problem: `target.ids[${index}] names "${platform}" twice` };
        }
        if (!(view.platforms.includes(platform) && view.supports(platform, action))) {
          return { ok: false, problem: `target.ids[${index}]: "${platform}" cannot perform ${action}` };
        }
        deliver.push(platform);
      }
      return { ok: true, deliver, unsupported: [] };
    }
    case "origin": {
      const platform = target.origin.platform;
      if (view.platforms.includes(platform) && view.supports(platform, action)) {
        return { ok: true, deliver: [platform], unsupported: [] };
      }
      return { ok: true, deliver: [], unsupported: [platform] };
    }
  }
}

/**
 * A chat.send answering an origin replies in-thread to the origin's message,
 * unless the payload already names the message to reply to. The origin's
 * channelId is not used: an adapter speaks for one channel.
 */
export function withOriginReply(request: GatewayRequest): GatewayRequest {
  if (request.action !== EgressActionId.CHAT_SEND || request.target.kind !== "origin") {
    return request;
  }
  const messageId = request.target.origin.messageId;
  if (messageId === undefined || request.payload.replyToMessageId !== undefined) {
    return request;
  }
  return { ...request, payload: { ...request.payload, replyToMessageId: messageId } };
}
