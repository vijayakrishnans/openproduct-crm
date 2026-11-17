# crm-worker

Cloudflare Worker for the CRM bounded context: org-scoped companies, contacts,
deals, notes, tasks, tags, sales profiles, merge, search, the activity log and
the dashboard summary.

Part of the openproduct-crm runtime: a Cloudflare Worker deployed per
environment (`stage`, `prod`; `dev` is verify-only). Not publicly routable — reached only through `api-edge` service bindings.

## Routes

All under `/v1/organizations/:orgId/crm`, forwarded by `api-edge`'s
`crm-facade`:

| Route | What it does |
|---|---|
| `GET /:resource` | list: `page`, `perPage` (≤ 1000), `sort`, `order`, and `filter` (a JSON object) |
| `POST /:resource` | create |
| `GET /:resource/:id` | read one |
| `PATCH` or `PUT /:resource/:id` | update the fields given |
| `DELETE /:resource/:id` | delete; answers the removed record |
| `POST /contacts/merge` | `{ loserId, winnerId }`, one transaction |
| `GET /search?q=&resources=&limit=` | global search |
| `GET /dashboard` | counts and deal totals for the org |
| `GET /sales/me` | the caller's CRM profile, created on first use |

Resources: `companies`, `contacts`, `contact_notes`, `deals`, `deal_notes`,
`tasks`, `tags`, `sales` (read and update only), and the read-only
`companies_summary`, `contacts_summary` and `activity_log`.

Filter keys are `field` or `field@operator`, with `eq`, `neq`, `gt`, `gte`,
`lt`, `lte`, `like`, `ilike`, `in`, `is`/`isnot` (null) and `cs` (array
contains); `q` is a full-text search of the resource.

## Depends on

- **membership-worker** — Cloudflare Worker for the Membership org runtime
- **policy-worker** — Cloudflare Worker for policy authorization decisions

## Depended on by

- **api-edge** — Cloudflare Worker for the API edge Runtime
