# cloudflare-domain

Adopts the `brokecrm.cloud` Cloudflare zone and attaches the CRM web app's custom domain to each environment's `crm-web` Worker: `stage.brokecrm.cloud` on stage, `www.brokecrm.cloud` on prod. It also gives `api-edge` its two names per environment: the API (`api-stage.brokecrm.cloud`, `api.brokecrm.cloud`) and the MCP server (`mcp-stage.brokecrm.cloud`, `mcp.brokecrm.cloud`).

Manages DNS records and Worker routes/custom domains on the product zone for openproduct-crm, per environment (`stage`, `prod`; `dev` is
verify-only and provisions nothing).

## Depends on

- **crm-web** — the CRM web app (Vite + React) on Workers + Static Assets; a custom domain attaches to its Worker by name

## Depended on by

- (none)
