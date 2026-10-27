# Docker-free catalogue and Vercel deployment

The public site loads its catalogue from authored application data. Docker, MongoDB, Redis, an administrator seed and authentication keys are not required to browse the website. The home page, business information, full service search, category pages, service details and public catalogue APIs work with no database connection. Twelve categories are included: eight package categories with 48 services and four recurring-professional categories whose package count is correctly zero. No providers, reviews or customer records are invented.

## Run locally

Use Node.js 24 and npm:

```powershell
npm ci
npm run dev
```

Open `http://localhost:3000/`. A fresh checkout needs no environment file for catalogue browsing. To explicitly select this mode with an existing configuration, set `CATALOG_SOURCE=builtin` and `AUTO_START_LOCAL_INFRA=false` in the private `.env.local`, then restart the app. Existing database credentials and volumes are not removed or migrated. The current local preview uses this mode; previous private records remain in their original MongoDB/backup locations.

For a production build:

```powershell
npm run build -- --webpack
npm start
```

The public-mode launcher skips operational authentication/database validation. It never fabricates operational readiness: `/api/health` returns `mode: catalogue`, `catalogue: builtin`, `operations: not-configured`. Public catalogue readiness does not mean that booking/payment/account services are configured.

## Deploy to Vercel

Connect the GitHub repository to Vercel as a Next.js project. `vercel.json` selects `npm ci` and the tested Webpack production build. Do not use a Docker deployment or point Vercel at `.next/standalone`; Vercel handles the Next.js deployment itself. There is no required database or secret environment variable for the public catalogue. If the project already contains copied localhost MongoDB/Redis settings, automatic mode recognizes that they are not usable from Vercel and selects the built-in catalogue. Remove stale settings or explicitly set `CATALOG_SOURCE=builtin` for clarity. New environment settings require a new deployment.

The site's origin can come from Vercel's project/deployment hostname if `APP_URL` is absent. Set `APP_URL=https://urbankare.vercel.app` when that is the desired public origin. Keep `PUBLIC_LAUNCH_READY=false` until the real business/policy/operating details have been reviewed. Google Analytics remains off. The previously supplied public WhatsApp number `+91 9717621336` is the default contact option when the corresponding variable is absent; an explicitly empty `PUBLIC_WHATSAPP_NUMBER` disables it.

## Modes and safety

| `CATALOG_SOURCE` | Behaviour |
| --- | --- |
| `auto` (default) | Built-in catalogue when either connection URL is missing, or Vercel has copied loopback URLs; database-backed operation when both real connection URLs are configured. |
| `builtin` | Public catalogue only. Private sessions, administration, booking/payment writes and online support submissions are unavailable even if old credentials remain configured. |
| `database` | Explicit database-backed operation. Configuration failures/outages remain errors; archived categories and old prices are never resurrected from the built-in catalogue as an outage fallback. |

Built-in service prices are indicative; the UI does not claim current slot availability or accept payment. Add-to-cart/Book now actions are replaced by service details/contact options. Accounts and checkout explain that online operations are not open yet. The support form does not collect personal information without somewhere persistent to save it. Nonadmin administration access remains 404, private-file probes remain 404, and operational APIs return a clear 503 `OPERATIONS_NOT_CONFIGURED`. No success receipt, saved booking or administrator approval is fabricated.

Public JSON responses contain only authored catalogue data and can be cached for five minutes at the CDN, with a ten-minute stale window. Catalogue-only GET/HEAD APIs have a bounded per-instance 100/minute sliding-window limiter with Retry-After. This is best-effort abuse protection, not a shared serverless quota; use Vercel Firewall/edge limits for production traffic control. Vercel overwrites `X-Forwarded-For`, so it is used only on Vercel or a separately configured trusted proxy. Private APIs never use the in-memory limiter or a permissive Redis fallback. Their existing shared Redis limits and account/ownership checks remain required in database mode. Same-origin CORS checks, nonce CSP and security headers remain active.

## Enable real operations without Docker

1. Provision an authenticated MongoDB Atlas replica set and a hosted Redis endpoint that supports Redis TCP/TLS (a REST-only URL is not a substitute for `REDIS_URL`). Keep credentials in Vercel's protected environment settings, never in chat or source.
2. Configure `MONGODB_URI` using `mongodb+srv://`/authenticated TLS, `MONGODB_DB`, authenticated `REDIS_URL=rediss://...`, a fresh canonical base64 32-byte `AUTH_JWT_SECRET`, the exact HTTPS `APP_URL`, and `COOKIE_SECURE=true`.
3. Select `CATALOG_SOURCE=database` and `AUTO_START_LOCAL_INFRA=false`. Review required mail/payment/business settings in README and DEPLOYMENT before accepting live operations.
4. Run `npm run db:init` and the explicit `npm run db:catalog` command against that hosted database from a trusted environment. The catalogue sync adds authored records while preserving existing administrator prices and publication controls. Seed the administrator through the protected environment-based command. Nothing automatically promotes a user.
5. Redeploy and verify full `/api/health`, authentication, document review, booking/queue/payment workflows, webhooks and backups. Administrators then manage the database catalogue; the public-only source copy does not override their edits.

Persistent background maintenance/backups need a managed worker or scheduler; Vercel's normal Next.js request runtime does not start the long-lived local gateway/worker. Existing visible-page polling provides service-update refresh; validate any SSE/realtime setup against the selected hosting plan. Do not assume the custom `npm start` WebSocket gateway runs inside Vercel's standard Next.js deployment. Local Docker scripts remain optional compatibility tools and now require explicit `AUTO_START_LOCAL_INFRA=true`; Vercel always skips them. No local database/container/backup has been deleted for this change.

## Validation scope

`tests/builtin-catalog.test.ts` tests the complete built-in records, category counts, immutable copies, metadata, API results, mode selection, missing-secret behavior, private-route/write denial, CORS and public limits with MongoDB/Redis URLs empty. `tests/e2e/builtin-catalog.spec.ts` checks the business page, all 48 detail APIs, full listing, category/detail navigation, WhatsApp, honest account/checkout boundaries and mobile accessibility in a credential-free deployment. [VALIDATION.md](VALIDATION.md) records executed results and any deployment limits.

Official references: [Vercel environment variables](https://vercel.com/docs/environment-variables), [Vercel request headers](https://vercel.com/docs/headers/request-headers), [Vercel Functions limits](https://vercel.com/docs/limits). This document describes the public catalogue fix; hosted operational services have not been provisioned on the user's behalf.
