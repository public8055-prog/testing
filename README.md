# UrbanKare

## Folder structure

```text
app/                         Next.js pages, route handlers, layouts and metadata
  api/                       Auth, catalogue, bookings, admin, queue, uploads and workforce APIs
  admin/                     Protected administration and operations
  dashboard/                 Customer account, tracking and notifications
  provider/                  Provider profile, bookings, queue and verification documents
  business/                  Membership-protected workforce attendance
  locations/                 Private booking addresses, service pins and optional live GPS
components/                  Responsive customer, provider, admin and workforce interfaces
hooks/                       Client hydration guard for interactive forms
lib/                         Native MongoDB domain services, Redis, auth, payments and reports
scripts/                     Gateway/startup, worker, seed, migration, backup and audit tools
public/                      Public authored assets; never private uploads or environment files
tests/                       Isolated integration/unit checks and Playwright acceptance tests
docs/                        Deployment, security, requirements, launch and validation records
.data/backups/               Private migration/encrypted backups; excluded from deployment
artifacts/                   Private test/audit outputs; excluded from deployment
Dockerfile                   Separate non-root web and worker image targets
docker-compose.infra.yml     Local MongoDB/Redis; optional app/worker profile
docker-compose.yml           Production app/worker with external data services
```

UrbanKare combines a service catalogue, professional marketplace, service queues and workforce attendance. It uses Next.js 16.4, React 19, TypeScript, native MongoDB, Redis and a Node WebSocket gateway. Prices, account permissions, record ownership and workflow transitions are checked on the server. [Requirement traceability](docs/REQUIREMENTS.md) maps features to source and tests; [validation](docs/VALIDATION.md) records executed checks and remaining acceptance work.

## Start without Docker

Use Node.js 24 and npm. A fresh checkout needs no database, Redis, authentication key or environment file for public catalogue browsing:

```powershell
npm ci
npm run dev
```

