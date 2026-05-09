import { useMemo } from "react";
import AlertWrapper from "./components/AlertWrapper";
import DisconnectedBanner from "./components/DisconnectedBanner";
import { useAlertStream } from "./lib/useAlertStream";
import type { AlertPayload } from "./types";
import { lookupWidget } from "./widgets";

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
  const { current, dismiss, connected } = useAlertStream(wsUrl);

  return (
    <>
      <DisconnectedBanner connected={connected} />
      {current && <AlertContent current={current} dismiss={dismiss} />}
    </>
  );
}

interface AlertContentProps {
  current: AlertPayload;
  dismiss: (id: string) => void;
}

function AlertContent({ current, dismiss }: AlertContentProps) {
  const widget = lookupWidget(current.parameters.widget);
  if (!widget) {
    // Post-cutover, every alert MUST go through a widget. Drop with a
    // log so an operator can see the workflow that needs updating, and
    // advance the queue so we don't deadlock on a bad alert at the head.
    console.warn("[AlertOverlay] no widget for alert — dropping", {
      id: current.id,
      widget: current.parameters.widget,
    });
    queueMicrotask(() => dismiss(current.id));
    return null;
  }

  const rendered = widget.render({
    id: current.id,
    parameters: current.parameters,
    event: current.event,
  });
  if (!rendered) {
    // Widget chose not to render (e.g. nothing renderable after substitution).
    queueMicrotask(() => dismiss(current.id));
    return null;
  }

  return <AlertWrapper message={rendered} onDone={() => dismiss(current.id)} />;
}
