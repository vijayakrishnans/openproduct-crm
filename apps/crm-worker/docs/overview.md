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
| `POST /mcp` | the organization's MCP server: one JSON-RPC message per request |
| `POST /attachments?filename=` | upload a file (the raw body, at most 25 MB); answers its `path` |
| `GET /attachments/:uuid/:name` | download a file, always as an attachment |

Resources: `companies`, `contacts`, `contact_notes`, `deals`, `deal_notes`,
`tasks`, `tags`, `sales` (read and update only), and the read-only
`companies_summary`, `contacts_summary` and `activity_log`.

Filter keys are `field` or `field@operator`, with `eq`, `neq`, `gt`, `gte`,
`lt`, `lte`, `like`, `ilike`, `in`, `is`/`isnot` (null) and `cs` (array
contains); `q` is a full-text search of the resource.

## MCP

`POST /v1/organizations/:orgId/crm/mcp` is a Model Context Protocol server
(Streamable HTTP, stateless, JSON responses; no server-sent stream). An
assistant connects with a Lumen API key of the organization as its Bearer
token. The key's role decides what it may do: `viewer` reads, `builder` and
up also write.

Tools: `search`, `list`, `get`, `dashboard` (read); `create_contact`,
`update_contact`, `create_company`, `update_company`, `create_deal`,
`update_deal`, `add_note`, `create_task`, `complete_task` (write). Each has a
closed JSON Schema, checked before anything runs, and calls the same handler
as the matching REST route inside the organization's transaction. There is no
free-form SQL and no tool deletes or merges.

## Files

Note attachments live in R2 (`ATTACHMENTS`). A file's path is relative to its
organization (`<uuid>/<file name>`); the worker alone adds the organization
prefix, so a path cannot name another organization's file. A note lists the
paths its uploads returned. Files are deleted when their note is deleted, when
an update drops them, and when a contact, deal or company takes its notes with
it — after the transaction has committed.

## Favicons

A company saved without a logo gets its website's `/favicon.ico` if the site
serves one, and a contact saved without an avatar the favicon of their email's
domain. Mail providers and the organization's `favicons_excluded_domains` are
skipped. Only the domain itself is asked: no Gravatar, no favicon service.

## Inbound email

The Worker also has an `email` handler: a message sent to
`<org public id>@<inbound domain>` becomes a note on each contact it was
exchanged with (To and Cc, or the original sender of a forward), creating the
contact and its company when new, with the message's files attached. It is
accepted only if it passed DMARC and its From address is the email, or a
secondary email, of an active CRM profile of that organization. It receives
nothing until Email Routing sends a domain's mail to this Worker.

## Depends on

- **membership-worker** — Cloudflare Worker for the Membership org runtime
- **policy-worker** — Cloudflare Worker for policy authorization decisions

## Depended on by

- **api-edge** — Cloudflare Worker for the API edge Runtime
