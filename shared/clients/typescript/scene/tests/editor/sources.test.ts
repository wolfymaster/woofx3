import { describe, expect, test } from "bun:test";
import type { SceneDocument } from "../../../api/scene-editor/document";
import { createCompositionEditor, LocalDocumentSource, SyncDocumentSource } from "../../editor";
import { type CompositionDocument, PROFILES } from "../../model";
import { CATALOG, composition, placement } from "./support";
import { syncWorld } from "./sync-support";

function scene(): SceneDocument {
  return {
    layout: { width: 1920, height: 1080 },
    widgets: { w: placement({ x: 0, name: "ab" }), v: placement({ x: 500, z: "a0002" }) },
    behaviors: {},
  };
}

describe("LocalDocumentSource", () => {
  test("applies a change, tells its listeners, and keeps the document's identity otherwise", () => {
    const source = new LocalDocumentSource(composition({ a: placement() }));
    const first = source.getDocument();
    expect(source.getDocument()).toBe(first);
    let calls = 0;
    const unsubscribe = source.subscribe(() => calls++);
    expect(
      source.apply((doc) => {
        doc.widgets.a!.x = 5;
        return doc;
      })
    ).toEqual({ ok: true });
    expect(calls).toBe(1);
    expect(source.getDocument()).not.toBe(first);
    expect(first.widgets.a?.x).toBe(0);
    unsubscribe();
    source.replace(composition());
    expect(calls).toBe(1);
  });

  test("refuses while read-only, and a result that is not a composition", () => {
    const source = new LocalDocumentSource(composition(), { readOnly: true });
    expect(source.apply((doc) => doc).ok).toBe(false);
    source.setReadOnly(false);
    expect(source.apply(() => ({ layout: {} }) as unknown as CompositionDocument).ok).toBe(false);
    expect(source.apply((doc) => doc).ok).toBe(true);
  });
});

