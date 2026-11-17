import { StrictMode, lazy, Suspense } from "react";
import { createRoot } from "react-dom/client";
import "./index.css";

// One build, two apps. `/?demo` runs the whole CRM in the browser on
// generated, fake data (no account, no backend); anything else is the real
// CRM on the Lumen API. Each is loaded on demand, so neither pays for the
// other.
const isDemo = new URLSearchParams(window.location.search).has("demo");
const App = lazy(() => (isDemo ? import("../demo/App.tsx") : import("./App.tsx")));

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <Suspense fallback={null}>
      <App />
    </Suspense>
  </StrictMode>,
);
