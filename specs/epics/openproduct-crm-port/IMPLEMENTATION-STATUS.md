# Implementation status

As-built ≠ intent. This file records what actually shipped and where it
departs from [design.md](design.md).

| Milestone | State | PR |
|---|---|---|
| CRM0 the spec | done | #10 |
| CRM-A public listing | done | #13 |
| M0 import and attribution | done | #12, #14 (and #11, the multi-tenant profile) |
| M1 schema | done | #15 |
| M2 crm-worker and crm-facade | built; not merged | |
| M3 frontend swap | | |
| M4 files and email | | |
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
