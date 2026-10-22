import type { GatewayRequest, PlatformGatewayResult, SendToPlatformsParams } from "@woofx3/api/platform-gateway";
import { routeModule } from "./context";

export const platformRoutes = routeModule({
  /**
   * Send one chat action to the named platforms through the platform
   * gateway. The caller never names who is asking: the request is attributed
   * to the calling session's client id (`context.clientId`).
   */
  async sendToPlatforms(params: SendToPlatformsParams, context?: { clientId: string }): Promise<PlatformGatewayResult> {
    const clientId = context?.clientId;
    if (!clientId) {
      throw new Error("sendToPlatforms needs the session's client id to attribute the request");
    }
    if (typeof params !== "object" || params === null) {
      return { ok: false, code: "invalid", error: "params must be an object" };
    }
    return this.platformGateway.send({
      action: params.action,
      target: { kind: "platforms", ids: params.platforms },
      payload: params.payload,
      options: params.options,
      idempotencyKey: params.idempotencyKey,
      requestedBy: { kind: "api", ref: clientId },
    } as GatewayRequest);
  },
});
