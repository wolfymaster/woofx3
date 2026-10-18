// Keeps an overlay's session alive, and gets a new one when it lapses.
//
// The session cookie is a short-lived JWT renewed every `intervalMs`. A page
// whose timers stop for longer than the session lives (a sleeping machine, a
// network gone for over a minute, a hidden browser source the browser
// throttles) comes back holding an expired cookie, and every renewal is then
// refused: renewing needs a valid session. Only loading the page again mints
// one, from the overlay token in its URL, so a refusal reloads the page
// rather than leaving it disconnected for good. A renewal that fails for any
// other reason (the engine unreachable, restarting) is retried on the next
// tick while the page shows itself disconnected.

export interface SessionRefreshOptions {
  /** POST the renewal; resolves with the response, rejects when it never arrived. */
  refresh(): Promise<Response>;
  /** The session is good, or failing to renew it, for a reason worth showing. */
  onHealth(healthy: boolean): void;
  /** The session lapsed and cannot be renewed: authenticate again. */
  onExpired(): void;
  intervalMs: number;
  setInterval?: (fn: () => void, ms: number) => unknown;
}

export function startSessionRefresh(options: SessionRefreshOptions): void {
  const every = options.setInterval ?? ((fn, ms) => setInterval(fn, ms));
  // One renewal at a time: a slow one is not joined by the next tick's.
  let renewing = false;
  every(() => {
    if (renewing) {
      return;
    }
    renewing = true;
    void renewSession(options).finally(() => {
      renewing = false;
    });
  }, options.intervalMs);
}

/** One renewal; exported for tests. */
export async function renewSession(options: Pick<SessionRefreshOptions, "refresh" | "onHealth" | "onExpired">) {
  let response: Response;
  try {
    response = await options.refresh();
  } catch {
    options.onHealth(false);
    return;
  }
  if (response.status === 401) {
    options.onExpired();
    return;
  }
  options.onHealth(response.ok);
}
