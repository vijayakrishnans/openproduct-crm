# crm-worker — runbook

## How it deploys

Merges to `main` converge automatically: CI plans changed components
(`orun plan --changed`) and runs this component's lane via
`orun run --remote-state` with credential-free OIDC auth. The convergence
run is the deployment; the DAG orders this component after everything it
depends on. Failed lanes resume with `gh run rerun --failed`.

## Rollback

Revert the offending commit on `main`; the next convergence applies the
previous desired state. There is no out-of-band mutation to undo — the
repo is the source of truth.

## Verify

The deploy lane's own verify/smoke is the gate. End-to-end behavior is
exercised through `api-edge` (this Worker has no public URL).

## Common failures

- **Missing `WIRING_*` / `SUPABASE_*` secret at deploy**: the
  infrastructure terraform upstream has not applied — check that lane
  first; within one convergence run the DAG guarantees order.
- **Service-binding target missing (Cloudflare 10143)**: the target
  Worker does not exist yet on this account. Every binding holder waits on
  `policy-worker`, whose pre-deploy uploads a placeholder for each missing
  target (`tooling/deploy/fleet-stubs.mjs`), so this should not happen — if
  it does, this component does not declare `dependsOn: policy-worker` with
  `mode: enforced`.
- **Smoke fails right after a first deploy**: a brand-new workers.dev
  route can 4xx for a few seconds; the lane already retries — persistent
  failure means a real regression.
- **Every CRM route answers 500 with `permission denied to set role
  "crm_app"`** (in the Worker's logs): the database role Hyperdrive connects
  as is not a member of `crm_app`. Migration `200_crm_core` grants it to the
  role that ran the migration and to `postgres`; grant it to the connecting
  role (`GRANT crm_app TO <role>`).
- **A CRM route answers 404 for a member**: the membership or policy binding
  did not answer, which the worker treats as "not a member". Check
  `GET /health` on the worker's checks and the two bound Workers.

- **Deploy fails with `R2 bucket '…-crm-attachments-<env>' not found`
  (code 10085)**: the attachments bucket does not exist on this account. The
  deploy token cannot create it (it has no R2 permission). Create it once in
  the Cloudflare dashboard (R2 → Create bucket) with exactly that name, then
  re-run the failed lane. This happened on the first deploy, 2026-11-17.

- **Creating a contact answers 412**: the organization is at its plan's
  `limit.crm_contacts`. The response names the limit. Raise it by assigning a
  plan with a higher limit in billing.
- **Creating a contact answers 503 "Billing service unavailable"**:
  billing-worker did not answer the entitlement check, or refused the caller
  (`crm-worker` must be in its `ALLOWED_INTERNAL_CALLERS`). The check fails
  closed. Everything else in the CRM keeps working.

## Receiving CRM events as webhooks

In the console, add a webhook endpoint for the organization and subscribe it
to `crm.contact.created`, `crm.note.created`, `crm.deal.stage_changed`,
`crm.deal.won`, to a prefix such as `crm.deal.*`, or to `*`. Deliveries go
out within about a minute (webhooks-worker's cron) and are listed in the
endpoint's delivery history.

## Connecting an assistant over MCP

1. In the console, an owner or admin creates an API key for the organization
   (role `viewer` for read-only, `builder` to let the assistant write). The
   secret is shown once.
2. Point the MCP client at
   `https://<api-edge host>/v1/organizations/<org_…>/crm/mcp` with the header
   `Authorization: Bearer <the key>`. The CRM's profile page shows the URL.
3. `tools/list` should answer thirteen tools. A `404` means the key does not
   belong to that organization; a tool result with `forbidden` means its role
   cannot write.

## Turning inbound email on

Needs a domain on this Cloudflare account with Email Routing enabled (see
`WAITING.md`). Then, per environment:

1. In the dashboard: the domain → Email → Email Routing → Routing rules →
   Catch-all address → action "Send to a Worker" →
   `openproduct-crm-crm-worker-<env>`. Use a subdomain per environment (for
   example `in.<domain>` for prod and `in-stage.<domain>` for stage).
2. An organization's address is then `<org public id>@<that subdomain>`, where
   the public id is the `org_…` in its CRM URL. A readable prefix is allowed:
   `sales+org_…@…`.
3. Send a message from a member's address with that address in Cc and a
   contact in To: the contact gets a note. A rejected message bounces with the
   reason (unknown address, DMARC, sender not a member, no contact).

## Tests

`tests/crm-worker` runs every route against a real Postgres (PGlite) with the
migration applied, including the cross-org isolation matrix: a member of
another org gets `404` on every route and changes nothing. `platform.test.ts`
covers events, seats and the contact limit. `mcp.test.ts` drives
the MCP endpoint, including another organization's key. `files.test.ts`
covers attachments and favicons against an in-memory bucket and a fake
fetch; `inbound-email.test.ts` feeds raw RFC 822 messages to the handler.
