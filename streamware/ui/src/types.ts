export type OnDoneCallback = (result: TaskCompleted) => void;

export interface TaskCompleted {
  id: string;
  error: boolean;
  errorMsg?: string;
}

export type AlertType = "alert_message" | "play_audio";

export interface AlertPayload {
  id: string;
  type?: AlertType;
  text?: string;
  mediaUrl?: string | string[];
  audioUrl?: string | string[];
  duration?: number;
  options?: MessageOptions;
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
