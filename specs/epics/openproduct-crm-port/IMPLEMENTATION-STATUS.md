# Implementation status

As-built ≠ intent. This file records what actually shipped and where it
departs from [design.md](design.md).

| Milestone | State | PR |
|---|---|---|
| CRM0 the spec | done | #10 |
| CRM-A public listing | in review | #13 |
| M0 import and attribution | done | #12 (and #11, the multi-tenant profile) |
| M1 schema | blocked: Supabase databases unreachable | |
| M2 crm-worker and crm-facade | | |
| M3 frontend swap | | |
| M4 files and email | | |
| M5 MCP server | | |
| M6 product glue | | |
| M7 prod and docs | | |

## Departures from design.md

- `pnpm-workspace.yaml` carries `packageExtensions` so the console and
  crm-web resolve their own React types and zod (M0).
