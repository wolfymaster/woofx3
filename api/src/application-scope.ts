import type { SharedLogger } from "@woofx3/common/logging";

/**
 * Starts the api components that exist per application -- the Convex webhook
 * client, the alert, storage-change and stream-session emitters -- exactly
 * once, whenever the engine's default application first becomes known.
 *
 * That is at boot on an engine that is already registered, and at the first
 * `registerClient` on a fresh one, which is what creates the application.
 * Starting on registration is what lets a freshly provisioned engine work
 * right after the UI registers, without a restart.
 */
export class ApplicationScope {
  private started: { applicationId: string; running: Promise<void> } | null = null;

  /**
   * @param startComponents Starts every per-application component for
   *   `applicationId`. Called at most once per successful start.
   */
  constructor(
    private readonly startComponents: (applicationId: string) => Promise<void>,
    private readonly logger: SharedLogger
  ) {}

  /**
   * Start the components for `applicationId`, or return the start already
   * under way or done for it. A start that fails is forgotten, so the next
   * call tries again.
   *
   * An engine serves exactly one application, so a second, different id means
   * something upstream is wrong; that is refused rather than started beside
   * the first.
   */
  start(applicationId: string): Promise<void> {
    if (this.started) {
      if (this.started.applicationId !== applicationId) {
        return Promise.reject(
          new Error(
            `Application-scoped components already run for ${this.started.applicationId}; refusing to start them for ${applicationId}`
          )
        );
      }
      return this.started.running;
    }

    const running = this.startComponents(applicationId).then(
      () => {
        this.logger.info("Application-scoped components started", { applicationId });
      },
      (err: unknown) => {
        this.started = null;
        throw err;
      }
    );
    this.started = { applicationId, running };
    return running;
  }
}
