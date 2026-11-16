# Risks and open questions

## CRM-A — The repository is under a personal account (ACCEPTED)

The brief named the `OpenProduct` GitHub org, but the build's GitHub identity
(`vijayakrishnans`) is not a member, and the workspace's GitHub connection
covers only `vijayakrishnans`. The owner chose `vijayakrishnans/openproduct-crm`.
A later transfer to the org needs org membership and the Orun GitHub App
installed there; links in the README and Welcome card change with it.

## CRM-B — Lumen ships no licence (RISK)

Lumen (`sourceplane/lumen`) has no LICENSE file. This repository is MIT as the
brief requires; the Lumen owners are the same people who asked for it. Confirm
before the first outside contribution.

## CRM-C — Upstream drift (ACCEPTED)

The port is pinned to Atomic CRM `aeccb98`. Upstream changes are not pulled
automatically; any later sync is a deliberate PR.

## CRM-D — Tenancy regressions (RISK)

A single query without its `org_id` predicate leaks data across orgs. The
mitigations are layered: explicit filters, RLS on `app.org_id`, and an
isolation matrix test per route that must stay green.

## CRM-E — Browser tests need a browser lane (RISK)

Atomic's unit tests run in Vitest browser mode (Playwright/Chromium) and its
e2e specs need a live stack. M0 excludes them from typecheck; M3 brings them
back with a CI lane that installs Chromium.

## CRM-F — Stage sign-in hands out codes (ACCEPTED for stage)

Stage runs identity with `DEBUG_DELIVERY=true`: `POST /v1/auth/login/start`
returns the sign-in code in the response, so anyone can sign in to stage as any
address. It is the baseline's test setting and is off in prod. Stage must
never hold real data; seeds stay fake.

## CRM-G — Prod cannot send sign-in email yet (RISK)

Prod's sender is a placeholder domain. See WAITING.md.
