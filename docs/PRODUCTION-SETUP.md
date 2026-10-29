# UrbanKare hosted production setup

Updated 29 October 2026. Hosted resources were provisioned on 28 October 2026. Production runs at https://urbankare.vercel.app from the `main` branch of `public8055-prog/testing`.

## Where the database and services are

| Component | Location | Purpose |
| --- | --- | --- |
| Web application | Vercel project `urbankare`, team `public8055-7426s-projects`, function region `bom1` | Next.js pages and protected APIs; deployment follows a Git push |
| Application database | MongoDB Atlas resource `urbankare-production`, Mumbai, database `urbankare_mongo` | Accounts, roles, catalogue, bookings, payments, tokens, provider documents in GridFS, notifications, workforce and audit records |
| Shared state | Upstash resource `urbankare-production-cache`, Mumbai | Cache, sliding-window limits, session revocation/rotation, queue allocation and distributed locks; eviction is disabled |
| Current local development | Atlas database `urbankare_dev`, separate `urbankare:development` Redis scope and signing key | `npm run dev` and `npm start` use hosted services without Docker and cannot write production records |
| Original development records | Local MongoDB at `127.0.0.1:27018`, database `urbankare_mongo`, retained local Docker volume | Preserved historical development records; this is a separate database from Atlas |
| Private operator configuration | Ignored `.data/hosted-production.env` and `.data/production-settings.env` on this workstation | Trusted initialization and diagnosis only; never publish or upload these files to Git |
| Original encrypted backups | `.data/backups/encrypted`, key in the separately protected configured key file | Recovery evidence; never deploy the key or publish the snapshots |

Open **Vercel → UrbanKare → Storage**, select the named resource, then **Open in MongoDB Atlas** or **Open in Upstash** to inspect it. The hosting integrations populate protected credentials in Vercel. Connection strings are deliberately absent from this document.

The hosted database was initialized with the authored catalogue and the existing owner administrator account, preserving its Argon2id hash and private login alias. Existing sessions were not copied. Development customers, sample professionals and historical development bookings were not published to production. The original local database and backups were preserved. This workstation now uses a separate hosted development database; its original private environment is backed up at `.data/local-before-hosted.env`. Ordinary local startup does not point at production. The developer administrator account and catalogue are initialized there as well, with a distinct signing key. The prior catalogue-only deployment did not accept public account registrations.

## Production configuration

MongoDB and Redis connections, `AUTH_JWT_SECRET`, SMTP credentials and application settings are scoped to **Production**, with Secret visibility. Preview and Development deployments do not receive production database credentials. `PUBLIC_LAUNCH_READY=false` is a non-sensitive Config variable because Vercel rejects public-prefixed Secret variables.

| Variable | Configuration |
| --- | --- |
| `MONGODB_URI` | Integration-managed authenticated Atlas SRV connection |
| `MONGODB_DB` | `urbankare_mongo` |
| `MONGODB_POOL_SIZE` | `5` per process |
| `REDIS_URL` | Integration-managed authenticated TLS Redis connection |
| `AUTH_JWT_SECRET` | Protected canonical base64 32-byte signing key; never a `NEXT_PUBLIC_` variable |
| `SMTP_HOST`, `SMTP_PORT`, `SMTP_USER`, `SMTP_PASS`, `EMAIL_FROM_NAME` | Protected existing email delivery configuration |
| `APP_URL` | `https://urbankare.vercel.app` |
| `COOKIE_SECURE` | `true` |
| `CATALOG_SOURCE` | `database` |
| `AUTO_START_LOCAL_INFRA` | `false` |
| `PUBLIC_LAUNCH_READY` | `false` until real business details and launch requirements are reviewed |

Integration-created REST Redis variables are also protected; application sessions/locks use the native TLS `REDIS_URL`. Google Analytics stays off. No payment merchant keys or fabricated business details were added. SMTP authentication was verified without sending a test email to another person; inbox delivery still needs an operator acceptance check.

## Sign-in and account behavior

All roles use `/login`. The database determines customer, provider or administrator authorization. Private admin aliases use the same bounded, normalized identifier format in sign-in and the protected seed command. No public admin link or credentials are embedded in the application.

Access JWTs expire after 15 minutes. Rotating, revocable refresh cookies remain httpOnly and Secure on HTTPS. Five incorrect password attempts lock the account for 15 minutes, including attempts through different aliases for the same account. Login IP and identifier rate limits are enforced in Redis.

