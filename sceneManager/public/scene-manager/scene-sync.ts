// Keeping an overlay page's scene in step with the scene manager: the
// scene's sequenced document, the ops that arrive for its next sequence
// number, a resync when the page missed some, one fetch of the scene at a
// time, and fetching it again before the soonest media proxy URL on the page
// expires. What the page then does with a scene config is the page's
// (`apply`); this unit decides when there is a new one and what it is.

import { configOfSnapshot, parseSceneConfig, type SceneConfig } from "../../contract/scene-config";
import { mediaRefreshDelay } from "../../contract/media-url";
import { applyOps, mergeMeta, parseSnapshot, type SceneOpsEvent, type SceneSnapshot } from "./scene-document";

export type SceneView = "published" | "draft";

export interface SceneSyncTimers {
  setTimeout(fn: () => void, ms: number): unknown;
  clearTimeout(handle: unknown): void;
  now(): number;
}

export interface SceneSyncDeps {
  sceneId: string;
  /** `/scene/{sceneId}`, which the page's own requests go under. */
  sceneBase: string;
  /** The version this page shows: the editor's preview shows the draft. */
  view: SceneView;
  /** The document the shell was rendered with, if any. */
  initialDocument: SceneSnapshot | null;
  fetch(url: string, init: RequestInit): Promise<Response>;
  timers: SceneSyncTimers;
  /** The editor's unsaved placements, once it has sent any: what the page shows from then on. */
  draftPlacements(): unknown[] | null;
  /** The server answered a draft; `body` carries the media URLs it signed for it. */
  onDraftAnswered(body: unknown): void;
  /** Show `config` on the page. */
  apply(config: SceneConfig, fromDraft: boolean): void;
  /** The soonest a media proxy URL now on the page expires, in unix seconds, or null for none. */
  earliestMediaExpiry(): number | null;
  /** Load the page again: it re-renders the saved scene and re-mints the session. */
  reload(): void;
  warn(message: string, detail?: unknown): void;
}

type Target =
  | { kind: "apply"; config: SceneConfig; fromDraft: boolean }
  | { kind: "reload" }
  | { kind: "keep" }
  | { kind: "stale" };

export class SceneSync {
  private doc: SceneSnapshot | null;
  private updating = false;
  private updateRequested = false;
  private mediaRefreshTimer: unknown = null;
  // Fetches of the scene that failed in a row since one last applied; a
  // failure brings the next refresh forward (see mediaRefreshDelay).
  private mediaRefreshFailures = 0;

  constructor(private readonly deps: SceneSyncDeps) {
    this.doc = deps.initialDocument;
  }

  /** The scene's sequenced document as this page holds it. */
  document(): SceneSnapshot | null {
    return this.doc;
  }

  /**
   * The ops for the scene's next sequence number, applied to the document
   * and then to the page as a config. A gap, or ops that do not apply, means
   * this page missed some: it resyncs.
   */
  applyOps(event: SceneOpsEvent): void {
    if ((event.version ?? "published") !== this.deps.view) {
      return;
    }
    const doc = this.doc;
    if (doc && event.seq <= doc.seq) {
      return;
    }
    if (!doc || event.seq !== doc.seq + 1) {
      void this.update();
      return;
    }
    try {
      this.doc = {
        ...doc,
        seq: event.seq,
        doc: applyOps(doc.doc, event.ops),
        meta: mergeMeta(doc.meta, event.meta),
      };
    } catch (err) {
      this.deps.warn("[scene-manager] scene ops did not apply; resyncing", err);
      void this.update();
      return;
    }
    // While the editor previews its placements, they stay what this page
    // shows: the op's config goes on with the editor's newest settings laid
    // over it, as a draft answer would (`apply`'s `fromDraft`). The op
    // carries everything the server resolved for it (frames, signed media),
    // so nothing is fetched; a widget or theme the server has yet to resolve
    // is fetched by the draft preview on its own (draft-preview.ts).
    this.deps.apply(configOfSnapshot(this.doc), this.deps.draftPlacements() !== null);
  }

