// @woofx3/module-sdk — types and dev-loop helpers for barkloader modules.
//
// Widget authors (TS or JS-with-JSDoc) import from here:
//   import type { WidgetHost, WidgetEvent } from "@woofx3/module-sdk";
//
// JS function authors reference the ctx surface via a triple-slash:
//   /// <reference types="@woofx3/module-sdk/function-ctx" />
//
// The widget preview helper (mock host for offline development) lives
// at "@woofx3/module-sdk/preview" — see preview/widget-preview.ts.

export type {
  StorageChangeStream,
  StorageChangedFrame,
  WidgetEvent,
  WidgetEventHandler,
  WidgetEventSource,
  WidgetHost,
  WidgetHostStorage,
  WidgetStatusReport,
} from "./widget-host";

export type {
  MockHostController,
  MockHostOptions,
} from "./preview/widget-preview";
export { createMockHost } from "./preview/widget-preview";

// P1 — `woofx3.widget` v1 postMessage protocol (widget <-> scene
// manager). Streamware's widget bridge consumes the parent-side
// types; the child side ships pre-built as dist/widget-host-shim.js.
export type {
  HostToWidgetMessage,
  WidgetBootPayload,
  WidgetDisposeMessage,
  WidgetEventDeliverMessage,
  WidgetEventsSubscribeMessage,
  WidgetEventsUnsubscribeMessage,
  WidgetHelloMessage,
  WidgetInitMessage,
  WidgetInitRejectMessage,
  WidgetPingMessage,
  WidgetPongMessage,
  WidgetProtocolEnvelope,
  WidgetProtocolMessage,
  WidgetProtocolName,
  WidgetProtocolVersion,
  WidgetStatusReportMessage,
  WidgetStorageChangedMessage,
  WidgetStorageGetMessage,
  WidgetStorageSubscribeMessage,
  WidgetStorageUnsubscribeMessage,
  WidgetStorageValueMessage,
  WidgetToHostMessage,
} from "./widget-protocol";
export {
  PROTOCOL_VERSION,
  WIDGET_BOOT_GLOBAL,
  WIDGET_PROTOCOL,
  isWidgetBootPayload,
  isWidgetProtocolEnvelope,
} from "./widget-protocol";

export type {
  InstallWidgetHostShimOptions,
  ShimMessageEvent,
  ShimParentWindow,
  ShimWindow,
} from "./widget-host-shim";
export {
  HELLO_RETRY_INTERVAL_MS,
  SDK_VERSION,
  installWidgetHostShim,
} from "./widget-host-shim";
