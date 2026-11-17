# crm-web-e2e

Browser suite for `crm-web`: Atomic CRM's e2e specs, with the login adapted,
driven in Chromium against a real API.

A verify-only component. Nothing deploys from here.

## What it covers

| Spec | From upstream | What it shows |
|---|---|---|
| `signIn.spec.ts` | replaces `signup.spec.ts` | email-code sign-in, a returning member lands in their organization, and a member of another organization cannot open a record even with its id |
| `onboarding.spec.ts` | `onboarding.spec.ts` | a new user names an organization, adds a contact and a note, and sees them in the activity log |
| `userAddingATask.spec.ts` | same name | a task added on a contact shows on the dashboard |
| `globalSearch.spec.ts` | same name | an old contact is found despite many newer notes mentioning it |
| `bulkContactTags.spec.ts` | same name | one tag added to several contacts |
| `createContactFromDeal.spec.ts` | same name | a contact created from inside the deal form |
| `adminAccountManagerFilter.spec.ts` | same name | an admin filters contacts by teammate; a non-admin gets no such list |

Upstream reset one shared database before every test, through Supabase's
admin client. Here each test creates a new user and a new organization through
the public API, so tests cannot see each other's data and no admin key exists.
The mobile variants of the specs are not ported.

## Running it

```bash
pnpm --filter @saas/crm-web-e2e e2e                      # serves apps/crm-web locally, API = stage
PLAYWRIGHT_BASE_URL=https://openproduct-crm-crm-web-stage.<subdomain>.workers.dev \
  pnpm --filter @saas/crm-web-e2e e2e                    # a deployed crm-web
CRM_E2E_API_URL=http://localhost:8787 pnpm --filter @saas/crm-web-e2e e2e
```

The API must return sign-in codes and invitation tokens inline (identity's
debug delivery). Stage does; prod never will, so this suite cannot run
against prod.

## Gates

- `pnpm exec turbo run build --filter=./` — typecheck
- `pnpm run e2e` — the suite itself. It is not a `test` script, so `pnpm test` at the root never reaches out to stage
