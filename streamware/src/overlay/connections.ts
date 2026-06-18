import type { ServerWebSocket } from "bun";

export interface OverlayConnectionMeta {
  token: string;
  applicationId: string;
  sceneId: string;
}

export type OverlayConnectionStore = Map<string, Set<ServerWebSocket<OverlayConnectionMeta>>>;
