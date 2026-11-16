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
