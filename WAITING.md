# Waiting on a human

Steps an agent cannot take. Each says what to do and the signal the agent
checks for before it carries on.

## Open

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

### A domain for inbound email (blocks M4's inbound-email check on stage and prod)

- **Why:** crm-worker turns an email sent to an organization's inbound address
  into notes (M4). The code is deployed and tested, but mail only reaches it
  through Cloudflare Email Routing, which needs a domain on this Cloudflare
  account. It can be the same domain as the sending domain above.
- **Steps:** add the domain to the Cloudflare account, enable Email Routing
  on it (Email → Email Routing), and say which subdomains to use for stage and
  prod. The routing rule itself is three clicks, in
  `apps/crm-worker/docs/runbook.md`; say if the agent should set
  `VITE_INBOUND_EMAIL` so the profile page shows each organization's address.
- **Unblock signal:** the domain shows Email Routing as enabled in the
  Cloudflare account, and the owner has named the subdomains.

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

- **Paid plans:** a Polar connection, to sell plans. Not needed for the CRM's
  plan limit (M6): entitlement checks read the plan catalog in the database,
  and every organization starts on the free tier.

## Done

- **Supabase databases unreachable (2026-11-17):** the owner resumed the
  paused stage and prod projects the same day; they came back under the same
  project refs, so nothing was recreated. `GET /health` on api-edge answers
  `200` with `database reachable:true` on stage and prod, and CRM-4's stage
  check (create an org, list its members) passed.

- Cloudflare, GitHub and Supabase connections: inherited from the account;
  nothing to click.
