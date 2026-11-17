# crm-worker — architecture

A `cloudflare-worker-turbo` component: TypeScript Worker built by the turbo pipeline
from `apps/crm-worker`, deployed per environment by its CI lane.

## Bindings and wiring

- **Service bindings** → `membership-worker`, `policy-worker` —
  in-process RPC to sibling Workers; no public hops between contexts.
- **R2** `ATTACHMENTS` → `openproduct-crm-crm-attachments-<env>`, created by the
  component's pre-deploy step when missing. Keys are
  `<org uuid>/<file uuid>/<file name>`.
- **Hyperdrive** `PLATFORM_DB` → the Supabase Postgres, schema `crm`
  (migration `200_crm_core`).
- **Wired configuration** (resolved at deploy time from job-output
  secrets published by the infrastructure terraform; names only):
  `WIRING_CLOUDFLARE_HYPERDRIVE_PROD`, `WIRING_CLOUDFLARE_HYPERDRIVE_STAGE`.

## Tenancy: two layers, both mandatory

The org is the security boundary. A request passes, in order:

1. **Membership.** The actor (set by `api-edge`, never by the client) must
   hold a role in the org of the path, per `membership-worker`. If not, every
   path under that org answers `404`, whatever the method.
2. **Policy.** `policy-worker` decides `organization.crm.read` (viewer and
   up), `organization.crm.write` (builder and up) or
   `organization.crm.manage` (owner, admin). A member without the permission
   gets `403`.
3. **Explicit org filter.** Every statement the worker issues carries
   `org_id = $1`; identifiers come from `src/resources.ts`, values are bound
   parameters.
4. **Row-level security.** Every request runs in one transaction as the
   `crm_app` role (no `BYPASSRLS`) with `app.org_id` and `app.subject_id` set
   for that transaction (`src/db.ts`). The policies of the `crm` schema admit
   only that org's rows, so a statement that forgot its filter still sees
   nothing of another org.

Another org's record is indistinguishable from a missing one: `404`.

A response that is not a success rolls its transaction back.

## Boundaries

This Worker owns its bounded context: its data, its invariants, its
API surface (exposed to the fleet through the edge). Cross-context calls
go over service bindings; nothing else may reach into its storage. It keeps
no copy of identity or membership data beyond the `crm.sales` display profile
of each member who has used the CRM.
