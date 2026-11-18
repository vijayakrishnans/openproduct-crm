import { StrictMode, lazy, Suspense } from "react";
import { createRoot } from "react-dom/client";
import "./index.css";

// One build, two apps. `/?demo` runs the whole CRM in the browser on
// generated, fake data (no account, no backend); anything else is the real
// CRM on the Lumen API. Each is loaded on demand, so neither pays for the
// other.
const isDemo = new URLSearchParams(window.location.search).has("demo");
const App = lazy(() => (isDemo ? import("../demo/App.tsx") : import("./App.tsx")));

const mount = () => {
  // The landing page is done once the app starts: take it out of the page, so
  // it cannot be found, focused or read behind the app.
  document.getElementById("landing")?.remove();
  createRoot(document.getElementById("root")!).render(
    <StrictMode>
      <Suspense fallback={null}>
        <App />
      </Suspense>
    </StrictMode>,
  );
};

// index.html decides, before anything loads, whether this visit gets the
// landing page or the app (see the script in its <head>). On the landing page
// the app is not started: unauthenticated, it would redirect to the sign-in
// form. It starts when the visitor follows a link into the app (#/login).
const root = document.documentElement;
const isRoute = () => !["", "#", "#/"].includes(window.location.hash);
if (root.getAttribute("data-mode") === "landing") {
  const start = () => {
    if (!isRoute()) return;
    window.removeEventListener("hashchange", start);
    root.setAttribute("data-mode", "app");
    mount();
  };
  window.addEventListener("hashchange", start);
} else {
  mount();
}
