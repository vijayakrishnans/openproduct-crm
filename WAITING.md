# Waiting on a human

Steps an agent cannot take. Each says what to do and the signal the agent
checks for before it carries on.

## Open

### Sign-in with Google and GitHub: create the OAuth apps and add their keys (owner)

- **Why:** the code is in place and the buttons appear on the sign-in page by
  themselves, but only for a provider whose keys exist. On 2026-11-18
  `GET /v1/auth/oauth/providers` answered an empty list on stage and prod.
  (The client ids that used to sit in the identity worker's config came with
  the baseline and belonged to someone else's OAuth apps; they are gone.)
- **Steps:**
  1. **GitHub:** Settings → Developer settings → OAuth Apps → New OAuth App,
     once per environment (GitHub allows one callback URL per app).
     Homepage `https://www.brokecrm.cloud` (stage: `https://stage.brokecrm.cloud`).
     Authorization callback URL:
     `https://openproduct-crm-api-edge-prod.vijayakrishnan12994.workers.dev/v1/auth/oauth/github/callback`
     (stage: the same with `-stage`). Generate a client secret.
  2. **Google:** Google Cloud console → APIs & Services → Credentials →
     Create credentials → OAuth client ID → Web application. Authorized
     redirect URIs: the two URLs above with `google` in place of `github`
     (one client can hold both). The consent screen needs the app name, a
     support email and the `email` and `profile` scopes; publish it, or only
     listed test users can sign in.
  3. **Orunbase secrets**, for each of `stage` and `prod`
     (`orun secrets set <KEY> --org ws_9JAJMRHA --env <env>`, or the
     Orunbase UI): `GITHUB_OAUTH_CLIENT_ID`, `GITHUB_OAUTH_CLIENT_SECRET`,
     `GOOGLE_OAUTH_CLIENT_ID`, `GOOGLE_OAUTH_CLIENT_SECRET`, and
     `OAUTH_STATE_SECRET` (any random string of 16 or more characters, for
     example the output of `openssl rand -hex 32`).
  4. Redeploy `identity-worker` so it picks the secrets up: say so, and the
     agent merges a one-line redeploy marker.
- **Unblock signal:** `GET <api>/v1/auth/oauth/providers` lists `github` and
  `google`, and "Continue with Google" on https://www.brokecrm.cloud/#/login
  signs a person in.

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

- **Prod sign-in by email (2026-11-18):** `brokecrm.cloud` was onboarded to
  Cloudflare Email Sending (the account is on Workers Paid), prod sends from
  `no-reply@brokecrm.cloud` (#34), and the owner received a code and signed in
  on https://www.brokecrm.cloud. The agent did not send a test email itself.

- **Listed on openproduct.live (2026-11-17):** the owner published it through
  Orunbase as `atomic-crm`: https://openproduct.live/atomic-crm.

- **Supabase databases unreachable (2026-11-17):** the owner resumed the
  paused stage and prod projects the same day; they came back under the same
  project refs, so nothing was recreated. `GET /health` on api-edge answers
  `200` with `database reachable:true` on stage and prod, and CRM-4's stage
  check (create an org, list its members) passed.

- Cloudflare, GitHub and Supabase connections: inherited from the account;
  nothing to click.
