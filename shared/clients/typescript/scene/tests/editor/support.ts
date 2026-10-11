// Fixtures for the editor tests. Not exported from the package: only tests import it.

import { type CatalogWidget, type CompositionEditor, createCompositionEditor, LocalDocumentSource } from "../../editor";
import { type CompositionDocument, type CompositionProfile, type PlacementDocument, PROFILES } from "../../model";

export const TEXT = "woofx3:widget:text";
export const IMAGE = "woofx3:widget:image";
export const VIDEO = "woofx3:widget:video";
export const AUDIO = "woofx3:widget:audio";
export const ALERT_AREA = "woofx3:widget:alert";
export const CLOCK = "example:widget:clock";

export const CATALOG: CatalogWidget[] = [
  {
    widgetId: TEXT,
    name: "Text",
    settings: [{ id: "font", defaultValue: "Inter" }],
    surfaces: ["scene", "alert"],
  },
  { widgetId: IMAGE, name: "Image", settings: [{ id: "src" }], surfaces: ["alert"] },
  { widgetId: VIDEO, name: "Video", settings: [{ id: "src" }], surfaces: ["alert"] },
  { widgetId: AUDIO, name: "Audio", settings: [{ id: "src" }], surfaces: ["alert"] },
  { widgetId: ALERT_AREA, name: "Alert", settings: [{ id: "name", defaultValue: "" }], hostsSurface: "alert" },
  { widgetId: CLOCK, name: "Clock", settings: [{ id: "format", defaultValue: "HH:mm" }] },
];

export function placement(overrides: Partial<PlacementDocument> = {}): PlacementDocument {
  return {
    widget: CLOCK,
    x: 0,
    y: 0,
    width: 100,
    height: 100,
    visible: true,
    z: "a0001",
    settings: {},
    name: "",
    rotation: 0,
    opacity: 1,
    locked: false,
    extra: {},
    ...overrides,
  };
}

export function composition(widgets: Record<string, PlacementDocument> = {}): CompositionDocument {
  return { layout: { width: 1920, height: 1080 }, widgets, behaviors: {} };
}

/** A local source that counts the changes it is asked to apply. */
export class CountingSource extends LocalDocumentSource {
  applies = 0;

  override apply(update: (doc: CompositionDocument) => CompositionDocument) {
    this.applies++;
    return super.apply(update);
  }
}

/** A clock for coalescing: moves only when told. */
export class TestClock {
  time = 1_000;

  now = (): number => this.time;
}

export interface Harness {
  editor: CompositionEditor;
  source: CountingSource;
  clock: TestClock;
}

/**
 * An editor on a local source, zoom 1 at origin 0,0 so screen and canvas
 * points coincide, with sequential ids.
 */
export function harness(
  doc: CompositionDocument = composition(),
  profile: CompositionProfile = PROFILES.scene,
  options: { readOnly?: boolean } = {}
): Harness {
  const source = new CountingSource(doc, options);
  const clock = new TestClock();
  let behaviorCount = 0;
  const editor = createCompositionEditor({
    source,
    profile,
    catalog: CATALOG,
    now: clock.now,
    newNodeId: (taken) => {
      let index = taken.size + 1;
      while (taken.has(`w-${index}`)) {
        index++;
      }
      return `w-${index}`;
    },
    newBehaviorId: () => `b-${++behaviorCount}`,
  });
  editor.viewport.setZoom(1);
  return { editor, source, clock };
}
