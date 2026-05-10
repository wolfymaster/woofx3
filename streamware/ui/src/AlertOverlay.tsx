import { useEffect, useMemo, useRef } from "react";
import AlertWrapper from "./components/AlertWrapper";
import DisconnectedBanner from "./components/DisconnectedBanner";
import { useAlertStream } from "./lib/useAlertStream";
import {
  createWidgetHost,
  type StorageChangeStream,
  type WidgetHost,
} from "./lib/widgetHost";
import type { AlertPayload } from "./types";
import { lookupWidget } from "./widgets";

/** System widget identity for the alert overlay. The orchestrator
 *  routes events from this `(moduleId, instanceId, key="alert.lifecycle")`
 *  triple to the alert queue manager; everything else with the same
 *  shape lands in `widget_status`. */
const ALERT_OVERLAY_MODULE_ID = "core";
const ALERT_OVERLAY_INSTANCE_ID = "alert-overlay";

/** No-op storage stream for the alert overlay — it's not a scene
 *  widget, so it has no module-storage subscriptions. */
const NOOP_STREAM: StorageChangeStream = {
  peek: () => undefined,
  subscribe: () => () => {},
};

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
  const { current, dismiss, connected, reportEvent } = useAlertStream(wsUrl);

  // The alert overlay is itself a widget host — it just doesn't load a
  // sandboxed iframe. Constructing a `WidgetHost` here gives the alert
  // lifecycle reporting the same surface scene widgets use
  // (`host.reportStatus(key, value)` over a single inbound channel).
  const host = useMemo<WidgetHost>(
    () => createWidgetHost({
      moduleId: ALERT_OVERLAY_MODULE_ID,
      instanceId: ALERT_OVERLAY_INSTANCE_ID,
      settings: {},
      stream: NOOP_STREAM,
      sendStatus: reportEvent,
    }),
    [reportEvent]
  );

  const lastHeadId = useRef<string | null>(null);
  useEffect(() => {
    const headId = current?.id ?? null;
    if (headId !== lastHeadId.current) {
      console.log("[alert:overlay] head changed", { from: lastHeadId.current, to: headId });
      lastHeadId.current = headId;
    }
  }, [current]);

  return (
    <>
      <DisconnectedBanner connected={connected} />
      {current && (
        <AlertContent
          key={current.id}
          current={current}
          dismiss={dismiss}
          host={host}
        />
      )}
    </>
  );
}

interface AlertContentProps {
  current: AlertPayload;
  dismiss: (id: string) => void;
  host: WidgetHost;
}

function reportLifecycle(
  host: WidgetHost,
  envelopeId: string,
  state: "playing" | "completed" | "failed",
  error?: string
): void {
  host.reportStatus("alert.lifecycle", { envelopeId, state, error });
}

function AlertContent({ current, dismiss, host }: AlertContentProps) {
  // Fire `playing` once per alert envelope. AlertContent re-mounts per
  // `current.id` because of the `key={current.id}` on AlertWrapper —
  // the parent already passes a fresh `current` object.
  useEffect(() => {
    reportLifecycle(host, current.id, "playing");
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [current.id]);

  const widget = lookupWidget(current.parameters.widget);
  if (!widget) {
    console.warn("[alert:overlay] no widget — dropping", {
      id: current.id,
      widget: current.parameters.widget,
    });
    queueMicrotask(() => {
      reportLifecycle(
        host,
        current.id,
        "failed",
        `no widget for "${String(current.parameters.widget ?? "")}"`
      );
      dismiss(current.id);
    });
    return null;
  }

  const rendered = widget.render({
    id: current.id,
    parameters: current.parameters,
    event: current.event,
  });
  console.log("[alert:overlay] render", {
    id: current.id,
    widget: widget.id,
    hasRendered: rendered !== null,
    text: rendered && (Array.isArray(rendered.text) ? rendered.text.length : !!rendered.text),
    mediaUrl: rendered && (Array.isArray(rendered.mediaUrl) ? rendered.mediaUrl.length : !!rendered.mediaUrl),
    audioUrl: rendered && (Array.isArray(rendered.audioUrl) ? rendered.audioUrl.length : !!rendered.audioUrl),
    duration: rendered?.duration,
  });
  if (!rendered) {
    queueMicrotask(() => {
      reportLifecycle(host, current.id, "failed", "widget render returned null");
      dismiss(current.id);
    });
    return null;
  }

  return (
    <AlertWrapper
      key={current.id}
      message={rendered}
      onDone={(result) => {
        reportLifecycle(
          host,
          current.id,
          result.error ? "failed" : "completed",
          result.error ? result.errorMsg : undefined
        );
        dismiss(current.id);
      }}
    />
  );
}
