# OpenProduct CRM: Atomic CRM on Lumen

**Port Atomic CRM's features onto the Lumen baseline as a public, multi-tenant,
edge-native CRM. The web app is Atomic's React-admin SPA (`apps/crm-web`); the
data lives in a new `crm` schema behind a new `crm-worker`, reached only
through `api-edge` org-scoped routes; identity, membership, policy, config,
notifications, webhooks, billing, metering and audit stay with the Lumen
workers that already own them. Every CRM row carries an `org_id`, and the org
is the security boundary everywhere: routes, search, imports, exports, files,
inbound email, MCP tools and background jobs.**

## Status

| | |
|---|---|
| State | Shipped: live as BrokeCRM at https://www.brokecrm.cloud. Open: the prod smoke (credential), inbound email (Email Routing) |
| Cluster | `CRM`, milestones CRM0, CRM-A, M0–M7 (epic `EP-7`, slug `openproduct-crm-port`) |
| Owning components | `apps/crm-web`, `apps/crm-worker`, `apps/api-edge` (crm-facade), `packages/db` (`200_crm_core`), `tests/crm-worker`, `tests/crm-web-e2e` |
| Builds on | `lumen baseline-v33`; Atomic CRM `aeccb98` (MIT) |
| Changes | adds the `crm` bounded context; no change to other contexts' tables |
| Decisions locked | see [design.md](design.md) §1 |
| Gate | CI green on every PR; the cross-org isolation matrix from M2 on |
| Shipped as | pull requests #10–#26; after M7, #27–#53; see the ledger |

## Read order

1. [design.md](design.md): architecture, data model, feature mapping, tenancy rules.
2. [implementation-plan.md](implementation-plan.md): milestones and their done-when facts.
3. [risks-and-open-questions.md](risks-and-open-questions.md)
4. [IMPLEMENTATION-STATUS.md](IMPLEMENTATION-STATUS.md): as built.

The running progress record is [`ai/context/crm-port-ledger.md`](../../../ai/context/crm-port-ledger.md).

## Milestones at a glance

| Milestone | What is true after it |
|---|---|
| CRM0 the spec | this doc set, the ledger and `WAITING.md` are on `main` |
| CRM-A public listing | licence, notices, security policy, public README, repo protections |
| M0 import | Atomic's web app is `apps/crm-web`; its in-browser demo is live on stage and prod |
| M1 schema | `crm` schema with `org_id` everywhere, RLS, ported views/functions/search |
| M2 crm-worker | org-scoped CRUD, search, merge, activity, dashboard behind `api-edge` |
| M3 frontend swap | `lumenDataProvider` + `lumenAuthProvider`; Atomic's e2e specs pass on stage |
| M4 files and email | R2 attachments, favicons, inbound email to notes, notifications |
| M5 MCP | typed, org-scoped MCP tools on Lumen API keys |
| M6 product glue | webhooks, audit, seat metering, plan gating, onboarding |
| M7 prod and docs | prod smoke passes; operations docs and README updated |
