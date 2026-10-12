// Keyboard shortcuts as data: a chord, the command it runs, and the
// command's arguments. The UI turns a key event into a chord with `chordOf`
// and hands it to the editor, which looks it up here; a UI that wants other
// bindings passes its own table.
//
// A chord is the modifiers held, in the order Mod, Shift, Alt, then the key,
// joined with "+": "Mod+Shift+z". Mod is Ctrl, or Cmd on a Mac. A letter key
// is lower case whatever Shift does to it, so Shift+Z is "Shift+z".

/**
 * Every command the editor runs. Commands that act on placements act on the
 * selection; `canvas.patch` takes the layout keys to set as its arguments.
 */
export type CommandId =
  | "selection.select"
  | "selection.clear"
  | "selection.all"
  | "node.delete"
  | "node.toggleVisible"
  | "node.toggleLock"
  | "node.nudge"
  | "node.duplicate"
  | "layer.bringForward"
  | "layer.sendBackward"
  | "layer.toFront"
  | "layer.toBack"
  | "canvas.patch"
  | "clipboard.copy"
  | "clipboard.cut"
  | "clipboard.paste"
  | "history.undo"
  | "history.redo"
  | "view.zoomIn"
  | "view.zoomOut"
  | "view.zoomFit"
  | "gesture.cancel";

export const COMMAND_IDS: readonly CommandId[] = [
  "selection.select",
  "selection.clear",
  "selection.all",
  "node.delete",
  "node.toggleVisible",
  "node.toggleLock",
  "node.nudge",
  "node.duplicate",
  "layer.bringForward",
  "layer.sendBackward",
  "layer.toFront",
  "layer.toBack",
  "canvas.patch",
  "clipboard.copy",
  "clipboard.cut",
  "clipboard.paste",
  "history.undo",
  "history.redo",
  "view.zoomIn",
  "view.zoomOut",
  "view.zoomFit",
  "gesture.cancel",
];

export interface KeyBinding {
  chord: string;
  command: CommandId;
  args?: Record<string, unknown>;
}

/** Pixels an arrow key nudges by, and with Shift held. */
export const NUDGE_STEP = 1;
export const NUDGE_STEP_LARGE = 10;

function nudges(): KeyBinding[] {
  const arrows: Array<[string, number, number]> = [
    ["ArrowLeft", -1, 0],
    ["ArrowRight", 1, 0],
    ["ArrowUp", 0, -1],
    ["ArrowDown", 0, 1],
  ];
  return arrows.flatMap(([key, x, y]) => [
    { chord: key, command: "node.nudge" as const, args: { dx: x * NUDGE_STEP, dy: y * NUDGE_STEP } },
    {
      chord: `Shift+${key}`,
      command: "node.nudge" as const,
      args: { dx: x * NUDGE_STEP_LARGE, dy: y * NUDGE_STEP_LARGE },
    },
  ]);
}

export const DEFAULT_KEYMAP: readonly KeyBinding[] = [
  ...nudges(),
  { chord: "Delete", command: "node.delete" },
  { chord: "Backspace", command: "node.delete" },
  { chord: "Escape", command: "selection.clear" },
  { chord: "Mod+a", command: "selection.all" },
  { chord: "Mod+d", command: "node.duplicate" },
  { chord: "Mod+Shift+h", command: "node.toggleVisible" },
  { chord: "Mod+Shift+l", command: "node.toggleLock" },
  { chord: "]", command: "layer.bringForward" },
  { chord: "[", command: "layer.sendBackward" },
  { chord: "Mod+]", command: "layer.toFront" },
  { chord: "Mod+[", command: "layer.toBack" },
  { chord: "Mod+c", command: "clipboard.copy" },
  { chord: "Mod+x", command: "clipboard.cut" },
  { chord: "Mod+v", command: "clipboard.paste" },
  { chord: "Mod+z", command: "history.undo" },
  { chord: "Mod+Shift+z", command: "history.redo" },
  { chord: "Mod+y", command: "history.redo" },
  { chord: "Mod+=", command: "view.zoomIn" },
  { chord: "Mod+-", command: "view.zoomOut" },
  { chord: "Mod+0", command: "view.zoomFit" },
];

/** What `chordOf` reads from a key event; a DOM KeyboardEvent has all of it. */
export interface KeyInput {
  key: string;
  shiftKey?: boolean;
  ctrlKey?: boolean;
  metaKey?: boolean;
  altKey?: boolean;
}

/** The chord a key event is, in the form keymaps are written in. */
export function chordOf(input: KeyInput): string {
  const parts: string[] = [];
  if (input.ctrlKey === true || input.metaKey === true) {
    parts.push("Mod");
  }
  if (input.shiftKey === true) {
    parts.push("Shift");
  }
  if (input.altKey === true) {
    parts.push("Alt");
  }
  parts.push(input.key.length === 1 ? input.key.toLowerCase() : input.key);
  return parts.join("+");
}

/** The binding for `chord` in `keymap`, or null. */
export function bindingFor(keymap: readonly KeyBinding[], chord: string): KeyBinding | null {
  return keymap.find((binding) => binding.chord === chord) ?? null;
}
