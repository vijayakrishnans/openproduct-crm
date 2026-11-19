import { defineConfig, devices } from "@playwright/test";

// The suite drives crm-web in Chromium against a real API (stage by default):
//   PLAYWRIGHT_BASE_URL  a deployed crm-web to test; when unset, the suite
//                        serves apps/crm-web locally, pointed at CRM_E2E_API_URL
//   CRM_E2E_API_URL      the api-edge to use (fixtures and the local app)
// The API must hand out sign-in codes inline (identity's debug delivery), which
// stage does and prod never will.
export const API_URL =
  process.env.CRM_E2E_API_URL ?? "https://openproduct-crm-api-edge-stage.vijayakrishnan12994.workers.dev";

const baseURL = process.env.PLAYWRIGHT_BASE_URL;
const LOCAL_URL = "http://127.0.0.1:5175";
const proxy = process.env.HTTPS_PROXY;

export default defineConfig({
  testDir: "./src",
  // Every test signs up its own user and organization, so tests never share
  // data and can run side by side. Serially the suite took ~20 minutes in CI.
  fullyParallel: true,
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 1 : 0,
  // Three browsers at once: stage caps sign-ins at 10 a minute per address,
  // and the fixtures sign each test's user in through the API.
  workers: 3,
  reporter: "list",
  timeout: 180_000,
  expect: { timeout: 20_000 },
  use: {
    baseURL: baseURL ?? LOCAL_URL,
    trace: "on-first-retry",
    screenshot: "only-on-failure",
    actionTimeout: 20_000,
    ...(proxy ? { proxy: { server: proxy, bypass: "127.0.0.1,localhost" } } : {}),
  },
  projects: [{ name: "chromium", use: { ...devices["Desktop Chrome"] } }],
  ...(baseURL
    ? {}
    : {
        webServer: {
          command: "pnpm --filter @saas/crm-web exec vite --port 5175 --host 127.0.0.1 --strictPort",
          url: LOCAL_URL,
          reuseExistingServer: !process.env.CI,
          timeout: 120_000,
          env: { VITE_API_URL: API_URL },
        },
      }),
});
