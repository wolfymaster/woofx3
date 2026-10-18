// The scene editor's draft, as an overlay framed by the editor previews it.
//
// The editor posts its draft layout (a drag not yet saved) and its unsaved
// placements to the page that frames the overlay. The layout only moves
// widgets on that screen. Placements' settings reach widgets keystroke by
// keystroke; only a new widget or theme, or an external media URL the
// server has not signed yet, needs the server to see the draft, which it is
// asked once the editor pauses (`settleMs`). Nothing here is saved or sent
// anywhere but the scene manager.

import { externalMediaUrls, parseMediaUrls, replaceMediaUrls } from "../../contract/media-url";
import {
  draftFrameKey,
  parsePreviewLayout,
  parsePreviewPlacements,
  type PreviewWidgetLayout,
  settingsOf,
} from "./preview-layout";

/** Adding a widget or changing a theme needs the server to resolve the new frame; waiting for a pause asks it once. */
export const DRAFT_SETTLE_MS = 400;

export interface DraftPreviewDeps {
  /** Whether the placement `id` is an alert area, which is mounted again for any change. */
  isAlertArea(id: string): boolean;
  /** The editor moved widgets on this screen. */
  onLayout(layout: PreviewWidgetLayout[]): void;
  /** The editor's newest placements, each with the settings to show (`settingsFor`). */
  onPlacements(placements: readonly unknown[]): void;
  /** The server must see the draft: ask it for the draft's config. */
  requestUpdate(): void;
  timers: { setTimeout(fn: () => void, ms: number): unknown; clearTimeout(handle: unknown): void };
  settleMs?: number;
}

export class DraftPreview {
  private layoutState: PreviewWidgetLayout[] | null = null;
  private placementsState: unknown[] | null = null;
  private key = "";
  private timer: unknown = null;
  // The editor sends settings as entered, so external media in them still
  // names its own host, which a themeable widget's frame refuses. The server
  // answers each draft with, per placement, the proxy URL of each external
  // media URL it signed, and settings from the editor are pointed at those.
  // Each answer replaces the last, so this holds only what the newest draft
  // named.
  private proxied = new Map<string, Map<string, string>>();

  constructor(private readonly deps: DraftPreviewDeps) {}

  /** The editor's draft layout, kept so a scene update does not undo a drag it has not saved. */
  layout(): PreviewWidgetLayout[] | null {
    return this.layoutState;
  }

  /** The editor's unsaved placements, once it has sent any: from then on what the page shows. */
  placements(): unknown[] | null {
    return this.placementsState;
  }

  /** A message from the editor framing this page. */
  handleMessage(data: unknown): void {
    const layout = parsePreviewLayout(data);
    if (layout) {
      this.layoutState = layout;
      this.deps.onLayout(layout);
    }
    const placements = parsePreviewPlacements(data);
    if (!placements) {
      return;
    }
    this.placementsState = placements;
    this.deps.onPlacements(placements);
    const key = this.keyOf(placements);
    if (key === this.key) {
      return;
    }
    this.key = key;
    if (this.timer !== null) {
      this.deps.timers.clearTimeout(this.timer);
    }
    this.timer = this.deps.timers.setTimeout(() => {
      this.timer = null;
      this.deps.requestUpdate();
    }, this.deps.settleMs ?? DRAFT_SETTLE_MS);
  }

  /** The server answered the draft: the media URLs it signed, per placement. */
  answered(body: unknown): void {
    this.proxied = parseMediaUrls((body as { mediaUrls?: unknown } | null)?.mediaUrls);
    // The newest draft's key, with what was just signed left out of it, so
    // the same draft posted again does not ask a second time.
    if (this.placementsState) {
      this.key = this.keyOf(this.placementsState);
    }
  }

  /** A placement's settings as the editor has them, external media pointed at what the server signed. */
  settingsFor(placement: Record<string, unknown>): Record<string, unknown> {
    const signed = this.signedOf(placement);
    const settings = settingsOf(placement);
    return signed ? replaceMediaUrls(settings, signed) : settings;
  }

  private signedOf(placement: Record<string, unknown>): Map<string, string> | undefined {
    return typeof placement.id === "string" ? this.proxied.get(placement.id) : undefined;
  }

  // What the server has to see a draft again for: a new widget or theme, and
  // an external media URL it has not signed. A URL it will not sign (the
  // widget loads it directly, or no editor has put it in the scene yet) stays
  // in the key, so it asks once per change rather than once per message; the
  // editor's op putting it in the scene brings the page back here.
  private keyOf(placements: readonly unknown[]): string {
    return (
      draftFrameKey(placements, (id) => this.deps.isAlertArea(id)) +
      JSON.stringify(
        placements.flatMap((raw) => {
          const placement = asRecord(raw);
          const signed = this.signedOf(placement);
          return externalMediaUrls(settingsOf(placement)).filter((url) => !signed?.has(url));
        })
      )
    );
  }
}

function asRecord(value: unknown): Record<string, unknown> {
  return typeof value === "object" && value !== null ? (value as Record<string, unknown>) : {};
}