Email-code and password login can be switched in both directions. Password visibility controls and `/login/reset` remain available. With email delivery configured, new registrations require mailbox confirmation before booking or workforce access; the server preserves the unverified state and rejects those operations. Public deployments keep accounts unverified if email delivery is unavailable. Only an explicitly unpublished HTTP loopback preview can permit password-only registration without mail. `/dashboard/verify` supports code entry and requesting a replacement. Code consumption is atomic: concurrent requests cannot successfully reuse one code. The verification banner wraps at 320 pixels and does not show private administrator mailboxes.

Authentication forms explicitly use POST and defer submission until their handlers attach, preventing implicit GET submissions during hydration. Admin search and filters also wait for hydration. Desktop sign-out uses a real POST form with a 303 redirect as a fallback before hydration. The JavaScript path clears the visible session and loads the sign-in page after server revocation. Mobile administrator/provider sign-out also reloads after revocation. Customer workspaces expose the same POST sign-out control at mobile widths so it remains available when the desktop sidebar is hidden. Provider header account links lead to the provider workspace.

Use protected environment-based `npm run admin:seed` to provision or rotate an administrator from a trusted environment. Never place seed credentials in a public page, repository, browser URL or README. Review and rotate operator credentials before a public launch.

## Trusted hosted operations

The ignored operator environment files can be supplied explicitly without modifying the original development environment:

```powershell
node --env-file=.data/hosted-production.env --env-file=.data/production-settings.env --import tsx scripts/db-init.ts
node --env-file=.data/hosted-production.env --env-file=.data/production-settings.env --import tsx scripts/sync-catalog.ts
node --env-file=.data/hosted-production.env --env-file=.data/production-settings.env --import tsx scripts/backup.ts
```

Catalogue initialization is explicit; it does not replace existing administrator prices or publication controls. New records omit unsupported popularity/rating/discount claims. Do not run the historical SQLite migration against the populated hosted database.

A new Git deployment is required after changing Vercel environment variables. `vercel.json` uses `npm ci`, the tested Webpack build, and the Mumbai function region. A normal Vercel Next.js deployment never starts local Docker containers or the custom long-lived gateway/worker.

## Verification and operating limits

Backend tests use isolated generated databases and Redis prefixes. Atlas Free names must fit 38 bytes; verification names retain random isolation. Tests and backup restore verification clean up their own generated collections if integration permissions withhold `dropDatabase`; broader database privileges are not required. Production records are never selected as a cleanup target.

Local acceptance uses a separate loopback production-build server and generated `urbankare_test_e2e_` database. Synthetic accounts and identity images belong only to that test workflow. Browser WebKit coverage is not a claim that physical iPhone/Safari hardware was tested. Payment integration tests use controlled gateway fixtures; no real card charge or refund was performed.

Free service plans have resource quotas and no guarantee of the requested production throughput/SLA. Upgrade capacity deliberately before commercial traffic. The current Vercel request runtime does not run continuous maintenance or scheduled filesystem backups. Use a managed worker/scheduler with durable protected backup storage for unattended production backups; a local encrypted snapshot alone is not an automated offsite backup strategy. Live updates use the existing page polling/SSE fallback; the local custom WebSocket gateway is not deployed as a persistent Vercel server.

Public launch still requires the actual legal business name/address, support/grievance contact details, legal-policy review, and appropriate hosting/payment-provider arrangements. Vercel currently shows a Hobby team; its [fair-use terms](https://vercel.com/docs/limits/fair-use-guidelines) restrict Hobby to personal, non-commercial use. Choose an appropriate hosting plan before commercial operation. No subscription was purchased. Keep analytics disabled until a consent-based setup is configured and approved. See README, DEPLOYMENT, BACKUPS and VALIDATION for commands, security boundaries and evidence.

The initial hosted application snapshot was created and restored for verification: **48 collections / 62 documents**, AES-256-GCM, SHA-256 `8e9ed33d6dba9a6c896ad9e7d2301d5dc100bdc477822eb58fd29ea82c535d4e`. Its temporary verification database was removed. These are snapshot counts, not ongoing live totals. Local credential files have explicit Windows permissions for the owner, SYSTEM and Administrators, with inheritance disabled.

## Sign-in update: 29 October 2026

Sign-in permits 10 attempts per identifier and identifier/IP pair in 15 minutes. The former shared five-request IP budget has been removed. Ten failed credentials lock an account for 15 minutes. Global API protection remains at 100 requests/minute/IP. Owner credentials were rotated through a private operator task in production and development, preserving the owner ID and revoking sessions. Credentials are never committed. Admin Settings now provides current-password verification, visibility controls, confirmation, a minimum 10-character new password and full session/recovery-code revocation. The operator-supplied initial password was accepted as requested; later UI changes follow the minimum length policy.
