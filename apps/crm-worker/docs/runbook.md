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

## Tests

`tests/crm-worker` runs every route against a real Postgres (PGlite) with the
migration applied, including the cross-org isolation matrix: a member of
another org gets `404` on every route and changes nothing.
