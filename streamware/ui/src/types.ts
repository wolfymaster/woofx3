export type OnDoneCallback = (result: TaskCompleted) => void;

export interface TaskCompleted {
  id: string;
  error: boolean;
  errorMsg?: string;
}

export type AlertType = "alert_message" | "play_audio";

/**
 * The over-the-wire alert envelope from the streamware backend.
 *
 * Shape published by the engine's `builtin:action:alert` and forwarded
 * verbatim by the streamware backend. Widget dispatch happens in
 * AlertOverlay; substitution happens inside the chosen widget's render.
 *
 * - `parameters`: workflow-author config; convention requires a `widget`
 *   key naming a registered widget. Other keys are widget-specific.
 * - `event`: originating CloudEvent that triggered the workflow, or
 *   `null` for non-event triggers (manual, scheduled, chat command).
 * - `id`: assigned by the broadcaster if absent; used for queue dismissal.
 */
export interface CloudEventLike {
  id?: string;
  type?: string;
  source?: string;
  time?: string;
  subject?: string;
  data?: Record<string, unknown>;
}

export interface AlertPayload {
  id: string;
  parameters: Record<string, unknown>;
  event: CloudEventLike | null;
}

/**
 * Push payload from the streamware backend's `/ws/module-state` socket.
 *
 * Mirrors the engine's `module.storage.changed` CloudEvent data. Widgets
 * filter on `(moduleId, key)` to ignore writes from modules they don't
 * care about — the backend is a fan-out pipe and doesn't know which
 * client subscribed to what.
 */
export interface StorageChangedPayload {
  id: string;
  moduleId: string;
  key: string;
  value: unknown;
  previousValue?: unknown;
  occurredAt: string;
}

/**
 * Output of `Widget.render` — the renderable shape the existing
 * AlertWrapper / AlertMessage components consume. Used to be the only
 * AlertPayload type; renamed when the widget refactor introduced the
 * envelope above.
 */
export interface LegacyAlertPayload {
  id: string;
  type?: AlertType;
  text?: string | string[];
  mediaUrl?: string | string[];
  audioUrl?: string | string[];
  duration?: number;
  options?: MessageOptions | MessageOptions[];
}

export type MessageOptions = {
  view?: {
    fullScreen?: boolean;
    positionAbsolute?: boolean;
  };
  media?: {
    transparentBlack?: boolean;
    transparentWhite?: boolean;
  };
  animation?: {
    path: (string | number)[];
    value: string;
  };
};
