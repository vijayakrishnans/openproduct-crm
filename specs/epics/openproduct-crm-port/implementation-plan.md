# Implementation plan

## CRM0 — the spec

Done when this doc set, `ai/context/crm-port-ledger.md` and `WAITING.md` are on `main` (task CRM-1).

## CRM-A — public listing

Done when (task CRM-2):
- `LICENSE` (MIT), `THIRD_PARTY_NOTICES.md`, `SECURITY.md`, `CONTRIBUTING.md` are on `main`;
- the README opens as a product page with the demo link and credits;
- `.gitignore` covers `.env*`, `.dev.vars`, `.wrangler/`, `plan.json`;
- description, homepage, topics, secret scanning, push protection and `main` protection are set.

## M0 — import and attribution

Done when (task CRM-3):
- `apps/crm-web` holds Atomic's `src/`, `demo/`, `public/` at `aeccb98`, in the pnpm/turbo workspace;
- its `component.yaml` (`cloudflare-workers-assets-turbo`) derives verify on PRs and deploy on `main`;
- the demo renders on `openproduct-crm-crm-web-stage` (and prod) as OpenProduct CRM, with no telemetry;
- the console's org navigation links to it.

## M1 — schema

Done when `200_crm_core` runs clean on stage via `db-migrate` and a SQL-level test shows org B cannot see org A's rows.

## M2 — crm-worker and crm-facade

Done when CRUD, lists, filters, sorts, pagination, tags, tasks, notes, merge, search, activity and dashboard pass unit and integration tests, and the isolation matrix shows `404` for org B on every route.

## M3 — frontend swap

Done when `crm-web` runs on `lumenDataProvider`/`lumenAuthProvider` against stage, Atomic's `e2e/*.spec.ts` (login adapted) pass, and a new org gets default deal stages.

## M4 — files and email

Done when upload/download/delete and inbound-email-to-note have end-to-end tests on stage.

## M5 — MCP server

Done when typed, org-scoped tools pass their tests, including cross-org denial.

## M6 — product glue

Done when webhook and audit events, seat metering, plan gating and onboarding are covered by tests and visible in the console.

## M7 — prod and docs

Done when the prod smoke (sign up → org → contact → deal → note with attachment → search) passes and `ai/context/operations.md` and the README describe the CRM.

## Sequencing

CRM0 → CRM-A → M0 can land while nothing else exists. M1 → M2 → M3 is the
critical path; M4–M6 depend on M2; M7 is last.
