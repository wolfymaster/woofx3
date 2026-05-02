import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import AlertOverlay from "./AlertOverlay";
import "./styles.css";

const container = document.getElementById("root");
if (!container) {
  throw new Error("#root not found");
}
createRoot(container).render(
  <StrictMode>
    <AlertOverlay />
  </StrictMode>,
);
