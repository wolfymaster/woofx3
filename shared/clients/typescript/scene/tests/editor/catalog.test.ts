import { describe, expect, test } from "bun:test";
import { type CatalogWidget, offeredKinds } from "../../editor";

const text: CatalogWidget = {
  widgetId: "woofx3:widget:text",
  name: "Text",
  settings: [],
  behaviorKinds: { transitions: [{ id: "typewriter", label: "Typewriter" }], effects: [] },
};

describe("offeredKinds", () => {
  test("the host's kinds, then the ones the widget declares", () => {
    const transitions = offeredKinds(text, "transition");
    expect(transitions[0]).toEqual({ kind: "fade", executor: "host" });
    expect(transitions.at(-1)).toEqual({ kind: "typewriter", executor: "widget", label: "Typewriter" });
    expect(offeredKinds(text, "effect").every((offered) => offered.executor === "host")).toBe(true);
  });

  test("a widget declaring nothing, or none at all, gets only the host's", () => {
    const bare: CatalogWidget = { widgetId: "woofx3:widget:image", name: "Image", settings: [] };
    expect(offeredKinds(bare, "transition")).toEqual(offeredKinds(undefined, "transition"));
    expect(offeredKinds(undefined, "transition").every((offered) => offered.executor === "host")).toBe(true);
  });
});
