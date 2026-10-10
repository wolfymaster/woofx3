import { describe, expect, test } from "bun:test";
import { applyOps, type Ops, type SceneDocument, transformOps } from "../../scene-editor/document";
import type { ItemBody } from "../../scene-editor/protocol";
import { rebaseFieldwise } from "../../scene-editor/rebase";
import { bothDocs, placement, sceneDoc } from "./test-support";

function edit(version: "draft" | "published", ops: Ops): ItemBody {
  return { kind: "edit", version, ops };
}

function draftAfter(target: SceneDocument, bodies: Array<ItemBody | null>): SceneDocument {
  let doc = target;
  for (const body of bodies) {
    if (body !== null && body.kind === "edit" && body.version === "draft") {
      doc = applyOps(doc, body.ops);
    }
  }
  return doc;
}

describe("rebaseFieldwise", () => {
  test("a field edit is set to the value it meant; the snapshot's other fields stay", () => {
    const base = bothDocs(sceneDoc({ w: placement({ x: 0, y: 0 }) }));
    const target = bothDocs(sceneDoc({ w: placement({ x: 5, y: 8 }) }));
    const rebased = rebaseFieldwise(base, [edit("draft", [{ p: ["widgets", "w", "x"], od: 0, oi: 1 }])], target);

    expect(draftAfter(target.draft, rebased).widgets.w).toMatchObject({ x: 1, y: 8 });
  });

  test("text is replaced whole with what the edit meant (last writer wins)", () => {
    const base = bothDocs(sceneDoc({ w: placement({ name: "abc" }) }));
    const target = bothDocs(sceneDoc({ w: placement({ name: "abcXYZ" }) }));
    const rebased = rebaseFieldwise(base, [edit("draft", [{ p: ["widgets", "w", "name", 0], si: "!" }])], target);

    expect(draftAfter(target.draft, rebased).widgets.w!.name).toBe("!abc");
  });

  test("a rebased edit replaces the fields it touched whole, so concurrent text is not merged into it", () => {
    // Two editors rebase pending text onto the same snapshot. As splices their
    // edits would interleave into a value neither wrote; as replacements the
    // later one wins whole.
    const base = bothDocs(sceneDoc({ w: placement({ name: "[a]" }) }));
    const target = bothDocs(sceneDoc({ w: placement({ name: "[a][b]" }) }));
    const mine = rebaseFieldwise(base, [edit("draft", [{ p: ["widgets", "w", "name", 3], si: "[m]" }])], target);
    const theirs = rebaseFieldwise(base, [edit("draft", [{ p: ["widgets", "w", "name", 0], si: "[t]" }])], target);
    const mineOps = (mine[0] as Extract<ItemBody, { kind: "edit" }>).ops;
    const theirOps = (theirs[0] as Extract<ItemBody, { kind: "edit" }>).ops;
    expect(mineOps).toEqual([{ p: ["widgets", "w", "name"], od: "[a][b]", oi: "[a][m]" }]);

    const afterTheirs = applyOps(target.draft, theirOps);
    const afterMine = applyOps(afterTheirs, transformOps(mineOps, theirOps, "left"));
    expect(afterMine.widgets.w!.name).toBe("[a][m]");
  });

  test("an edit to a placement the snapshot no longer has is dropped", () => {
    const base = bothDocs(sceneDoc({ w: placement() }));
    const target = bothDocs(sceneDoc({}));
    const rebased = rebaseFieldwise(
      base,
      [
        edit("draft", [{ p: ["widgets", "w", "x"], od: 0, oi: 1 }]),
        edit("draft", [{ p: ["widgets", "w"], od: placement({ x: 1 }), oi: placement({ x: 2 }) }]),
      ],
      target
    );

    expect(rebased).toEqual([edit("draft", []), edit("draft", [])]);
  });

  test("an added placement is kept; a removed one is removed", () => {
    const base = bothDocs(sceneDoc({ w: placement() }));
    const target = bothDocs(sceneDoc({ w: placement({ x: 3 }), other: placement() }));
    const rebased = rebaseFieldwise(
      base,
      [
        edit("draft", [
          { p: ["widgets", "n"], oi: placement({ name: "new" }) },
          { p: ["widgets", "w"], od: placement() },
        ]),
      ],
      target
    );

    expect(Object.keys(draftAfter(target.draft, rebased).widgets).sort()).toEqual(["n", "other"]);
  });

  test("layout keys are set or removed as the edit meant", () => {
    const base = bothDocs(sceneDoc());
    const target = bothDocs({ layout: { width: 1280, height: 720, theme: "dark" }, widgets: {} });
    const rebased = rebaseFieldwise(
      base,
      [
        edit("draft", [
          { p: ["layout", "width"], od: 1920, oi: 800 },
          { p: ["layout", "background"], oi: "red" },
        ]),
      ],
      target
    );

    expect(draftAfter(target.draft, rebased).layout).toEqual({
      width: 800,
      height: 720,
      theme: "dark",
      background: "red",
    });
  });

  test("edits chain in order per version, and commands pass through", () => {
    const base = bothDocs(sceneDoc({ w: placement() }));
    const target = bothDocs(sceneDoc({ w: placement({ y: 4 }) }));
    const bodies: ItemBody[] = [
      edit("draft", [{ p: ["widgets", "w", "x"], od: 0, oi: 1 }]),
      { kind: "publish" },
      edit("draft", [{ p: ["widgets", "w", "x"], od: 1, oi: 2 }]),
      edit("published", [{ p: ["widgets", "w", "y"], od: 0, oi: 9 }]),
    ];
    const rebased = rebaseFieldwise(base, bodies, target);

    expect(rebased[1]).toEqual({ kind: "publish" });
    expect(draftAfter(target.draft, rebased).widgets.w).toMatchObject({ x: 2, y: 4 });
    const published = rebased[3];
    expect(
      published !== null && published.kind === "edit" && applyOps(target.published, published.ops).widgets.w!.y
    ).toBe(9);
  });

  test("an edit whose ops do not apply to the old chain comes back null", () => {
    const base = bothDocs(sceneDoc());
    const rebased = rebaseFieldwise(base, [edit("draft", [{ p: ["widgets", "missing", "x"], od: 0, oi: 1 }])], base);
    expect(rebased).toEqual([null]);
  });
});
