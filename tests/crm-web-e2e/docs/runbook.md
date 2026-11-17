# crm-web-e2e — runbook

## When it runs

In CI on a plan that includes this component (a change under
`tests/crm-web-e2e`), with the `verify` profile. Run it by hand after a change
to `apps/crm-web`, `apps/crm-worker` or the edge's `crm-facade`.

## Common failures

- **Every test fails at "Sign-in code"**: the API under test does not return
  codes inline. Point `CRM_E2E_API_URL` at stage or a local stack.
- **Timeouts on stage**: creating a user and an organization takes several
  seconds each there; a test takes about 40 seconds. A `429` in the trace
  means the edge's rate limit was hit: run fewer specs at once.
- **A CORS error in the browser console**: the app's origin is not one
  api-edge allows (its own environment's crm-web origin, or localhost).
