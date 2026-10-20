// @woofx3/module-sdk — types and dev-loop helpers for barkloader modules.
//
// Widget authors (TS or JS-with-JSDoc) import from here:
//   import type { WidgetHost, WidgetEvent } from "@woofx3/module-sdk";
//
// JS function authors reference the ctx surface via a triple-slash:
//   /// <reference types="@woofx3/module-sdk/function-ctx" />
//
// The mock host for unit-testing widgets lives at
// "@woofx3/module-sdk/preview" — see preview/widget-preview.ts.

export type {
  DeliveredWidgetEvent,
  StorageChangeStream,
  StorageChangedFrame,
  WidgetAsset,
  WidgetEvent,
  WidgetEventHandler,
  WidgetEventSource,
  WidgetHost,
  WidgetHostAssets,
  WidgetHostStorage,
  WidgetStatusReport,
  WidgetSurface,
  WidgetTheme,
} from "./widget-host";

export type { EngineAssetPath, WidgetAssetErrorCode } from "./widget-assets";
export {
  ASSET_READ_PREFIX,
  ENGINE_ASSET_PREFIXES,
  WidgetAssetError,
  assetOfReadPath,
  assetReadPath,
  assetRefUrl,
  createWidgetAsset,
  engineAssetPath,
  isWidgetAssetErrorCode,
  parseEngineAssetPath,
  widgetMayRead,
} from "./widget-assets";

export type {
  MockHostController,
  MockHostOptions,
} from "./preview/widget-preview";
export { createMockHost } from "./preview/widget-preview";

// P1 — `woofx3.widget` v1 postMessage protocol (widget <-> scene
// manager). sceneManager's widget bridge consumes the parent-side
// types; the child side ships pre-built as dist/widget-host-shim.iife.js.
export type {
  EventQueueConfig,
  HostToWidgetMessage,
  WidgetAssetErrorMessage,
  WidgetAssetLoadMessage,
  WidgetAssetValueMessage,
  WidgetBootPayload,
  WidgetDisposeMessage,
  WidgetEventCompleteMessage,
  WidgetEventDeliverMessage,
  WidgetEventsSubscribeMessage,
  WidgetEventsUnsubscribeMessage,
  WidgetFonts,
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
  WidgetPlacementBoot,
  WidgetRenderedMessage,
  WidgetSettingsChangedMessage,
  WidgetSettingsReadsMessage,
  WidgetToHostMessage,
  WidgetBehaviorMessage,
  WidgetCapability,
  WidgetMessageBody,
} from "./widget-protocol";
export {
  PROTOCOL_VERSION,
  WIDGET_BOOT_FRAGMENT_PARAM,
  WIDGET_BOOT_GLOBAL,
  WIDGET_CAPABILITIES,
  WIDGET_PROTOCOL,
  decodePlacementBoot,
  encodePlacementBoot,
  isWidgetBootPayload,
  isWidgetCapability,
  isWidgetProtocolEnvelope,
  isWidgetTheme,
  parseHostToWidgetMessage,
  parseWidgetToHostMessage,
} from "./widget-protocol";

export type {
  WidgetBehaviorEasing,
  WidgetBehaviorKindDefinition,
  WidgetBehaviorState,
  WidgetBehaviorType,
  WidgetTransitionPhase,
} from "./widget-behaviors";
export {
  WIDGET_BEHAVIOR_EASINGS,
  WIDGET_BEHAVIOR_KIND,
  WIDGET_BEHAVIOR_TYPES,
  applyWidgetBehavior,
  isWidgetBehaviorState,
} from "./widget-behaviors";

export type { BindingDocument } from "./widget-bindings";
export { applySettingBindings } from "./widget-bindings";

export type { FontDocument, FontLinkElement, FontLoader } from "./widget-fonts";
export { createFontLoader, primaryFontFamily, requestableFontFamily } from "./widget-fonts";

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
