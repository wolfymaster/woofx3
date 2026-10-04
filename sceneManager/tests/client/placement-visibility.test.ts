import { describe, expect, it } from "bun:test";
import { applyPlacementVisibility, DIMMED_OPACITY } from "../../public/scene-manager/placement-visibility";

function element(): HTMLElement {
  return { style: { visibility: "", opacity: "" } } as unknown as HTMLElement;
}

describe("applyPlacementVisibility", () => {
  it("hides a placement on stream without removing it, and shows it again", () => {
    const el = element();
    applyPlacementVisibility(el, false, false);
    expect(el.style.visibility).toBe("hidden");
    applyPlacementVisibility(el, true, false);
    expect(el.style.visibility).toBe("");
  });

  it("dims rather than hides a placement in the editor, which has to place it", () => {
    const el = element();
    applyPlacementVisibility(el, false, true);
    expect(el.style.visibility).toBe("");
    expect(el.style.opacity).toBe(DIMMED_OPACITY);
    applyPlacementVisibility(el, true, true);
    expect(el.style.opacity).toBe("");
  });
});
