// The `engine.obs.status` reply: how the OBS connection is doing, for the OBS
// module's page. Built from ObsConnection's own state, so it answers without
// touching OBS and is instant whether OBS is up or not.

import type { ObsStatus } from "@woofx3/api";
import type { ObsConnectionState, ObsFailureKind } from "./connection";

/** What the scene manager can say itself; `unanswered` is the api's to report. */
export type ObsStatusReply = Omit<ObsStatus, "state"> & { state: ObsConnectionState };

export interface ObsConnectionView {
  status(): ObsConnectionState;
  lastFailure(): ObsFailureKind | null;
}

/** `host:port` from a connect URL, so the reply never carries anything but where OBS was looked for. */
export function obsAddressOf(url: string): string {
  return url.replace(/^wss?:\/\//, "").replace(/\/+$/, "");
}

export function obsStatusReply(connection: ObsConnectionView, lastUrl: string | null): ObsStatusReply {
  return {
    state: connection.status(),
    failure: connection.lastFailure(),
    address: lastUrl === null ? null : obsAddressOf(lastUrl),
  };
}
