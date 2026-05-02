import { useMemo } from "react";
import AlertAudio from "./components/AlertAudio";
import AlertWrapper from "./components/AlertWrapper";
import { useAlertStream } from "./lib/useAlertStream";

function resolveWsUrl(): string {
  const fromEnv = import.meta.env.VITE_STREAMWARE_WS_URL as string | undefined;
  if (fromEnv) {
    return fromEnv;
  }
  const proto = location.protocol === "https:" ? "wss:" : "ws:";
  return `${proto}//${location.host}/ws/alerts`;
}

export default function AlertOverlay() {
  const wsUrl = useMemo(resolveWsUrl, []);
  const { current, dismiss } = useAlertStream(wsUrl);

  if (!current) {
    return null;
  }

  if (current.type === "play_audio") {
    const url = Array.isArray(current.audioUrl) ? current.audioUrl[0] : current.audioUrl ?? "";
    return (
      <AlertAudio
        id={current.id}
        url={url}
        duration={current.duration}
        onDone={() => dismiss(current.id)}
      />
    );
  }

  return <AlertWrapper message={current} onDone={() => dismiss(current.id)} />;
}