Open [http://localhost:3000/](http://localhost:3000/). For production, run `npm run build -- --webpack` and `npm start`. Vercel uses `vercel.json`. The built-in catalogue contains 48 services, eight package categories and four recurring-professional categories. The latter correctly have no fabricated packages or providers. Prices are indicative; accounts, bookings, payments, administration and online support submissions stay closed until persistent hosted services are configured.

`CATALOG_SOURCE=auto` selects built-in browsing when data connections are absent. Use `CATALOG_SOURCE=builtin` to select it explicitly with an existing environment file. `AUTO_START_LOCAL_INFRA=false` is now the default; Vercel always skips Docker startup. Hosted MongoDB Atlas and Redis can enable the complete operational system without Docker by selecting `CATALOG_SOURCE=database`. Configuration, consent/operational boundaries, public cache/rate-limit scope and deployment steps are in [DOCKER-FREE.md](docs/DOCKER-FREE.md).

Administrators can add vendors with private identity photos, then separately approve/reject/suspend or block accounts. Masked Aadhaar is the primary ID option, with other government photo ID alternatives. **Website activity** combines recorded operations with filters and pagination; catalogue and ongoing-service boards remain available in the same administration navigation. [Vendor/admin guide](docs/PROVIDER-ADMIN.md) explains the workflow, consent, identity review and data storage.

## Hosted production

The live deployment now has a Mumbai MongoDB Atlas database and TLS Upstash Redis, connected only to Vercel Production. The existing administrator account and authored catalogue are initialized there. Protected signing/mail settings enable shared sign-in, email verification and password recovery. Original development data remains local. [PRODUCTION-SETUP.md](docs/PRODUCTION-SETUP.md) lists exact resource names, environment variable names, account behavior, operator commands and remaining launch limits. No secret values are included.

## Where the data lives

| Data | Current local location | Persistence |
| --- | --- | --- |
| Current local-preview records | Hosted Atlas database `urbankare_dev`; separate Redis prefix `urbankare:development` | Protected local environment, distinct signing key and database from production; Docker not required |
| Production records | Hosted Atlas `urbankare-production`, database `urbankare_mongo`; TLS Upstash `urbankare-production-cache` | Vercel Production-only protected configuration; see PRODUCTION-SETUP |
| Built-in public catalogue | `lib/data.ts` and `lib/builtin-catalog.ts`, bundled with the deployment | Read-only authored records; no database connection |
| Original development records and uploaded files | Preserved MongoDB database `urbankare_mongo`, host `127.0.0.1:27018`, replica set `rs0` | Docker volume `urbankare-infra_mongo_data`, mounted at `/data/db`; uploads use MongoDB GridFS `assets.files`/`assets.chunks` plus metadata |
| Original local Redis state | Redis at `127.0.0.1:6380` | Volume `urbankare-infra_redis_data`, AOF enabled; durable booking/queue/notification records remain in MongoDB |
| Original migration evidence | `.data/backups/before-mongodb-2026-10-25T09-39-49-930Z.sqlite` and `mongodb-migration-2026-10-25T09-39-49-930Z.json` | Restricted historical files; not the live database |
| Encrypted snapshots | Configured `BACKUP_DIRECTORY`; local default `.data/backups/encrypted` | Protected filesystem, or worker-only Compose backup volume |

The completed import recorded **31 collections / 159 documents** with matching canonical hashes. Those are historical import counts, not current live counts. Preserve the source backup unchanged. SQLite is only a read-only migration input; SQLite and PostgreSQL are not application runtime databases. Do not rerun the importer against the populated target.

The supplied data containers are development-only: no authentication/TLS, loopback listeners and one replica-set member. Ports 27018/6380 avoid unrelated services on this workstation; do not stop those unrelated services. `docker compose down` retains volumes; adding `-v` deletes data and is not routine shutdown.

The workstation environment now uses hosted `urbankare_dev` and TLS Redis for the full local preview at [http://localhost:3000/](http://localhost:3000/). Run `npm run dev` without Docker. Production uses a different database and signing key. The prior local environment is preserved privately in `.data/local-before-hosted.env`; its original MongoDB records and encrypted backups remain preserved. Docker-based startup/recovery was verified on 26 October 2026; that evidence in [LOCAL-STARTUP.md](docs/LOCAL-STARTUP.md) and [BACKUPS.md](docs/BACKUPS.md) now applies to the optional infrastructure mode below.

## Optional legacy local database setup

This section applies only when deliberately opting into the original local database containers. For Docker-free browsing or hosted operational services, use the instructions above and DOCKER-FREE.md. This optional local mode requires `CATALOG_SOURCE=database` and `AUTO_START_LOCAL_INFRA=true` in addition to its connection settings.

Use Node.js 24, npm, a running Docker Engine and Docker Compose v2 with Linux containers. On Windows, Docker Desktop must use its Linux-container backend (for example, WSL2). Installation/builds require access to the package and image registries; allow enough memory/disk for MongoDB, Redis and the Next build, and run heavy checks sequentially on constrained machines. Keep host ports 27018/6380 and the chosen web/internal ports free. Preserve an existing `.env.local`.

```powershell
npm ci
# Fresh checkout only:
if (!(Test-Path .env.local)) { Copy-Item .env.example .env.local }
```

Review `.env.local` privately. Development connections are:

```dotenv
MONGODB_URI=mongodb://127.0.0.1:27018/?replicaSet=rs0&directConnection=true
MONGODB_DB=urbankare_mongo
REDIS_URL=redis://127.0.0.1:6380
APP_URL=http://localhost:3000
COOKIE_SECURE=false
```

Authentication also requires `AUTH_JWT_SECRET`: a freshly generated **32-byte random key encoded as canonical base64**. Generate it once per environment and inject it through protected runtime configuration; do not print it, commit it, put it in `NEXT_PUBLIC_*`, or regenerate it on every restart. All web replicas must share it. For a fresh temporary PowerShell session, this assigns a key without printing it:

```powershell
$env:AUTH_JWT_SECRET = node -e "process.stdout.write(require('node:crypto').randomBytes(32).toString('base64'))"
```

Persist any key that must survive that shell only through the operator's protected secret store/configuration. Then:

```powershell
npm run dev
```

`db:init` adds indexes and missing sample catalogue records without overwriting existing records. Import into an empty database **before** running initialization when migrating a legacy installation. Wait for `mongo-init` to finish before transactional writes. `/api/health` checks MongoDB connectivity/replica capability and Redis availability; it does not certify external payment or mail delivery.

Open `http://localhost:3000`. Keep `APP_URL` aligned with another chosen port. Review sample catalogue prices, illustrative profiles/photos and availability before public use; no reusable admin credentials or fake customer reviews are seeded.

### Explicitly opted-in local database startup

With explicit `AUTO_START_LOCAL_INFRA=true`, the host launchers can check and manage the original local MongoDB replica set and Redis, including Docker Desktop startup and index initialization. Existing database volumes and records are retained. This is optional compatibility behavior; the default public catalogue and Vercel do not use it.

`npm install` / `npm ci` also attempts this setup when local environment configuration already exists. A Docker/WSL startup failure prints recovery instructions while leaving dependency installation successful; `dev` and `start` retry and refuse to serve the application until local data readiness succeeds. A fresh checkout without an environment file skips installation-time startup: configure `.env.local`, then run `npm run dev`. CI, Docker image builds, production-only installs and explicit `AUTO_START_LOCAL_INFRA=false` skip installation-time service startup.

Only the uncredentialed loopback endpoints on ports **27018 and 6380** are managed automatically. External, authenticated or differently ported services remain operator-managed. `AUTO_START_LOCAL_INFRA=false` disables host startup automation. Public deployments continue to require authenticated TLS database configuration. Container images use their configured services and do not start Docker inside a container.

On Windows, repeated `npm run dev` checks for an existing Next server belonging to this exact folder and reuses it after restoring database readiness. It prints the actual URL/PID and exits successfully. Other platforms also recognize launcher-owned server metadata and retain Next's own lock protection. Stop the original dev terminal with Ctrl+C before changing its port/options; unrelated Node applications are never killed. Use `npm run dev -- --port 3001` for an explicit port, or follow the URL Next prints if the default port is occupied.

Windows development defaults to Webpack after the observed Turbopack filesystem-cache stall on this workstation. Hot reload remains enabled. Explicit bundler flags are preserved, including `npm run dev -- --turbopack`; other platforms retain Next's default bundler.

Docker Desktop with Linux containers/WSL2 must be installed and its initial setup completed. If Docker reports a missing engine pipe, these commands attempt to start it automatically. If startup cannot complete, open Docker Desktop, resolve its WSL/first-run message, then retry. Stopping the web terminal leaves MongoDB/Redis and their persisted data available; deleting volumes is never part of startup or shutdown.

## Optional full-operation production run and Docker

```powershell
npm run build -- --webpack
npm start -- --port 3002
# Separate supervised process, with the same protected runtime environment:
npm run worker
```

Set `APP_URL=http://localhost:3002` for that preview. `npm start` runs a public HTTP/WebSocket gateway at the chosen port and starts the standalone Next server on **loopback only**, at `INTERNAL_APP_PORT` or public port + 1. Thus a 3002 gateway normally uses internal 3003. Keep that internal port free and private. The launcher defaults its public listener to `localhost`; Docker explicitly binds the container listener to `0.0.0.0`. `npm run dev` runs Next directly and uses the SSE fallback instead of the gateway's WebSocket bridge.

The launcher preserves shell values, then loads `.env.production.local`, `.env.local`, `.env.production`, `.env` in that order. It copies only public/static assets into standalone output. Build sanitization and `.dockerignore` exclude private data, environment files and test artifacts.

To run the **local** app, worker, MongoDB and Redis together after configuring a private signing key:

```powershell
docker compose --env-file .env.local -p urbankare-infra -f docker-compose.infra.yml --profile app up -d --build
```

Production `docker-compose.yml` defines app/worker services against required external MongoDB and Redis endpoints. Supply an authenticated TLS MongoDB replica set, authenticated `rediss://`, HTTPS `APP_URL`, signing key and secure cookies through an explicitly selected protected runtime environment file or the invoking environment. Compose does not automatically load `.env.local`. The example does not provision production DNS/TLS or database redundancy. Configuration checks do not establish that the Docker images build or run; image acceptance is recorded separately in [VALIDATION.md](docs/VALIDATION.md). Follow [DEPLOYMENT.md](docs/DEPLOYMENT.md).

## Accounts and shared sign-in

Every role signs in at **`/login`** using an email or a provisioned private identifier. Anonymous/nonadmin access to administration pages and `/api/admin/*` returns 404. `/account` is a compatibility redirect to shared login or the authenticated workspace; it is not a second auth form.

| Canonical stored role | Default destination | Authority |
| --- | --- | --- |
| `SUPER_ADMIN` | `/admin/dashboard` | Administration, role changes and administrator-access management |
| `ADMIN` | `/admin/dashboard` | Operational administration; cannot grant roles or manage administrator privilege |
| `PROVIDER` | `/provider/dashboard` | Own approved profile, assigned service queue and permitted booking actions |
| `CUSTOMER` | `/dashboard` | Own bookings, profile, saved services, reviews, tracking and support |

Legacy lowercase roles remain readable and normalize on authenticated writes. Actual MongoDB roles/status and record ownership are authoritative; JWT role claims never grant access by themselves. Workforce owners/managers/workers are separate business memberships, not extra global admin powers.

For initial administration, inject `SEED_ADMIN_EMAIL`, `SEED_ADMIN_PASSWORD` and optionally `SEED_ADMIN_NAME` into a **one-shot protected process**, then run:

```powershell
npm run admin:seed
# Equivalent: npm run admin:bootstrap
```

Despite its legacy name, `SEED_ADMIN_EMAIL` accepts a normal email or a private login identifier. Provisioning preserves an existing account ID, hashes the supplied password, grants `SUPER_ADMIN`, audits the action and revokes old sessions. Passwords are 10–128 characters. The legacy `ADMIN_BOOTSTRAP_ID`/`ADMIN_BOOTSTRAP_PASSWORD` path supports an operator-provisioned private alias; no identifier/password is embedded in source or UI. Remove seed credentials from the invoking environment afterward. Seed variables are not passed into long-running Compose services. `admin:promote` is a separate trusted CLI for an existing registered account; there is no public promotion endpoint.

New passwords use **Argon2id, 64 MiB, three iterations, one lane**, with unique salts. Both previous scrypt formats remain verifiable and upgrade after successful login with a compare-and-set guard against resets. Per process, password work is limited to two running/eight queued jobs with a three-second queue wait.

Access JWTs expire after **15 minutes**. An opaque, rotating refresh cookie has an absolute **seven-day** family lifetime. Both cookies are HttpOnly, SameSite=Lax and Secure in production; the only explicit HTTP exception is an unlaunched loopback preview. Refresh hashes/reuse state are in Redis and an independently revocable anchor is in MongoDB. Refresh reuse revokes the family; disable/delete/reset/role changes invalidate the Mongo session anchors. Clients coordinate refresh across tabs and refresh protected navigation through `/session/refresh`.

Login is limited to five attempts per 15 minutes per IP and normalized identifier, with a separate 15-minute lockout after five failed credentials. General API traffic is limited to 100 requests/minute per client IP, plus endpoint-specific limits. Redis security failures fail closed. Signup requires explicit terms/privacy consent and an 18+ affirmation; it does not collect a birth date or fabricate consent for imported users.

## Customer, provider and workforce workflows

- Customers discover catalogue services and approved professionals, compare availability/rates, use cart/checkout, manage owned bookings, reschedule/cancel where permitted, save services, leave eligible completed-booking reviews, edit their profile and receive support responses.
- Professional reservations support hourly, eight-hour full-day and twenty-weekday monthly arrangements. Transactional provider locks prevent overlapping reservations; server prices and idempotency keys prevent stale/altered checkout totals. Professional reservations currently retain `payment_status=pending`; they do not run online payment collection.
- Providers manage their own profile/rates/availability, submit private verification documents, view bookings/reviews and start/complete assigned queue work. Publication/verification requires administrator review. Editing reviewed data can return a profile to pending review.
- Business workspaces provide worker membership, shifts, check-in/out, late/absent/corrected attendance, correction approval, hours/timesheets and CSV reports. Overlaps and cross-business access are rejected. Timezone/grace settings and recurring service arrangements persist. Retention preferences are recorded; automatic workforce-history erasure and payroll are not implemented.

Interfaces include loading/empty/error states, light/dark preference, responsive workspaces and role-specific mobile navigation. Mobile uses four or five primary tabs, an administrator More sheet, safe-area spacing and keyboard-aware hiding. Automated viewport/axe checks are part of acceptance; actual iOS Safari, screen-reader and device testing remain separate.

## Queue, live updates and notifications

Bookings issue a durable internal service-token ID and a human-readable queue label such as `TKN-YYYYMMDD-0001`. Sequences are scoped to a service and day; **labels can repeat across services**. All detail/mutation links use the internal token ID plus server ownership checks. Labels are never authentication credentials.

A catalogue cart is treated as one bundled appointment and one queue for its sorted service combination. Provider reservations use the provider scope. MongoDB counter/allocation records preserve uniqueness after Redis key loss; unused reservations can leave gaps. Redis supplies atomic candidates, while the booking and token write remain transactionally linked. Administrators call next, assign eligible providers, skip, cancel or mark no-show; providers start/complete only their assignments. Versions reject stale competing updates. Rescheduling and older booking controls keep queue state synchronized.

Customer tracking shows position, tokens ahead, estimated wait and current service. Estimates are calculated from recorded durations/current progress, not promised arrival times. Follow-ups, individual/service/all-user announcements and dismissible popups persist in MongoDB. Large notification campaigns resume in the worker with per-recipient deduplication.

Redis pub/sub sends user-scoped invalidation hints through `/api/live` WebSockets in `npm start`; authenticated `/api/updates/stream` SSE is the fallback. Frames contain no customer records: browsers reload authorized APIs. Streams close periodically for reauthentication; reconnect/focus/online events recover durable data. Offline mutations are not queued. A stored future follow-up date is not an automatic reminder service.

## Administration and reports

Administration includes searchable/paginated account records and booking history; block/unblock and soft deletion; super-admin-only role changes; provider document approval/rejection/suspension; category/service CRUD, archive/restore and provider associations; banner upload/scheduling/reordering; pricing/content settings; bookings/queues/follow-ups/announcements; reviews, support/contact inboxes; payments/refunds/receipts; and audit logs.

Self-removal and removal of the last active administrator/super administrator are blocked. Soft deletion retains booking/audit history and is not irreversible personal-data erasure. Administrators do not receive blanket access to private workforce records.

Uploads accept bounded JPEG/PNG/WebP images and provider PDFs. Images are decoded/re-encoded, size/pixel bounded and stripped of metadata; private provider documents remain owner/admin-authorized downloads. Files live in MongoDB GridFS. PDF signature/structure checks are not antivirus or content-disarm scanning; deploy a scanning/quarantine service if required by the operating model.

Reports filter by UTC booking-creation date, source and payment status, with a one-year/10,000-record bound. They expose actual collection/refund totals, token waiting/service durations and provider completion/performance, plus CSV/PDF downloads and receipts with real references. Missing measured durations remain null rather than invented zeroes. Performance describes recorded assignments/transitions, not an independent quality rating. Exported values are spreadsheet-formula escaped.

Catalogue policy defaults remain the inherited sample **10% discount / ₹49 visit fee / ₹999 waiver threshold**, editable through `catalog_discount_percent`, `catalog_visit_fee`, `catalog_fee_waiver_threshold`. Booking creation reads the policy under the same catalogue lock used for edits. Review these sample commercial terms before accepting work.

## Payments, recovery and maintenance

Customers, assigned vendors and administrators can open **Address & live location** from bookings and service-tracking/queue cards. Customers save a written address, arrival instructions and optional map pin. Both participants can separately opt into GPS sharing; closing or disabling GPS retains the last saved point with timestamps. Administrators see the same booking-scoped map. GPS is off by default, expires after four hours per activation and retains only the latest point for up to seven days unless removed. [Map setup, privacy and operating limits](docs/BOOKING-LOCATION.md) explain browser closure, HTTPS, navigation, permissions and storage.

Catalogue cash bookings begin unpaid; service completion never records cash collection. An authorized administrator records an exact amount and receipt reference after service starts. Online catalogue payments need Razorpay/Stripe server keys and signed webhooks; amounts/currency come from stored bookings. Raw card numbers/CVVs are not stored. Delayed capture after cancellation queues a refund without reopening the appointment; durable jobs retry and only provider-confirmed success marks a refund complete. Provider bookings, business subscriptions, automated commissions/tax settlement and cash-refund automation remain outside gateway scope.

Configure gateway/mail variable names from [.env.example](.env.example). The optional HTTPS reset-mail adapter accepts `POST {to, subject, text}` using `EMAIL_DELIVERY_TOKEN`. Without it, `/login/reset` clearly reports recovery unavailable. Requests are generic; tokens are hashed, single-use and expire in 30 minutes. Delivery runs after the response and is not a durable mail queue. Email ownership verification, general transactional email and mobile push are not implemented. Live gateway signing/delivery and actual email delivery require external test evidence.

The supervised worker runs approximately every minute: refund reconciliation, abandoned unpaid reservation expiry, expired-session cleanup, pending notification fan-out and optional daily encrypted backup. `npm run maintenance` performs one maintenance cycle. [BACKUPS.md](docs/BACKUPS.md) documents `backup:key`, `backup`, `backup:verify`, protected keys and historical restore checks. AES-256-GCM snapshots preserve BSON types/GridFS/indexes and verify restoration in a generated disposable QA database. They are bounded local snapshots, not offsite backups or point-in-time recovery.

## Testing and validation

Run heavy suites/builds sequentially on constrained machines. Integration helpers use guarded isolated `urbankare_test_*` databases; browser tests require a separate QA database and matching server/runner Redis prefix. **Never run acceptance fixtures against `urbankare_mongo` or production data.**

```powershell
npm run lint
npx tsc --noEmit
npm run test:logic
npm run test:payments
npm run test:platform
npm run test:operations
npm run test:auth
npm run test:security
npm run test:queue
npm run test:admin
npm run test:uploads
npm run test:client
# Or all TypeScript backend tests sequentially:
npm run test:all
npm run test:db
npm run security:audit
npm run build -- --webpack
# Start the QA production gateway before this command:
npm run test:e2e
```

See [browser setup](tests/e2e/README.md), [requirements](docs/REQUIREMENTS.md) and [validation results](docs/VALIDATION.md). The complete TypeScript suite passed **119/119**, followed by **12/12 focused startup checks** containing one new shutdown regression. All **53 distinct Chrome checks** have passing latest results across the recorded runs; **9 selected WebKit checks** also passed. TypeScript, lint and Windows/Linux production builds passed. Cached API p95 measured **34.86 ms** over 60 sequential warm local requests. These are recorded local results, not production load/failover or actual Safari certification. No 10,000-concurrent-user guarantee is made. Payment network tests use simulated provider responses.

## Complete source delivery

Every implementation file is in this workspace. To create a portable source archive in logical project folders, run:

```powershell
npm run export:source
```

This creates `artifacts/urbankare-source.tar.gz` and `artifacts/urbankare-source.manifest.json`. The archive includes application source, configuration templates, tests, public assets and documentation, with an embedded file-hash manifest. It excludes installed dependencies, build output, environment credentials, database files, uploaded documents and private test artifacts. The exporter rejects symlinks and scans allowlisted content against configured private credential values before publishing the archive. This source snapshot is separate from an encrypted database backup. Extract it, install from the lockfile with `npm ci`, and follow the fresh-environment setup above.

## Public launch boundaries

Analytics is **off**: no GA property, measurement code or analytics cookies are installed. Contact, privacy/terms/cookie/refund drafts and SEO metadata are implemented, but legal identity, monitored domain mail, domain/DNS/HTTPS, copyright/image rights and operational acceptance need the real operator. `PUBLIC_LAUNCH_READY=false` controls publication metadata/draft labels; it does not block application routes. Keep previews behind real access controls.

Business/contact source defaults are deliberately empty rather than invented. The supplied WhatsApp configuration does not establish a legal business name/address or monitored support/grievance mailboxes. Those verified operator inputs and review or replacement of illustrative catalogue/profile content remain necessary to meet the no-placeholders launch requirement; draft policies and sample catalogue records are not completed business configuration.

Rotate any credential previously shared in conversation before exposure. MFA, third-party identity checks, production malware scanning, external immutable audit storage, managed disaster recovery and production load certification are not supplied by this repository. Do not publish traces, backups, environment files or private provider evidence. [Security review](docs/SECURITY-AUDIT.md), [launch configuration](docs/LAUNCH-CONFIGURATION.md) and [legal launch checklist](docs/LEGAL-LAUNCH.md) describe the remaining conditions without claiming blanket security or legal compliance.

## Delivery checklist and assumptions

- [x] Responsive mobile bottom tabs/More, desktop sidebars, consistent icons, safe areas, keyboard handling, skeleton/error/empty states, dark mode and automated accessibility checks.
- [x] Shared sign-in, private environment seed, Argon2id, 15-minute JWT access, rotating/revocable Redis refresh families, server roles, admin 404, lockout and audit records.
- [x] Full application MongoDB storage, Redis cache/limits, atomic queue allocation, distributed locks, transaction/idempotency guards and document versions.
- [x] Admin users, banners/uploads, categories/services, payment ledger/refunds/receipts, queues, notifications, provider evidence, reports and ongoing-service views.
- [x] Customer tokens/progress/timelines, live updates, notification history, booking history and authorized receipts.
- [x] Provider applications/documents, review status, assigned queue and start/complete actions.
- [x] Environment example, protected seed/setup scripts, Docker web/worker plus MongoDB/Redis configuration, executed tests, encrypted backup/restore and complete source export.
- [ ] External launch acceptance: verified business/legal/contact details and commercial content, domain/DNS/HTTPS/email, real payment-provider setup, production data services, actual Safari/devices, offsite recovery and operational review.

Assumptions: INR is the application currency; queue labels are unique per service/day and internal IDs resolve them; a catalogue bundle is one appointment/queue; reports use UTC booking-created cohorts; missing duration measurements remain absent; imported history is preserved through soft deletion. Local MongoDB/Redis are private development services. Analytics stays off as requested. The WhatsApp number is configured, while business identity, monitored email and domain details must come from the operator.
