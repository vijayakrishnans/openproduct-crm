# Implementation status

As-built ≠ intent. This file records what actually shipped and where it
departs from [design.md](design.md).

| Milestone | State | PR |
|---|---|---|
| CRM0 the spec | done | #10 |
| CRM-A public listing | done | #13 |
| M0 import and attribution | done | #12, #14 (and #11, the multi-tenant profile) |
| M1 schema | done | #15 |
| M2 crm-worker and crm-facade | done | #16, #18 |
| M3 frontend swap | done | #19, #20 |
| M4 files and email | worker side built; not merged | |
| M5 MCP server | | |
| M6 product glue | | |
| M7 prod and docs | | |

## Departures from design.md

- `pnpm-workspace.yaml` carries `packageExtensions` so the console and
  crm-web resolve their own React types and zod (M0).
- Contact emails are not unique per org (M1). Upstream keeps them in a JSON
  array and relies on merge to deduplicate; a uniqueness rule would break
  import. The per-org unique keys are the sales profile's subject and email
  and an excluded favicon domain.
- No import bookkeeping table yet (M1). Upstream's CSV import is a client
  flow with no table; bookkeeping lands with the bulk-insert route.
- `favicons_excluded_domains` is per org, not global (M1), like every other
  `crm` table. crm-worker seeds an org's defaults.
- Two triggers upstream does not have (M1): `contacts.tags` and
  `deals.contact_ids` may only hold ids of the row's own org, and deleting a
  contact removes it from its deals.
- `crm.sales.email` is `text`, not `citext` (M1).
- One generic route set serves every resource (M2): `/crm/:resource` and
  `/crm/:resource/:id`, driven by the table in
  `apps/crm-worker/src/resources.ts`, instead of a handler per resource.
- The dashboard route returns counts and deal totals per stage (M2); the
  charts upstream draws from full lists stay client-side until M3 decides
  what they need.
- No route yet for `favicons_excluded_domains` (M2); it lands with favicon
  fetch in M4.
- The browser calls api-edge directly rather than through routes on the
  crm-web Worker (M3); `crm-web` stays a static-assets Worker.
- The `ra-supabase-language-*` message packages remain as dependencies (M3):
  the shared UI kit reads a few of their translation keys. No Supabase client,
  key or URL is left.
- The e2e specs run desktop only, and against a stage API from a locally
  served app or a deployed one (M3). Upstream's `signup.spec` is replaced by
  `signIn.spec`: an instance is no longer a single team.
- Inviting a user from the CRM returns a placeholder row until they sign in
  (M3); upstream created the account at once.
- No signed upload or download URLs (M4): files go through crm-worker with
  the session. No public, unauthenticated file route exists.
- No Gravatar and no favicon.show (M4): only the domain's own favicon.
- Inbound email requires a DMARC pass (M4); upstream trusted its mail
  provider's webhook secret instead.
- No notification emails yet (M4): upstream sends none besides auth mail,
  which identity-worker already owns.
