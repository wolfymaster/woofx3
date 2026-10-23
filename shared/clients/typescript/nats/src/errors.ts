import { NoRespondersError, RequestError, TimeoutError } from "@nats-io/nats-core";

export { NoRespondersError, RequestError, TimeoutError };

/**
 * How a NATS request failed, as far as a caller can act on it: `timeout`
 * when nobody answered in time (a responder may still have acted),
 * `no_responders` when nothing listens on the subject (nothing happened),
 * `other` for anything else, such as a closed connection.
 */
export type RequestFailureKind = "timeout" | "no_responders" | "other";

/** Reads the NATS client's typed request errors; never their messages. */
export function requestFailureKind(err: unknown): RequestFailureKind {
  if (err instanceof TimeoutError) {
    return "timeout";
  }
  if (err instanceof NoRespondersError || (err instanceof RequestError && err.isNoResponders())) {
    return "no_responders";
  }
  return "other";
}
