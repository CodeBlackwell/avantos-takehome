import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import "./index.css";
import { App } from "./App";

// React 18 entry. `StrictMode` double-invokes effects/state initializers
// in dev to surface side-effect bugs — the boot effects in `App` and the
// localStorage mirroring in `useMappings` are both designed to be
// idempotent under double invocation.
createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <App />
  </StrictMode>,
);
