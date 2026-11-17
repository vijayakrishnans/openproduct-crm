# crm-web-e2e — architecture

A `turbo-package` component: Playwright (`@playwright/test`) with one Chromium
project, one worker.

- `playwright.config.ts` — where the app and the API are. Without
  `PLAYWRIGHT_BASE_URL` it starts `apps/crm-web`'s dev server on port 5175
  with `VITE_API_URL` set to the API under test.
- `src/fixtures.ts` — `workspace`: a fresh user and organization per test,
  with helpers to seed companies, contacts, notes and a teammate through
  `/v1/organizations/:orgId/crm`; `signIn(page, email)`: the adapted login.
- `run.mjs` — in CI, installs the Chromium this Playwright version expects,
  then runs the suite.

Every test leaves its organization behind on the API it ran against. Stage
holds only fake data, and these organizations are named `E2E …`.