describe("SyncDocumentSource", () => {
  test("is read-only with no document until the scene loads, then edits go to the server", async () => {
    const world = syncWorld(scene());
    const client = world.client("a");
    const source = new SyncDocumentSource({ client, version: "draft" });
    const editor = createCompositionEditor({ source, profile: PROFILES.scene, catalog: CATALOG });
    expect(editor.getState().doc).toBeNull();
    expect(editor.getState().capabilities.readOnly).toBe(true);
    expect(editor.dispatch("node.delete").ok).toBe(false);
    await world.quiet(200);
    expect(editor.getState().doc?.widgets.w).toBeDefined();
    expect(editor.getState().doc?.behaviors).toEqual({});
    expect(editor.getState().capabilities).toMatchObject({ readOnly: false, presence: true });

    editor.viewport.setZoom(1);
    editor.gesture.begin({ kind: "move", node: "w", point: { x: 0, y: 0 } });
    for (let step = 1; step <= 5; step++) {
      editor.gesture.update({ x: step * 10, y: 0 }, { alt: true });
    }
    expect(client.getState().pendingItems).toBe(0);
    expect(editor.gesture.end().ok).toBe(true);
    expect(client.getState().pendingItems).toBe(1);
    await world.quiet();
    expect(world.server.state.docs.draft.widgets.w?.x).toBe(50);
    expect(world.server.state.docs.published.widgets.w?.x).toBe(0);
    expect(world.server.state.v).toBe(1);
  });

  test("a refused edit is rolled back, and leaves nothing to undo", async () => {
    const world = syncWorld(scene());
    const client = world.client("a");
    const source = new SyncDocumentSource({ client, version: "draft" });
    const editor = createCompositionEditor({ source, profile: PROFILES.scene, catalog: CATALOG });
    await world.quiet(200);
    world.server.refuse = () => "no";
    expect(editor.nodes.patch("w", { x: 70 }).ok).toBe(true);
    expect(editor.getState().doc?.widgets.w?.x).toBe(70);
    expect(editor.getState().history.canUndo).toBe(true);
    await world.quiet();
    expect(world.reports.map((report) => report.reason)).toEqual(["rejected"]);
    expect(editor.getState().doc?.widgets.w?.x).toBe(0);
    expect(editor.getState().history.canUndo).toBe(false);
  });

  test("undo after another editor's concurrent change reverts only this user's change", async () => {
    const world = syncWorld(scene());
    const mine = world.client("a");
    const theirs = world.client("b");
    const editor = createCompositionEditor({
      source: new SyncDocumentSource({ client: mine, version: "draft" }),
      profile: PROFILES.scene,
      catalog: CATALOG,
    });
    const other = createCompositionEditor({
      source: new SyncDocumentSource({ client: theirs, version: "draft" }),
      profile: PROFILES.scene,
      catalog: CATALOG,
    });
    await world.quiet(200);
    editor.nodes.patch("w", { x: 10 });
    other.nodes.patch("w", { name: "abc" });
    other.nodes.patch("v", { x: 900 });
    await world.quiet();
    expect(editor.getState().doc?.widgets.w).toMatchObject({ x: 10, name: "abc" });
    expect(editor.history.undo().ok).toBe(true);
    await world.quiet();
    for (const view of [editor, other]) {
      expect(view.getState().doc?.widgets.w).toMatchObject({ x: 0, name: "abc" });
      expect(view.getState().doc?.widgets.v?.x).toBe(900);
    }
    expect(world.server.state.docs.draft.widgets.w).toMatchObject({ x: 0, name: "abc" });
    // The other editor's own history is untouched by this undo: theirs still undoes.
    expect(other.history.undo().ok).toBe(true);
    await world.quiet();
    expect(world.server.state.docs.draft.widgets.v?.x).toBe(500);
  });

  test("the draft is read-only while a publish is pending", async () => {
    const world = syncWorld(scene());
    const client = world.client("a");
    const editor = createCompositionEditor({
      source: new SyncDocumentSource({ client, version: "draft" }),
      profile: PROFILES.scene,
      catalog: CATALOG,
    });
    const live = createCompositionEditor({
      source: new SyncDocumentSource({ client, version: "published" }),
      profile: PROFILES.scene,
      catalog: CATALOG,
    });
    await world.quiet(200);
    editor.nodes.patch("w", { x: 5 });
    expect(client.publish()).toBe(true);
    expect(editor.getState().capabilities).toMatchObject({
      readOnly: true,
      readOnlyReason: "the draft is being published",
    });
    expect(editor.nodes.patch("w", { x: 6 })).toEqual({ ok: false, detail: "the draft is being published" });
    expect(live.getState().capabilities).toMatchObject({ readOnly: false, readOnlyReason: null });
    await world.quiet();
    expect(editor.getState().capabilities).toMatchObject({ readOnly: false, readOnlyReason: null });
    expect(world.server.state.docs.published.widgets.w?.x).toBe(5);
  });

  test("behaviors reach the server, and deleting their widget removes them in the same item", async () => {
    const world = syncWorld(scene());
    const client = world.client("a");
    const editor = createCompositionEditor({
      source: new SyncDocumentSource({ client, version: "draft" }),
      profile: PROFILES.scene,
      catalog: CATALOG,
    });
    await world.quiet(200);
    const added = editor.behaviors.add("w", "effect", "shake", {
      anchor: "enter",
      offsetMs: 0,
      durationMs: 100,
      easing: "linear",
    });
    expect(added.ok).toBe(true);
    await world.quiet();
    const id = (added as { id: string }).id;
    expect(world.server.state.docs.draft.behaviors[id]).toMatchObject({ type: "effect", kind: "shake", target: "w" });

    editor.dispatch("selection.select", { id: "w" });
    expect(editor.dispatch("node.delete").ok).toBe(true);
    expect(client.getState().pendingItems).toBe(1);
    await world.quiet();
    expect(world.server.state.docs.draft.widgets.w).toBeUndefined();
    expect(world.server.state.docs.draft.behaviors).toEqual({});
    expect(world.reports).toEqual([]);
  });

  test("refuses what the session cannot store rather than losing it", async () => {
    const world = syncWorld(scene());
    const client = world.client("a");
    const source = new SyncDocumentSource({ client, version: "draft" });
    await world.quiet(200);
    const inputs = source.apply((doc) => ({ ...doc, inputs: [{ id: "name", label: "Name", type: "string" }] }));
    expect(inputs).toEqual({ ok: false, detail: "a scene does not store inputs" });
    const unknown = source.apply((doc) => ({ ...doc, theme: "dark" }) as CompositionDocument);
    expect(unknown).toEqual({ ok: false, detail: "a scene does not store theme" });
    expect(source.getDocument()).not.toHaveProperty("inputs");
    expect(client.getState().pendingItems).toBe(0);
  });

  test("the selection is sent as presence for the version being edited", async () => {
    const world = syncWorld(scene());
    const client = world.client("a");
    const sent: Array<[string | null, string]> = [];
    const setPresence = client.setPresence.bind(client);
    client.setPresence = (selection, version) => {
      sent.push([selection, version]);
      setPresence(selection, version);
    };
    const editor = createCompositionEditor({
      source: new SyncDocumentSource({ client, version: "published" }),
      profile: PROFILES.scene,
      catalog: CATALOG,
    });
    await world.quiet(200);
    editor.dispatch("selection.select", { id: "v" });
    editor.dispatch("selection.clear");
    expect(sent).toEqual([
      ["v", "published"],
      [null, "published"],
    ]);
  });
});
