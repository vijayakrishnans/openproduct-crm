# CRM port ledger

The authoritative progress record for porting Atomic CRM onto this Lumen
product. Read it first on every resume, then `gh pr list --state all` and
`orun baseline new … --status`. Do not redo merged work.

## Summary (2026-11-17)

Phase A, CRM0, the multi-tenant profile (CRM-4), M0 (CRM-3) and the public
listing (CRM-2) have landed. M1 onward is **blocked**: every Supabase
database on the account stopped resolving on 2026-11-17 (see WAITING.md),
so migrations cannot run and api-edge reports `degraded` on stage and prod.

## Inputs used

| Input | Value |
|---|---|
| Orun account | `openproduct` (`openproduct-6ny98czp`) |
| Workspace | `openproduct-crm` (`ws_9JAJMRHA`) |
| Repository | https://github.com/vijayakrishnans/openproduct-crm (public) |
| Product name | OpenProduct CRM |
| workers.dev subdomain | `vijayakrishnan12994` |
| Lumen | `baseline-v33` (`4cacc01`) |
| Atomic CRM | `aeccb98` (MIT) |
| orun | v2.96.0 |
| Epic | `EP-7` `openproduct-crm-port` (cluster `CRM`) |

## Milestones

| Milestone | Task | State | PR | Merge | Verification |
|---|---|---|---|---|---|
| Phase A bootstrap | BASE-1..8 | done | #1–#3, #5–#9 (#4 closed, redundant) | `b8551b3` | every Lumen phase through 08-docs derived done; console and api-edge 200 on stage and prod; sign-in and personal org on stage verified 2026-11-16 |
| Multi-tenant profile | CRM-4 | merged; stage check blocked | #11 | `45adb3e` | SOLO_MODE off everywhere; console builds from source. The stage org check waits on the database (WAITING.md) |
| CRM0 the spec | CRM-1 | done | #10 | `053be16` | |
| CRM-A public listing | CRM-2 | in review | #13 | | description, homepage, topics, secret scanning, push protection, private vulnerability reporting and `main` protection (PR + `plan` check) set 2026-11-17 |
| M0 import and attribution | CRM-3 | merged | #12 | `9be281f` | CI green; see the deploy check below |
| M1 schema | | blocked (database) | | | |
| M2 crm-worker and crm-facade | | not started | | | |
| M3 frontend swap | | not started | | | |
| M4 files and email | | not started | | | |
| M5 MCP server | | not started | | | |
| M6 product glue | | not started | | | |
| M7 prod and docs | | not started | | | |

## Live URLs

| | stage | prod |
|---|---|---|
| api-edge | https://openproduct-crm-api-edge-stage.vijayakrishnan12994.workers.dev | https://openproduct-crm-api-edge-prod.vijayakrishnan12994.workers.dev |
| console | https://openproduct-crm-web-console-next-stage.vijayakrishnan12994.workers.dev | https://openproduct-crm-web-console-next-prod.vijayakrishnan12994.workers.dev |
| crm-web (M0) | https://openproduct-crm-crm-web-stage.vijayakrishnan12994.workers.dev | https://openproduct-crm-crm-web-prod.vijayakrishnan12994.workers.dev |

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

## Open risks

See `specs/epics/openproduct-crm-port/risks-and-open-questions.md`.

## Deferred

- Prod sign-in: needs a verified sending domain (WAITING.md).

- The OpenProduct GitHub org transfer (needs org membership; see WAITING.md).

## Build notes

- `api.orunbase.com` and `github.com:22` timed out intermittently from the
  build machine; the bootstrap was resumed with `--resume` until it finished.
- A resume after a failed post-merge `git pull` re-placed phase 03 as PR #4
  (merge conflict); #4 was closed as redundant with #3.
