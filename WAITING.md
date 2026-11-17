# Waiting on a human

Steps an agent cannot take. Each says what to do and the signal the agent
checks for before it carries on.

## Open

### A sending domain for prod sign-in emails (blocks prod sign-in and the M7 prod smoke)

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
- **Also blocked by this:** M7's prod smoke. `tooling/smoke/crm-smoke.mjs`
  passes on stage and stops on prod at sign-up, because prod emails its
  codes and has nowhere to send them from. Once someone can sign in on
  prod, run it with `CRM_SMOKE_TOKEN` and `CRM_SMOKE_ORG`.

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

### The deal-board crash (needs one detail from the owner)

- **Why:** the owner saw "Something went wrong — a client error occurred" on
  `#/deals` on stage while dragging a deal, 2026-11-17. About twenty drag
  variants on stage did not reproduce it. The board was hardened (#28) and a
  real defect with back-to-back moves fixed (#29), but nothing shows that
  screen is gone.
- **Steps:** if it happens again, open the browser console (F12, Console)
  and copy the red error text; or note which deal was moved from which
  column to which, and whether deal stages had been changed in Settings.
- **Unblock signal:** an error message or a sequence that reproduces it.

### The openproduct.live listing: repo facts and indexing (openproduct.live's side)

- **Why:** https://openproduct.live/atomic-crm is published, but its licence,
  language and last commit are empty, and `indexable` is `false`.
- **Repo facts:** the catalog shows what its own check reads from GitHub. On
  2026-11-17 GitHub reported `Apache-2.0` and `TypeScript` for the repository
  while the listing had none of it, so the check had not read this
  repository yet. Nothing in this repository can trigger it.
- **Indexing:** openproduct.live's published rule (`listing.indexable`): a
  maker's first listing is not indexed until one of theirs has been reviewed
  by a person there, and the decision is made at publication and not
  revisited. So a review alone may not change this listing; publishing it
  again after the review may be needed.
- **Unblock signal:** `GET https://api.openproduct.live/v1/products/atomic-crm`
  shows `licence.value` `Apache-2.0` and `indexable.value` `true`.

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

- **Listed on openproduct.live (2026-11-17):** the owner published it through
  Orunbase as `atomic-crm`: https://openproduct.live/atomic-crm.

- **Supabase databases unreachable (2026-11-17):** the owner resumed the
  paused stage and prod projects the same day; they came back under the same
  project refs, so nothing was recreated. `GET /health` on api-edge answers
  `200` with `database reachable:true` on stage and prod, and CRM-4's stage
  check (create an org, list its members) passed.

- Cloudflare, GitHub and Supabase connections: inherited from the account;
  nothing to click.
