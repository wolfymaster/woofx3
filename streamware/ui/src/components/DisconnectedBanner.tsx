import { useEffect, useState } from "react";

const SHOW_AFTER_MS = 5000;

interface DisconnectedBannerProps {
  connected: boolean;
}

/**
 * Tracks `connected` and returns true once the connection has been down
 * for at least `delayMs`. Reconnecting before the timer fires cancels
 * it. Used by DisconnectedBanner to suppress flicker on transient drops
 * while still surfacing real outages within a fixed window.
 *
 * Exported for unit testing once a DOM-aware test harness is in place.
 */
export function useDisconnectedAfter(connected: boolean, delayMs: number): boolean {
  const [visible, setVisible] = useState(false);

  useEffect(() => {
    if (connected) {
      setVisible(false);
      return;
    }
    const timer = setTimeout(() => {
      setVisible(true);
    }, delayMs);
    return () => clearTimeout(timer);
  }, [connected, delayMs]);

  return visible;
}

/**
 * Full-viewport "Server Disconnected" overlay. Renders nothing while the
 * WebSocket to the streamware backend is connected; shows after 5s of
 * continuous disconnect (initial mount counts the same as a mid-stream
 * drop). Stacks above any in-progress alert at z-index 9999 with
 * `pointer-events: none` so it can't intercept clicks if the overlay is
 * ever embedded somewhere interactive.
 */
export default function DisconnectedBanner({ connected }: DisconnectedBannerProps) {
  const visible = useDisconnectedAfter(connected, SHOW_AFTER_MS);

  if (!visible) {
    return null;
  }

  return (
    <div
      role="status"
      aria-live="assertive"
      style={{
        position: "fixed",
        inset: 0,
        backgroundColor: "rgba(220, 38, 38, 0.4)",
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        zIndex: 9999,
        pointerEvents: "none",
      }}
    >
      <div
        style={{
          color: "white",
          fontFamily: "Roboto, sans-serif",
          fontWeight: "bold",
          fontSize: "72px",
          textShadow: "0 2px 8px rgba(0, 0, 0, 0.6)",
        }}
      >
        Server Disconnected
      </div>
    </div>
  );
}
