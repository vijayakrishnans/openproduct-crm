# CRM port ledger

The authoritative progress record for porting Atomic CRM onto this Lumen
product. Read it first on every resume, then `gh pr list --state all` and
`orun baseline new … --status`. Do not redo merged work.

## Summary (2026-11-18)

The product is live as **BrokeCRM** at https://www.brokecrm.cloud (stage:
https://stage.brokecrm.cloud). The repository, Worker names and identity
record keep the name `openproduct-crm`.

Every milestone is merged: Phase A, CRM0, the multi-tenant profile, M0, the
public listing, M1 (the `crm` schema), M2 (`crm-worker`, `crm-facade`), M3
(the web app on the Lumen API), M4 (attachments, favicons, the inbound-email
handler), M5 (MCP), M6 (events, seats, the contact limit) and M7 (the smoke
and the docs). After M7: fixes from the owner's own use (the settings page,
the deal board), the relicensing to Apache-2.0, the openproduct.live listing,
the custom domain, prod sign-in by email, the BrokeCRM name with a landing
page and SEO, and sign-in with Google and GitHub (built, not switched on).
See "After M7" below.

What is not done, and why:

- **Prod sign-in works** since 2026-11-18 (email codes from
  `no-reply@brokecrm.cloud`). The **prod smoke** still needs a prod
  credential, **sign-in with Google and GitHub** needs the owner's OAuth
  apps and their keys in Orunbase secrets, and **inbound email** needs Email
  Routing on the domain (WAITING.md).
- The owner saw "Something went wrong" on the deal board while dragging a
  deal. It was **not reproduced**; the board was hardened and two real drag
  defects were fixed, but nothing shows that screen is gone (WAITING.md).
