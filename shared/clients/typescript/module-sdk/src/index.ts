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
