// Replacing a widget's frame without a blank moment.
//
// A frame has to be replaced when what it loads changes (another version or
// theme of the widget) or when its script read a setting that changed (see
// `settingsUpdate` in scene-update.ts). Unmounting the old frame first would
// leave the slot empty while the new one loads, so the new frame loads
// invisibly in the same slot and takes over once it reports it has painted,
// or after SWAP_TIMEOUT_MS when it never does. The overlay and the
// composition preview both replace frames this way.

/** Longest a fresh frame stays invisible behind the one it replaces. */
export const SWAP_TIMEOUT_MS = 2000;

/** A frame mounted to replace another: invisible until revealed. */
export interface SwappingFrame {
  reveal(): void;
  unmount(): void;
}

export interface FrameSwap {
  /** Drop the fresh frame, leaving the old one in place; nothing once the swap is done. */
  cancel(): void;
}

export interface FrameSwapArgs<TFrame extends SwappingFrame> {
  /** Mount the fresh frame invisibly; `painted` is called when it reports it has painted. */
  mountFresh(painted: () => void): TFrame;
  /** Take the old frame away, once the fresh one shows. */
  retire(): void;
  /** The fresh frame is the placement's frame now. */
  swapped(fresh: TFrame): void;
  /** Call `callback` after `ms`; the result cancels it. */
  schedule(callback: () => void, ms: number): () => void;
}

export function swapFrameIn<TFrame extends SwappingFrame>(args: FrameSwapArgs<TFrame>): FrameSwap {
  let settled = false;
  let cancelTimer: (() => void) | null = null;
  let fresh: TFrame | null = null;
  const finish = (): void => {
    if (settled) {
      return;
    }
    if (fresh === null) {
      throw new Error("frame swap: the fresh frame reported painting before it was mounted");
    }
    settled = true;
    cancelTimer?.();
    fresh.reveal();
    args.retire();
    args.swapped(fresh);
  };
  fresh = args.mountFresh(finish);
  cancelTimer = args.schedule(finish, SWAP_TIMEOUT_MS);
  return {
    cancel: () => {
      if (settled) {
        return;
      }
      settled = true;
      cancelTimer?.();
      fresh?.unmount();
    },
  };
}
