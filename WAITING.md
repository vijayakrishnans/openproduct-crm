# Waiting on a human

Steps an agent cannot take. Each says what to do and the signal the agent
checks for before it carries on.

## Open

### Every Supabase database is unreachable (blocks M1 onward; prod and stage APIs are degraded)

- **Found:** 2026-11-17 ~04:00 +07. `GET /health` on api-edge answers `503
  degraded, database reachable:false` on stage and prod. The project hosts
  `db.adfhlqhmkxjckcoldeas.supabase.co` (stage) and
  `db.mqofjfuuucsiqcsrwgey.supabase.co` (prod) return NXDOMAIN from public
  DNS. So do the projects of every other Lumen product on this account
  (kuyil, multi-tenant-saas-2, multi-tenant-lms, ai-chatbot-6), while
  `supabase.co` resolves and status.supabase.com reports no incident. The
  Orun Supabase connection still shows active.
- **Likely causes:** the projects were paused or deleted in the Supabase
  organization, or the organization hit a plan or billing limit.
- **Steps:** open the Supabase dashboard for the organization connected to
  Orun and check the stage and prod projects for `openproduct-crm`. Restore
  or unpause them, or say they are gone; then the agent re-runs the
  `supabase` and `db-migrate` components to recreate them.
- **Unblock signal:** `curl -s -o /dev/null -w '%{http_code}'
  https://openproduct-crm-api-edge-stage.vijayakrishnan12994.workers.dev/health`
  answers `200`.
- **Also blocked by this:** the console's deploy smoke on `main` (it checks
  api-edge `/health`), and CRM-4's stage check (creating an org needs the
  database).

### A sending domain for prod sign-in emails (blocks prod sign-in)

- **Why:** prod sends magic-link codes through Cloudflare Email Service from
  `no-reply@mail.openproduct-crm.example.com`, a placeholder. Until a real,
  verified sending domain replaces it, nobody can sign in on prod. Stage is
  unaffected (it returns codes inline; see the risk below).
- **Steps:** pick a domain you control on this Cloudflare account, onboard it
  to Cloudflare Email Service (Email → Email Sending), and say which address to
  send from. The agent then sets `EMAIL_FROM_ADDRESS` for prod in
  `apps/notifications-worker/wrangler.template.jsonc` in a PR.
- **Unblock signal:** the domain is listed as verified for sending in the
  Cloudflare account, and the owner has named the address.

### Move the repository to the OpenProduct GitHub org (optional)

- **Why:** the brief named `openproduct/openproduct-crm`; the build's GitHub
  identity is not a member of that org.
- **Steps:** add `vijayakrishnans` to the OpenProduct org with permission to
  create repositories, install the Orun GitHub App on the org and add it to
  the `openproduct-crm` workspace, then transfer the repository.
- **Unblock signal:** `gh api /orgs/openproduct/members/vijayakrishnans`
  answers 204 and `orun integrations list --workspace ws_9JAJMRHA` shows a
  GitHub connection for `OpenProduct`.

## Coming up (not needed yet)

- **M4 inbound email:** a domain on Cloudflare with Email Routing enabled, to
  give each org an inbound address.
- **M6 billing:** a Polar connection for plan gating.

## Done

- Cloudflare, GitHub and Supabase connections: inherited from the account;
  nothing to click.
