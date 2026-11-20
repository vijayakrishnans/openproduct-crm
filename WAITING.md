# Waiting on a human

Steps an agent cannot take. Each says what to do and the signal the agent
checks for before it carries on.

## Open

### Terms and privacy policy: three blanks and a review (owner)

- **Why:** https://www.brokecrm.cloud/terms.html and `/privacy.html` are
  live as plain-language drafts written by the agent from what the product
  does. They are not legal advice and no lawyer has read them.
- **Blanks the owner must fill:**
  1. **Who operates the service.** The pages say "the maintainers of
     vijayakrishnans/openproduct-crm". A legal name (a person or a company)
     belongs there.
  2. **A contact address.** The pages send requests to GitHub issues, with a
     note not to post personal data. A mailbox such as
     `privacy@brokecrm.cloud` is better; it needs Email Routing on the
     domain.
  3. **Governing law.** The terms name none.
- **Promises in them the owner must keep:** delete an account's or
  organization's data within 30 days of a request (there is no button for
  it; it is done by hand in the database), give 30 days' notice before
  ending the service, and tell users of a breach.
- **Also:** Google's OAuth consent screen asks for a privacy policy URL and
  a terms URL; these two are the ones to give.
- **Unblock signal:** the owner names the three, and says whether a lawyer
  should look before they stay.

### The prod smoke (needs a prod credential)

- **Why:** prod sign-in works (see Done), so `tooling/smoke/crm-smoke.mjs`
  can run against prod, but it needs a credential of a prod organization and
  the agent has none.
- **Steps:** create an API key with the builder role in the console for a
  prod organization, and hand it over through the secure credential form
  (never in chat). The agent runs the smoke with it; it creates a company,
  a contact, a deal and a note, checks them, and deletes them.
- **Unblock signal:** the smoke prints "CRM smoke passed" against prod.

### Email Routing for inbound email (blocks M4's inbound-email check on stage and prod)

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
- **A possible cause, since fixed:** another session's CRM-18 (#51,
  2026-11-19) fixed the same screen for a deal that has no amount or no
  contacts, such as one created through the API or the MCP server. If the
  deal that was dragged was one of those, this may be closed; nobody has
  confirmed it.
- **Unblock signal:** an error message or a sequence that reproduces it, or
  the owner dragging deals again without seeing it.

### The openproduct.live listing: indexing (openproduct.live's side)

- **Why:** https://openproduct.live/broke-crm is published, but `indexable`
  is `false` and the page carries `noindex`. (Its licence, language and last
  commit are now read from GitHub: `Apache-2.0`, `TypeScript`, checked
  2026-11-19.)
- **Indexing:** openproduct.live's published rule (`listing.indexable`): a
  maker's first listing is not indexed until one of theirs has been reviewed
  by a person there, and the decision is made at publication and not
  revisited. So a review alone may not change this listing; publishing it
  again after the review may be needed.
- **Unblock signal:** `GET https://api.openproduct.live/v1/products/broke-crm`
  shows `indexable.value` `true`.

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

- **The MCP server has one address (2026-11-19):** #57, #58.
  `https://mcp.brokecrm.cloud/mcp` (stage `mcp-stage.brokecrm.cloud`).
  Checked with API keys on stage and without a credential on prod. Still
  worth doing once: add it as a connector in an assistant on prod, sign in
  with OAuth and choose the organization.

- **Sign-in with Google and GitHub works (2026-11-19):** the owner created
  the OAuth apps and seeded the keys in Orunbase (#44, #45), sign-in moved
  to the API's own domain (#50), and the owner signed in on prod with each
  provider. Still the owner's, if wanted: Google shows `api.brokecrm.cloud`
  on its consent screen; showing the name and a logo needs Google's branding
  verification (Google Cloud console, Branding).
- **Invitation emails carry a link (2026-11-19):** #49. Not yet confirmed
  with a real email.
- **GitHub sign-in shows the account picker (2026-11-19):** #53, after the
  owner noticed GitHub signing them in with no screen. Not yet confirmed by
  the owner.


- **Prod sign-in by email (2026-11-18):** `brokecrm.cloud` was onboarded to
  Cloudflare Email Sending (the account is on Workers Paid), prod sends from
  `no-reply@brokecrm.cloud` (#34), and the owner received a code and signed in
  on https://www.brokecrm.cloud. The agent did not send a test email itself.

- **Listed on openproduct.live (2026-11-17):** the owner published it through
  Orunbase as `atomic-crm`; renamed to `broke-crm` on 2026-11-19:
  https://openproduct.live/broke-crm. The old address now answers `404`.

- **Supabase databases unreachable (2026-11-17):** the owner resumed the
  paused stage and prod projects the same day; they came back under the same
  project refs, so nothing was recreated. `GET /health` on api-edge answers
  `200` with `database reachable:true` on stage and prod, and CRM-4's stage
  check (create an org, list its members) passed.

- Cloudflare, GitHub and Supabase connections: inherited from the account;
  nothing to click.
