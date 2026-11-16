# Design

## 1. Decisions locked

1. **The CRM is a new bounded context, `crm`.** It owns the `crm` Postgres
   schema and the `crm-worker`. It holds no copy of identity, membership,
   policy, config, billing or audit data; it references orgs and members by
   their opaque Lumen ids, with no cross-context foreign keys.
2. **The browser never talks to Postgres, PostgREST or Supabase.** Supabase
   is used only as Postgres, reached through Hyperdrive from `crm-worker`.
   Supabase Auth, PostgREST and Supabase Storage are removed by M3/M4.
3. **The org is the security boundary.** Every `crm.*` row has
   `org_id UUID NOT NULL`. Every query in `crm-worker` filters by the org of the
   resolved actor, and every request runs in a transaction with
   `SET LOCAL app.org_id`, under RLS policies on `current_setting('app.org_id')`.
   Both layers are mandatory. Another org's record answers `404`, never `403`.
4. **Reuse, never re-implement, Lumen workers**: identity (sessions, OAuth,
   magic links, passwords), membership (members, roles, invitations), policy,
   config (per-org settings), notifications (email), webhooks, billing
   (Polar), metering (seats), events/audit.
5. **The repo is public from the first commit.** No secrets, `.env` files,
   connection strings or real people's data, ever. Seeds are fake.
6. **Attribution.** Atomic CRM is MIT, © 2024-present Francois Zaninotto,
   Marmelab. The notice ships in `THIRD_PARTY_NOTICES.md`; the product is
   called OpenProduct CRM and is never presented as Atomic CRM or as a
   Marmelab product. Upstream telemetry pings are removed.

## 2. Architecture

| Piece | Where | Role |
|---|---|---|
| `apps/crm-web` | Vite + React (ra-core) SPA, `cloudflare-workers-assets-turbo` | Atomic's UI. M0 ships the in-browser demo (fakerest); M3 points it at `api-edge` |
| `crm-facade` | `apps/api-edge` | `/v1/orgs/:orgId/crm/...`; actor resolution, rate limiting and idempotency as in `org-facade`/`project-facade`; forwards to `crm-worker` |
| `apps/crm-worker` | Worker, Hyperdrive + R2 bindings | CRM data, search, merge, attachments, inbound email (Email Worker), favicon fetch, MCP tools |
| `200_crm_core` | `packages/db/src/migrations/` | the `crm` schema, run by `db-migrate` |

The Lumen console's org navigation links to `crm-web` for the current org.

## 3. Data model (port of `supabase/schemas/*.sql` at `aeccb98`)

- Tables: `companies`, `contacts`, `contact_notes`, `deals`, `deal_notes`,
  `tasks`, `tags`, `sales`, `favicons_excluded_domains`, import bookkeeping.
- `configuration` moves to `config-worker` keys per org; `user_invitations`
  moves to `membership-worker`.
- Every index and unique constraint that identifies business data leads with
  `org_id` (a contact email is unique per org).
- `crm.sales` is a profile keyed by Lumen member id (display name, avatar,
  admin flag, secondary emails). Identity and role truth stay upstream.
- Views, functions, triggers and search (`02`, `03`, `04`, `08_*.sql`) are
  ported with `org_id` in every predicate. `auth.uid()`/`auth.users` become
  member ids passed by the worker; `http`, `pg_net` and `pgjwt` move into
  worker code; `unaccent`, `citext` and `digest` stay.

## 4. Feature mapping

| Atomic CRM | OpenProduct CRM |
|---|---|
| Contacts, companies, deals (kanban), notes, tasks, tags | `crm-worker` CRUD + list/filter/sort/paginate in React-admin's shape |
| `ra-supabase-core` dataProvider | `lumenDataProvider` over `api-edge`: `@ilike`, `@in`, `@gte`, `@lte`, nested resources, `q` |
| Supabase authProvider and auth pages | `lumenAuthProvider` over Lumen identity sessions; `src/components/supabase/*` removed |
| Sales, admin role, invitations, `users`/`update_password` functions | membership + policy + identity; only the `crm.sales` profile remains |
| Settings (stages, categories, logos, theme) | `config-worker` keys per org, editable by org admins |
| Merge contacts | `crm-worker` route, one SQL transaction |
| Note attachments | R2, signed upload/download URLs, deleted in the same request as the note |
| Inbound email (`postmark`) | Cloudflare Email Routing → Email Worker in `crm-worker`; one address per org; sender must be a known member |
| Favicon fetch | Worker fetch, cached; respects `favicons_excluded_domains` |
| Global search, activity log, dashboard | ported SQL, org-scoped |
| CSV import/export | client flow kept; bulk-insert route; large files via R2 + Queue |
| MCP server | MCP on Workers with Lumen API keys; typed, org-scoped tools; no free-form SQL |
| Emails to users | `notifications-worker` |
| New | webhooks (`contact.created`, `deal.stage_changed`, `deal.won`, `note.created`), audit, seat metering, plan gating |
| Demo mode (fakerest) | kept as the public demo build of `crm-web` |

## 5. Out of scope

- Free-form SQL over MCP.
- Any Supabase product other than Postgres.
- A second identity system: CRM users are Lumen members.
