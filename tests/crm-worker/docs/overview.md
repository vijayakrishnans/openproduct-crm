# crm-worker-tests

Verification suite for `crm-worker`.

A verify-only component: its lane runs this suite against `crm-worker` on every
plan that includes it. Nothing deploys from here — a red lane blocks the
convergence, which is the point.

The component subscribes to `dev` with the `verify` profile, so the suite
runs in CI on every plan that includes it. It needs no database service: it
runs the `200_crm_core` migration on PGlite (Postgres compiled to
WebAssembly) and drives every route of the worker against it.

- `src/crm-worker.test.ts` — behaviour: CRUD, lists, filters, sorts,
  pagination, tags, tasks, notes, merge, search, activity, dashboard, roles.
- `src/isolation-matrix.test.ts` — the tenancy gate: on every route, a member
  of another org gets `404` and changes nothing. The route list is derived
  from the worker's resource table.

## Gates

- `pnpm exec turbo run build --filter=./` — build
- `pnpm exec turbo run typecheck --filter=./` — typecheck
- `pnpm exec turbo run test --filter=./` — the suite itself
