import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import AlertOverlay from "./AlertOverlay";
import SceneOverlay from "./SceneOverlay";
import "./styles.css";

const container = document.getElementById("root");
if (!container) {
  throw new Error("#root not found");
}

// Lightweight pathname routing — kept inline so the SPA stays a
// single-page bundle without pulling in a router dependency. The
// shell page is the same HTML for both routes; this picks which
// React component takes over the root.
function selectRoot(pathname: string) {
  if (pathname === "/overlay/scene" || pathname.startsWith("/overlay/scene/")) {
    return <SceneOverlay />;
  }
  return <AlertOverlay />;
}

createRoot(container).render(
  <StrictMode>{selectRoot(location.pathname)}</StrictMode>,
);