- The openproduct.live listing (https://openproduct.live/broke-crm) is not
  indexed by search engines yet. That is on openproduct.live's side
  (WAITING.md).

## Inputs used

| Input | Value |
|---|---|
| Orun account | `openproduct` (`openproduct-6ny98czp`) |
| Workspace | `openproduct-crm` (`ws_9JAJMRHA`) |
| Repository | https://github.com/vijayakrishnans/openproduct-crm (public) |
| Product name | BrokeCRM for people (since 2026-11-18); `OpenProduct CRM` in the repository's identity record |
| workers.dev subdomain | `vijayakrishnan12994` |
| Lumen | `baseline-v33` (`4cacc01`) |
| Atomic CRM | `aeccb98` (MIT) |
| orun | v2.96.0 |
| Epic | `EP-7` `openproduct-crm-port` (cluster `CRM`) |

## Milestones

| Milestone | Task | State | PR | Merge | Verification |
|---|---|---|---|---|---|
| Phase A bootstrap | BASE-1..8 | done | #1–#3, #5–#9 (#4 closed, redundant) | `b8551b3` | every Lumen phase through 08-docs derived done; console and api-edge 200 on stage and prod; sign-in and personal org on stage verified 2026-11-16 |
| Multi-tenant profile | CRM-4 | done | #11 | `45adb3e` | SOLO_MODE off everywhere; console builds from source. On stage, `POST /v1/organizations` created an org (201) and `GET /v1/organizations/:id/members` listed its owner (200), 2026-11-17 |
| CRM0 the spec | CRM-1 | done | #10 | `053be16` | |
| CRM-A public listing | CRM-2 | done | #13 | `e6760bb` | description, homepage, topics, secret scanning, push protection, private vulnerability reporting and `main` protection (PR + `plan` check) set 2026-11-17 |
| M0 import and attribution | CRM-3, CRM-5 | done | #12, #14 | `9be281f`, `a080b00` | CI green; crm-web answers on stage and prod |
| M1 schema | CRM-6 | done | #15 | `8feacaa` | `200_crm_core` applies twice without error on Postgres 16 as a non-superuser and on PGlite; the SQL isolation tests pass; the `db-migrate` lanes for stage and prod were green on the merge run (their log tail was not readable; M2's stage check is the proof the tables exist) |
| M2 crm-worker and crm-facade | CRM-7 | done | #16, #18 | `afe8b8d`, `32da23e` | `tests/crm-worker`: 225 tests on PGlite, including the isolation matrix. On stage through api-edge, 2026-11-17: a member created and read a company, contact and deal, searched and loaded the dashboard; a member of a second org got `404` on seven routes of the first and `422` when referencing its company. Prod answers `401` without a session; nobody can sign in on prod yet (WAITING.md) |
| M3 frontend swap | CRM-8 | done | #19, #20 | `1c90e81`, `475942e` | Ten ported specs pass in Chromium against the stage API, locally and in CI (`crm-web-e2e`, about 13 minutes there), and the sign-in and onboarding specs pass against the deployed stage app. A new org starts with the default deal stages (no setting stored) |
| M4 files and email | CRM-9 | attachments and favicons done; inbound email waits on a domain | #21, #23 | `a4e78ca`, `4e2c51c` | On stage through api-edge, 2026-11-17: upload `201`, download returns the same bytes as an attachment, another org gets `404` by either route, no session `401`, the file is gone after its note is deleted, and a new company got `https://cloudflare.com/favicon.ico`. `attachments.spec.ts` passes in Chromium against stage. Inbound email: 16 handler tests; not live (WAITING.md) |
| M5 MCP server | CRM-10 | done | #24 | `bfa4051` | `mcp.test.ts`: 14 tests. On stage through api-edge with real API keys, 2026-11-17: `initialize` and `tools/list` (13 tools); a builder key created a contact, found it by search and added a note; a viewer key read it and was refused a write; a malformed id was refused; another organization's key got `404` from the endpoint and `not_found` for the record through its own; no key `401` |
| M6 product glue | CRM-11 | done; webhook delivery and the seat total not observable on stage | #25 | `fbfd85c` | On stage, 2026-11-17, for a new organization: creating a contact, moving a deal to `won` and adding a note produced `crm.contact.created`, `crm.deal.stage_changed`, `crm.deal.won` and `crm.note.created` in `GET /audit` (source `crm-worker`, category `crm`, no note text); subscriptions to `crm.deal.*` and `crm.contact.created` were accepted; the contact was created, so billing-worker answered the limit check. Not observable on stage: webhook deliveries and the `crm_seats` total, because the webhooks dispatcher and the metering rollup run on cron and crons are declared for prod only (free-plan limit of 5 triggers per account). Both are covered by `platform.test.ts` and by the real-driver run, which wrote the seat records |
| M7 prod and docs | CRM-12 | docs and smoke done; prod smoke blocked | #26 | `374612b` | `tooling/smoke/crm-smoke.mjs` passes on stage, 2026-11-17 (15 steps: sign up, organization, contact, deal, note with attachment, search, another account's `404`s, cleanup). On prod it stops at sign-up: prod emails sign-in codes and has no sending domain (WAITING.md). Prod's api-edge is healthy, crm-web answers `200`, and the CRM and MCP routes answer `401` without a credential |

## After M7

Work that followed the milestones, each its own pull request into `main`.

| What | PR | Merge | Verification |
|---|---|---|---|
| Settings page opens and saves | #27 | `242a227` | The page showed "Not Found": only the demo's provider served the `configuration/1` record the form edits. The Lumen provider now reads and writes the organization's `crm.configuration` setting for it. `settings.spec.ts` (open from the user menu, change the app title, save, reload) passes against the deployed stage app, 2026-11-17 |
| Deal board hardening, first drag test | #28 | `45df07f` | Board state follows late-arriving stages; a drop the state cannot place is ignored; a deal dropped beside one with a removed stage takes the column's stage; a failed move is reported; `DealEdit` no longer requests a deal called `create`. Every menu page was opened signed in on stage: all render |
| Deal moves saved in order | #29 | `14524b3` | A deal moved twice before the first move was saved had its second move stored in the old column (seen in a request timeline against stage: the second `PATCH` carried no `stage`). Moves are queued; each reads the deal and its drop target from the server; the board reloads once, after the last save, and never mid-drag. `dealBoard.spec.ts` failed 2 runs in 3 against deployed stage before, and passed 3 in 3 after, 2026-11-17 |
| `LICENSE` is plain MIT text | #30 | `b044515` | GitHub reported "Other"; a sentence after the MIT text kept it from matching. Superseded the same day by #31 |
| Relicensed to Apache-2.0 | #31 | `88f7ab5` | `LICENSE` is the unmodified Apache text; `NOTICE` reads `Copyright 2026 vijayakrishnans and Orunbase`. GitHub's API reports `Apache-2.0` for the repository, 2026-11-17 |
| Listed on openproduct.live | (no PR: done by the owner on Orunbase) | | Published 2026-11-17T08:02Z as `atomic-crm`; renamed by the owner to https://openproduct.live/broke-crm, slug `broke-crm`, on 2026-11-19, with a tagline and pitch that credit Atomic CRM. `GET https://api.openproduct.live/v1/products/broke-crm` answers `200` with licence `Apache-2.0` and language `TypeScript`; the old slug answers `404`. `indexable` is still `false` (WAITING.md) |
| Custom domain `brokecrm.cloud` | #33 | `b94a9f2` | Done in another session: `www.brokecrm.cloud` (prod) and `stage.brokecrm.cloud` serve the CRM web app |
| Prod sign-in emails | #34 | `a9d680d` | Sender is `no-reply@brokecrm.cloud`; the owner onboarded the domain to Cloudflare Email Sending and signed in on prod with an emailed code, 2026-11-18 |
| BrokeCRM name, landing page, SEO | #35 | `6da014c` | Checked in a browser on the deployed sites, 2026-11-18: prod and stage show the landing page to a visitor with no session, "Start free" leads to the sign-in form, the sitemap and preview image are served, prod has no `noindex` and stage does. The name on every screen; a static landing page at the site's root for visitors with no session (free, open source, hosted; credit to Atomic CRM; links to Orunbase and openproduct); title, description, Open Graph, structured data, sitemap; only `www.brokecrm.cloud` indexable. `landing.spec.ts` and the full browser suite green in CI |
| Sign-in with Google and GitHub | #36 | `f3130e0` | Web app: provider buttons for whatever `GET /v1/auth/oauth/providers` lists, and the return from a provider. Identity worker: the CRM web app's origins may be returned to; client ids come from Orunbase secrets beside their secrets. `socialSignIn.spec.ts` passes against stage with the provider list and the return simulated. After the deploy, 2026-11-18: api-edge healthy on stage and prod, email sign-in still starts on stage, and `GET /v1/auth/oauth/providers` is empty on both, as expected. Not live: no provider is configured yet (WAITING.md) |
| Bare domain redirects to `www` | #39 | `704cd4a` | Terraform attaches `brokecrm.cloud` to the prod crm-web Worker, which answers it with a `301` to `www`; every host but `www.brokecrm.cloud` sends `X-Robots-Tag: noindex`. Not live until #40: its deploy was blocked |
| Deploy smokes fixed after the rename | #40 | `eba63d7` | The crm-web and console smokes grepped the page for the old name, so the stage smoke failed on every deploy after #35 and prod was blocked: prod's web app stayed on #35's build, #39's Terraform never ran, and prod's console kept the old name. Fixed, with a redeploy marker for `cloudflare-domain`. The deploy run on `main` concluded `success`, and on prod, 2026-11-18: `https://brokecrm.cloud/?demo` answers `301` to `https://www.brokecrm.cloud/?demo`; the sign-in page requests the provider list (`200`); the console's title is "BrokeCRM Console"; `www` has no `noindex` header and the workers.dev copy has one |
| Terms, privacy policy, licence statement | #41 | `fd9933a` | `terms.html` and `privacy.html`, static pages on the site, linked from the landing page and the sign-in form; the landing page states that all of it is Apache-2.0. `landing.spec.ts` covers the links. The texts are plain-language drafts, not reviewed by a lawyer (WAITING.md) |
| Sign-in with Google and GitHub switched on | #44, #45 | `4f2a837`, `13a45c8` | The owner created the OAuth apps and seeded the five keys per environment in Orunbase. #44 redeployed `identity-worker`, but the providers stayed empty: #36 had added the client ids to `optionalSecretEnv` and not to `runtimeSecrets`, so the deploy pushed three secrets and left the ids out. #45 lists all five. After it, 2026-11-19: `GET /v1/auth/oauth/providers` names `github` and `google` on stage and prod; both sign-in pages show both buttons; each start link answers `302` to the provider with a client id and this environment's callback URL. Not verified by the agent: the provider's own consent step and the return, which need the owner's account |
| Environment addresses in `intent.yaml` | #46 | `19072a6` | `url` for prod is `https://www.brokecrm.cloud` and for stage `https://stage.brokecrm.cloud`, so the Orunbase overview shows the product's own address; the console moves to a link |

## Live URLs

| | stage | prod |
|---|---|---|
| api-edge | https://openproduct-crm-api-edge-stage.vijayakrishnan12994.workers.dev | https://openproduct-crm-api-edge-prod.vijayakrishnan12994.workers.dev |
| console | https://openproduct-crm-web-console-next-stage.vijayakrishnan12994.workers.dev | https://openproduct-crm-web-console-next-prod.vijayakrishnan12994.workers.dev |
| crm-web (M0) | https://openproduct-crm-crm-web-stage.vijayakrishnan12994.workers.dev | https://openproduct-crm-crm-web-prod.vijayakrishnan12994.workers.dev |
| BrokeCRM, the custom domain (crm-web) | https://stage.brokecrm.cloud | https://www.brokecrm.cloud |

## Decisions

- 2026-11-16: the repo lives at `vijayakrishnans/openproduct-crm`, not
  `openproduct/openproduct-crm`. The build's GitHub identity is not a member
  of the OpenProduct org, and the workspace's GitHub connection covers only
  `vijayakrishnans`. The owner chose this.
- 2026-11-16: SOLO_MODE goes off (task CRM-4). Lumen v33 builds a single-user
  product: the edge 404s org members, invitations, org API keys, webhooks,
  metering and a second org. A team CRM needs all of them (sales are members,
  MCP uses API keys, M6 needs webhooks and seat metering).
- 2026-11-16: the bootstrap ran with `repoPrivate: false`; the repo was
  `PUBLIC` from creation.
- 2026-11-16: M0 deploys `crm-web` as Workers + Static Assets with a
  pass-through Worker entry (the composition requires one; M3 adds routes).
  Worker names are `openproduct-crm-crm-web-<env>`.
- 2026-11-16: upstream telemetry pings (Atomic CRM and shadcn-admin-kit) are
  removed from the source; ra-core's is always disabled by `admin.tsx`.
- 2026-11-16: the demo's fake data no longer hot-links photos and logos from
  marmelab.com; avatars fall back to initials.
- 2026-11-16: Atomic's changelog page shows this app's own `CHANGELOG.md`.
- 2026-11-16: Atomic's Vitest browser tests and Storybook stories are kept in
  the tree but excluded from the M0 typecheck; M3 adds a Chromium test lane.
- 2026-11-16: `preserveSymlinks` is dropped from the Vite config (it breaks
  pnpm's symlinked layout); `cropperjs` and `shadcn` became direct
  dependencies (npm had hoisted them).

- 2026-11-17: `pnpm-workspace.yaml` declares missing peers (`@types/react`
  on lucide-react, next and cmdk; `zod` on @hookform/resolvers). The console
  pins React 19 rc types and zod 3, while crm-web uses stable types and
  zod 4; without the peers each app type-checked against the other's.
- 2026-11-17: `main` requires a PR and the `plan` check. The other CI jobs
  depend on what changed, so they cannot be required.
- 2026-11-17: an upstream test fixture's real email address became
  `jane.doe@example.com` (the repo is public).

- 2026-11-17: CRM ids stay `bigint` identities, as upstream, so the web app,
  CSV import and the ported SQL keep their shapes. Tenancy does not rest on
  ids being unguessable: every foreign key is composite on `(org_id, id)`.
- 2026-11-17: row-level security needs a role without `BYPASSRLS`, and
  Supabase's `postgres` has it. The migration creates `crm_app` (no login);
  crm-worker runs each request as `SET LOCAL ROLE crm_app` with
  `app.org_id` and `app.subject_id` set for the transaction.
- 2026-11-17: `crm.sales` is keyed by `(org_id, subject_id)`, the Lumen
  actor id (`usr_…`), which is what the edge hands a worker.
- 2026-11-17: `merge_contacts` and `global_search` take the org as an
  argument and filter on it, so the explicit filter and the policy are two
  independent checks.
- 2026-11-17: `citext` is not used (plain `text`, with `lower()` indexes
  where case matters); `unaccent` and `btree_gin` are, the latter so the
  search indexes lead with `org_id`.
- 2026-11-17: the SQL-level tests run on PGlite (Postgres as WebAssembly)
  in `tests/db`, so CI needs no database service.

- 2026-11-17: three policy actions, `organization.crm.read` (viewer and
  up), `.write` (builder and up) and `.manage` (owner, admin). Someone with
  no role in the org gets `404` on every CRM path; a member whose role lacks
  the action gets `403`.
- 2026-11-17: the CRM's edge rate limit is 600 requests a minute per
  identity and 3000 per org (other families: 60 and 300). One screen of the
  web app issues a dozen reads.
- 2026-11-17: `crm.sales` rows are created by the worker on a member's first
  write or `GET /crm/sales/me`, from the actor the edge resolved. Clients
  cannot create or delete them.
- 2026-11-17: `tests/crm-worker` subscribes with the `verify` profile so its
  tests run in CI. Every other test component uses `quick-check`, which runs
  no tests, including `tests/db` and its M1 isolation tests (run locally).

- 2026-11-17: crm-worker binds text parameters only and casts in SQL. The
  driver on Workers (postgres.js) re-encodes a parameter by its inferred
  type, which broke creates on stage; PGlite does not, so the harness now
  rejects non-text parameters.
- 2026-11-17: the browser calls api-edge directly, from each environment's
  crm-web origin (CORS), finding the API from its own host name. The crm-web
  Worker proxies nothing.
- 2026-11-17: sign-in is Lumen's email code; there are no passwords, so
  upstream's sign-up, password reset and OAuth consent pages are removed.
  After the code, a user with one organization goes straight in; otherwise
  they choose or create one.
- 2026-11-17: one build serves the CRM and, with `?demo`, the in-browser
  demo.
- 2026-11-17: the CRM configuration (stages, categories, logos, title) is
  one org setting in config-worker, key `crm.configuration`. A new org has
  none and gets the app's defaults, including the default deal stages.
- 2026-11-17: adding a user from the CRM sends a Lumen invitation; their
  profile appears when they first sign in.
- 2026-11-17: until M4, note attachments are refused, and avatars and logos
  are stored inline as data URLs.
- 2026-11-17: the e2e specs give each test its own user and organization
  through the public API instead of resetting a shared database.

- 2026-11-17: files are uploaded and downloaded through crm-worker with the
  session, not with signed URLs: signing needs a secret set with
  `orun secrets set`, and an authenticated route needs none. The browser
  fetches a file with its session and shows it from memory.
- 2026-11-17: a file's path is relative to its organization, and the worker
  adds the organization prefix. A path cannot name another organization's
  file, so notes need no ownership check on paths.
- 2026-11-17: the R2 buckets are `openproduct-crm-crm-attachments-stage`
  and `-prod`. The deploy token has no R2 permission, so the pre-deploy step
  that was meant to create them failed and the first deploy with them did
  too (code 10085). With the owner's approval they were created through the
  Cloudflare connection, and the failed lanes were re-run. A fresh account
  needs them created by hand before crm-worker's first deploy.
- 2026-11-17: favicons come from the domain's own `/favicon.ico` only.
  Upstream also asked Gravatar (with a hash of the contact's email) and
  favicon.show; those calls are dropped.
- 2026-11-17: an organization's inbound address is its public id
  (`org_…@<inbound domain>`), so no address table is needed. The id is not a
  secret: a message is accepted only with a DMARC pass and a From address
  that is an active member's.

- 2026-11-17: the MCP server is hand-written JSON-RPC over one POST route
  (no SDK, no session, no server-sent stream), so it runs inside crm-worker
  and each tool call is one organization transaction.
- 2026-11-17: MCP has no delete or merge tool and no free-form SQL. An
  assistant can read, create and update; removing records stays a human act.
- 2026-11-17: an MCP client signs in with a Lumen API key. Its role decides:
  `viewer` reads, `builder` and up write. A key of another organization gets
  `404` from the endpoint.

- 2026-11-17: CRM events and seat records are written in the request's
  transaction after `RESET ROLE`, through the events and metering
  repositories. `crm_app` gets no grant outside the `crm` schema.
- 2026-11-17: event payloads carry ids only (no names, emails or note
  text), because webhooks send them to third parties.
- 2026-11-17: a seat is one `crm_seats` usage record the first time a person
  uses an organization's CRM. Seats are never decremented; API keys are not
  seats.
- 2026-11-17: the plan limit is `limit.crm_contacts` (free 500, pro 10 000,
  business 100 000, enterprise unlimited; default tier 500). The numbers are
  the agent's proposal and the owner may change them in
  `apps/billing-worker/src/plan-catalog.ts`. The check fails closed, like the
  platform's other limits. It needs no Polar connection.
- 2026-11-17: inbound email and MCP go through the same handlers, so MCP
  writes emit events and obey the limit; contacts created by inbound email
  do neither yet.
- 2026-11-17: "onboarding" in M6 is what M3 already built: sign in, name an
  organization, and the first-run checklist on an empty dashboard. Nothing
  was added for it.

- 2026-11-17: on stage, webhooks are never delivered and usage summaries
  never roll up: both run on cron, and crons are declared for prod only
  (free plan: 5 triggers per account). This is the baseline's choice, not the
  CRM's; it means those two effects can only be watched on prod.

- 2026-11-17: the licence is **Apache-2.0**, chosen by the owner from AGPL,
  Apache 2.0 and BSD ("we just need the credit"). Apache was proposed because
  it is the one of the three whose terms carry the credit: redistributors
  must keep `NOTICE`. AGPL was offered as the alternative that also forces
  hosted modifications to be published; the owner confirmed Apache. Atomic
  CRM's code stays MIT (`THIRD_PARTY_NOTICES.md`). The credit names
  `vijayakrishnans`, the GitHub account, by the owner's choice, and Orunbase.

- 2026-11-17: the product keeps the slug **`atomic-crm`** on openproduct.live,
  by the owner's choice, though the repository and product are named
  OpenProduct CRM.

- 2026-11-19: the openproduct.live slug is now **`broke-crm`**, matching the
  BrokeCRM name, by the owner's choice; the listing credits Atomic CRM as its
  inspiration and base. The landing page links to the new address.

- 2026-11-18: the product is named **BrokeCRM** and lives at
  `www.brokecrm.cloud`, by the owner's choice. Only what people see changed:
  the repository, Worker names, storage keys and `.rebrand/values.json` keep
  `openproduct-crm`. The landing page links to `openproduct.live` (where the
  listing is); the owner wrote `openproduct.com`, which could not be reached
  to confirm.

- 2026-11-18: the landing page is static HTML inside `index.html`, not a
  React route, so it paints without the app and crawlers can read it. The
  app does not start on it, and removes it from the document when it does
  start.

- 2026-11-18: OAuth client ids are read from Orunbase secrets like their
  secrets, not committed as config, so turning a provider on is one place.

- 2026-11-19: a runtime secret has to be named twice in a worker's
  `component.yaml`: in `optionalSecretEnv` (where it is looked up) and in
  `runtimeSecrets` (what the deploy pushes). Naming it only in the first is
  silent: the deploy succeeds and the Worker never gets it. The deploy log's
  `secrets-live: pushed N runtime secret(s): …` line is the check.

- 2026-11-18: **a green pull request is not a deployed change.** The
  pull-request checks stop at "Verify deploy"; the smoke runs only in the
  deploy on `main`. Three merges (#36, #39 and the records between) were
  reported as deployed while prod was blocked by a failing stage smoke. After
  every merge that deploys, read the conclusion of the run on `main` before
  saying anything is live. A smoke that names the product must change with
  the product's name.

- 2026-11-18: the terms and the privacy policy are static pages in
  `apps/crm-web/public`, like the landing page: readable without the app and
  by crawlers. The privacy policy was written from what the code does (no
  analytics, session in local storage, one short-lived OAuth cookie, database
  in Singapore, Cloudflare and Supabase as processors). It makes three
  promises the owner must keep: deletion on request within 30 days, 30 days'
  notice before ending the service, and breach notice.

- 2026-11-17: deal moves are saved one at a time against the server's state
  (two extra reads per move) rather than from the cards on screen. Stage
  takes about five seconds per save, so the screen is routinely ahead of the
  server; trusting it stored moves in the wrong column.

## Open risks

See `specs/epics/openproduct-crm-port/risks-and-open-questions.md`.

## Deferred

- The OpenProduct GitHub org transfer (needs org membership; see WAITING.md).

- The deal-board crash the owner saw: needs the browser's console error to
  go further (WAITING.md).

## Build notes

- `api.orunbase.com` and `github.com:22` timed out intermittently from the
  build machine; the bootstrap was resumed with `--resume` until it finished.
- A resume after a failed post-merge `git pull` re-placed phase 03 as PR #4
  (merge conflict); #4 was closed as redundant with #3.