  /**
   * The stream opened (again), naming the sequence each version is at. Ops
   * sent while the stream was down are not sent again, nor does a scene the
   * server stopped holding keep this page's numbering: either resyncs.
   */
  onStreamOpened(publishedSeq: number, draftSeq: number): void {
    const seq = this.deps.view === "draft" ? draftSeq : publishedSeq;
    if (!this.doc || seq !== this.doc.seq) {
      void this.update();
    }
  }

  /**
   * Fetch the scene (or the editor's draft) and show it. One at a time:
   * saves and drafts that land while one is applying collapse into a single
   * fetch of the newest target once it is done.
   */
  async update(): Promise<void> {
    this.updateRequested = true;
    if (this.updating) {
      return;
    }
    this.updating = true;
    try {
      let staleRetries = 0;
      while (this.updateRequested) {
        this.updateRequested = false;
        const target = await this.fetchTarget();
        if (target.kind === "reload") {
          this.deps.reload();
          return;
        }
        if (target.kind === "stale") {
          // The stream applied ops after the server built this answer; one
          // fetched now is at least as new, since both come from the same
          // sequence. Asked once: never a loop on a server out of step.
          if (staleRetries < 1) {
            staleRetries += 1;
            this.updateRequested = true;
          }
          continue;
        }
        if (target.kind === "apply") {
          this.mediaRefreshFailures = 0;
          this.deps.apply(target.config, target.fromDraft);
        } else {
          this.mediaRefreshFailures += 1;
          this.scheduleMediaRefresh();
        }
      }
    } finally {
      this.updating = false;
    }
  }

  /**
   * Fetch the scene again before the soonest media proxy URL on the page
   * expires. Run whenever the page's settings are replaced, and after a fetch
   * that brought nothing, so the timer always follows what is on screen.
   */
  scheduleMediaRefresh(): void {
    const { timers } = this.deps;
    if (this.mediaRefreshTimer !== null) {
      timers.clearTimeout(this.mediaRefreshTimer);
      this.mediaRefreshTimer = null;
    }
    const earliest = this.deps.earliestMediaExpiry();
    if (earliest === null) {
      return;
    }
    const delay = mediaRefreshDelay(earliest, timers.now(), this.mediaRefreshFailures);
    this.mediaRefreshTimer = timers.setTimeout(() => {
      this.mediaRefreshTimer = null;
      void this.update();
    }, delay);
  }

  // The saved scene, or the editor's draft once it has sent one. A failed
  // saved fetch reloads, which renders the saved scene too and re-mints the
  // session when a lapsed one is why it failed. A failed draft fetch keeps
  // what is on screen instead: the editor posts its draft again on every
  // load, so reloading for a draft the server keeps refusing would loop.
  private async fetchTarget(): Promise<Target> {
    const { sceneBase, view } = this.deps;
    const draft = this.deps.draftPlacements();
    let resp: Response;
    try {
      resp = draft
        ? await this.deps.fetch(`${sceneBase}/draft-config`, {
            method: "POST",
            credentials: "same-origin",
            cache: "no-store",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ widgets: draft }),
          })
        : await this.deps.fetch(`${sceneBase}/config${view === "draft" ? "?view=draft" : ""}`, {
            credentials: "same-origin",
            cache: "no-store",
          });
    } catch {
      return draft ? { kind: "keep" } : { kind: "reload" };
    }
    const body: unknown = resp.ok ? await resp.json().catch(() => null) : null;
    const config = parseSceneConfig(body);
    if (draft && config) {
      this.deps.onDraftAnswered(body);
    }
    if (config && config.id === this.deps.sceneId) {
      // The saved scene comes with its document; later ops apply to it.
      const snapshot = draft ? null : parseSnapshot(asRecord(body).document);
      if (snapshot) {
        if (this.doc && snapshot.seq < this.doc.seq) {
          return { kind: "stale" };
        }
        this.doc = snapshot;
      }
      return { kind: "apply", config, fromDraft: draft !== null };
    }
    if (draft && resp.status !== 401) {
      this.deps.warn("[scene-manager] draft preview refused; showing the last one", { status: resp.status });
      return { kind: "keep" };
    }
    return { kind: "reload" };
  }
}

function asRecord(value: unknown): Record<string, unknown> {
  return typeof value === "object" && value !== null ? (value as Record<string, unknown>) : {};
}
