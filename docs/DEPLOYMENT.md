# Deployment and operations

This is a deployment procedure for the current MongoDB/Redis application. Recorded checks belong in [VALIDATION.md](VALIDATION.md); this document does not certify an external deployment.

## Processes and storage

The production web process is `npm start`: a Node HTTP/WebSocket gateway fronts a standalone Next server. The gateway listener uses `PORT` or `--port`; `APP_URL` remains the externally reachable origin, including a different Docker host port. Only an explicit `--port` preview override adjusts a loopback origin. The internal Next port is `INTERNAL_APP_PORT` or listener port + 1 and binds only to `127.0.0.1`. Do not publish the internal listener. `npm run worker` is a separate supervised process for refund/expiry cleanup, durable notification campaigns and optional backups.

All authoritative application data, including GridFS upload chunks/metadata, live in MongoDB. A replica set or transaction-capable managed MongoDB cluster is required. The native driver uses snapshot reads/majority writes with bounded pools and transaction timeouts. Redis supplies shared rate limits, refresh-family state, public catalogue cache, queue candidates and user-scoped pub/sub. MongoDB retains session anchors, queue counters/allocations, notifications and financial history. There is no SQLite/PostgreSQL runtime fallback.

## Development infrastructure and existing data

Use Docker Engine with Compose v2 and Linux-container support; on Windows this requires a running Linux-container backend such as Docker Desktop with WSL2. The image targets use Node 24 on Alpine Linux. Registry access, enough free disk/memory for native dependency installation and the Next build, and unused host ports are prerequisites. Host-run npm commands also require Node 24 and npm. The default infrastructure command starts MongoDB/Redis and replica-set initialization; the app and worker are opt-in through the `app` profile.

```powershell
npm run infra:up
docker compose -p urbankare-infra -f docker-compose.infra.yml ps
```

| Service | Host connection | Volume |
| --- | --- | --- |
| MongoDB `rs0` | `mongodb://127.0.0.1:27018/?replicaSet=rs0&directConnection=true` | `urbankare-infra_mongo_data` → `/data/db` |
| Redis | `redis://127.0.0.1:6380` | `urbankare-infra_redis_data` → `/data` |
| Optional container backups | Worker path `/var/lib/urbankare-backups` | `urbankare-infra_encrypted_backups` |

The live local database is `urbankare_mongo`. The ports deliberately avoid unrelated services on 27017/6379. Wait for `mongo-init` to report successful writable-primary initialization. `directConnection=true` lets the host reach the published port while the member advertises its Compose hostname. This single-member, unauthenticated, loopback-only setup has no failover redundancy and is unsuitable for public database exposure.

Preserve `.env.local`; copy `.env.example` only for a new checkout. Supply a protected canonical-base64 32-byte `AUTH_JWT_SECRET`, then initialize missing indexes/catalogue records with `npm run db:init`. For the optional local app/worker containers, use `docker compose --env-file .env.local -p urbankare-infra -f docker-compose.infra.yml --profile app up -d --build`. This profile connects through the internal Compose service names and shares the local volumes. Normal `down` retains data; do not add `-v` as routine maintenance.

Host `npm run dev`, `npm start` and `npm run infra:up` automatically start and verify the exact loopback MongoDB/Redis endpoints on 27018/6380, then run the idempotent database initializer. If the engine is stopped on Windows, they use `docker desktop start --detach` and wait before Compose startup. Installation also attempts this when a local environment file exists; CI, production-only installs and Docker builds skip it, and installation failures remain recoverable on the next application launch. Use `AUTO_START_LOCAL_INFRA=false` for manually managed local infrastructure. Remote/authenticated database endpoints are never started or reconfigured by this helper. The local data services restart with Docker unless explicitly stopped. Duplicate development launches reuse this workspace's reachable existing server; its original terminal owns shutdown. See the root README for recovery behavior and current startup verification evidence.

## Legacy import and cutover

The verified 25 October 2026 import recorded 31 collections / 159 documents in `urbankare_mongo`. Preserve:

- `.data/backups/before-mongodb-2026-10-25T09-39-49-930Z.sqlite`
- `.data/backups/mongodb-migration-2026-10-25T09-39-49-930Z.json`

These are private historical evidence, not the current live database or its current record count. New writes are not copied back to the SQLite source.

For another legacy source, stop old writers, preserve the old deployment/backup and select a **new empty** MongoDB target. Do not initialize or seed that target first. Inject its connection through protected configuration and run:

```powershell
npx tsx --env-file-if-exists=.env.local scripts/migrate-to-mongodb.ts .data/urbankare.sqlite
```

The importer opens the source read-only, takes a consistent source backup, preserves IDs, imports every source table and checks counts/canonical SHA-256 content hashes. Catalogue/professional payload strings become objects. It refuses populated targets; a failed partial import needs investigation and a different empty target for retry. Never rerun it against the completed live database. After verification, initialize application indexes, start the MongoDB app and perform acceptance checks. A rollback after new writes requires explicit reconciliation, not merely restarting the legacy app.

## Required production configuration

Use the production `docker-compose.yml` for web/worker processes with externally provisioned authenticated TLS data services. Build images without runtime secrets. Both container startup and host-run `npm start` / `npm run worker` validate the signing key and origin. Outside the explicit HTTP loopback preview, they require MongoDB URI username/password authentication with `mongodb+srv` default TLS or `mongodb://` plus `tls=true`/`ssl=true`, and a `rediss://` URL containing a password (named ACL or default user). They reject explicit TLS disablement, invalid-certificate/hostname bypasses, Redis query overrides and `NODE_TLS_REJECT_UNAUTHORIZED=0`. Parsing opens no connection: actual credential validity, server certificates, least privilege, redundancy and network policy still require deployment verification.

| Variable/configuration | Requirement |
| --- | --- |
| `MONGODB_URI`, `MONGODB_DB` | Authenticated TLS replica-set/managed URI, explicitly named production database, least-privilege application credentials |
| `REDIS_URL`, `REDIS_KEY_PREFIX` | Authenticated `rediss://`; unique environment namespace; memory/persistence/failover policy |
| `AUTH_JWT_SECRET` | Canonical base64 of 32 random bytes; shared across replicas; protected secret store; never a published example value |
| `APP_URL`, `COOKIE_SECURE` | Canonical HTTPS origin without credentials/query; `COOKIE_SECURE=true` |
| `HOSTNAME`, `PORT`, `INTERNAL_APP_PORT` | Public gateway binding/port; a distinct loopback-only Next port |
| `TRUST_PROXY` | Enable at the public gateway only behind an actual trusted proxy that replaces client-supplied forwarding headers |
| `MONGODB_POOL_SIZE` | Size aggregate pools across all web/worker replicas; default 20 per process |
| Gateway/mail secrets | Configure only the external integrations deliberately enabled; server-side only |
| Business/launch fields | Real legal/support/grievance details; keep preview publication disabled until review |
| Backup configuration | Opt-in worker flag, protected encryption key and durable restricted destination |

Production Compose passes signing/database/gateway/mail settings to runtime processes and keeps seed credentials out of long-running services. It defines non-root app/worker targets with dropped capabilities and a web readiness health check. The worker has no Compose health check; monitor its process, maintenance progress and errors separately. It publishes the gateway only on host loopback for an external TLS proxy. Both Linux targets built locally and passed nine runtime checks, including host port 3004 mapped to container 3000, native Argon2, authenticated WebSockets and shutdown. The retained image tags are `urbankare-web:validated` and `urbankare-worker:validated`; detailed evidence is in VALIDATION.md. Repeat deployment build/health/functional checks on the actual host and configuration. Next 16.4 intentionally exits 143 after SIGTERM cleanup; a forced kill or OOM is not a successful graceful shutdown.

For this production Compose file, place the real runtime configuration in a protected `.env.production.local` (or choose another protected path), then pass it explicitly with `docker compose --env-file .env.production.local -f docker-compose.yml …`. Compose does not automatically load Next's `.env.local` or `.env.production.local` files. Keep seed credentials in the one-shot invoking environment, not this long-running service configuration. Docker image build/start acceptance is separate from parsing Compose and unit-testing the entrypoint; see VALIDATION.md for executed evidence.

`npm start` loads shell values first, then `.env.production.local`, `.env.local`, `.env.production`, `.env`. Do not accidentally copy a workstation development file into a public deployment. Public variables must never contain database URLs, signing keys, gateway secrets, mail tokens or backup keys.

## Shared login, seed and session lifecycle

Inject `SEED_ADMIN_EMAIL`, `SEED_ADMIN_PASSWORD` and optional `SEED_ADMIN_NAME` into a one-shot trusted process; then run `npm run admin:bootstrap`. After building the worker image and verifying its external data-service configuration, the equivalent production command passes variable **names**, not values on the command line:

```powershell
docker compose --env-file .env.production.local -f docker-compose.yml run --rm --no-deps -e SEED_ADMIN_EMAIL -e SEED_ADMIN_PASSWORD -e SEED_ADMIN_NAME worker npm run admin:bootstrap
```

`SEED_ADMIN_EMAIL` accepts either a normal email or a private login identifier despite its variable name. The process preserves an existing user ID, hashes the supplied password with Argon2id, grants `SUPER_ADMIN`, audits the operation and revokes previous sessions. Remove the seed password from the invoking environment afterward. Legacy `ADMIN_BOOTSTRAP_ID/PASSWORD` supports private aliases. `admin:promote` is trusted-operator-only. All users sign in at `/login`; anonymous/nonadmin admin pages/APIs return 404. Do not publish an admin password, private alias or reusable fixture account in deployment documentation.

Canonical roles are `SUPER_ADMIN`, `ADMIN`, `PROVIDER`, `CUSTOMER`. Role changes require a super administrator; self-removal and last-active-admin/super-admin loss are blocked. MongoDB role/status and object ownership are checked server-side. Historical lowercase roles remain readable; historical opaque session cookies require a fresh sign-in after the JWT change.

Access JWTs last 15 minutes. Refresh cookies rotate within an absolute seven-day family lifetime; Redis stores hashes/reuse markers while MongoDB anchors independently revoke sessions. Reuse revokes the family. Reset/deactivation/deletion/role changes revoke anchors, so Redis unavailability cannot resurrect removed sessions. Client Web Locks/IndexedDB coordination prevents normal cross-tab duplicate rotation; arbitrary concurrent reuse is rejected. `sessionFetch` refreshes before admin API calls and retries other authenticated 401 responses once. It does not replay genuine 404, network or business failures.

Login limits are five attempts/15 minutes per IP and normalized identity plus a separate lockout after five failed credentials. General API limits are 100/minute per client IP with additional endpoint limits. The gateway replaces forwarded identity headers and the private Next child trusts that gateway. If the public gateway sits behind another proxy, configure its trust only after verifying that proxy replaces spoofed headers. Running Next directly without a trusted proxy uses a shared fallback identity.

Changing the JWT signing key invalidates access tokens but is **not** a complete incident revocation procedure: surviving refresh families may mint a new token. Revoke affected Mongo session anchors and Redis families, rotate leaked credentials/keys and investigate access logs. Administrator MFA and email ownership verification are not implemented; add an external operations-access control if required before launch.

## HTTPS, CORS and live connections

Terminate TLS at a managed proxy with renewal, redirect HTTP to HTTPS and preserve the intended host/origin. Forward WebSocket upgrades to `/api/live`. For `/api/updates/stream`, disable response buffering and allow long-lived SSE connections. Set proxy timeouts above the normal heartbeat interval; streams intentionally close after approximately four minutes to reauthenticate. Clients reconnect and fetch durable state, so pub/sub is not the sole copy of any notification.

The gateway validates browser WebSocket Origin, then opens the existing authenticated SSE endpoint internally. It ignores client command frames and sends only empty ready/update hints. Private customer data is retrieved through current authenticated HTTP APIs. Loopback preview origin checks require the configured protocol and actual host/port. No wildcard credentialed CORS is used. Host/header policy, body/time limits and network controls still need testing through the real reverse proxy.

Helmet supplies baseline gateway headers; the Next proxy adds a per-response CSP nonce and private-path denial. Production CSP excludes unsafe-eval; inline styles remain enabled for the existing UI. HSTS follows the HTTPS deployment configuration. A local Secure-cookie exception requires explicit `COOKIE_SECURE=false`, HTTP loopback `APP_URL` and no public-launch flag; it must never be used for a public HTTP site.

## Uploads, queues, reports and privacy operations

Private provider documents and public banner uploads are stored in GridFS. Images are signature-checked, pixel-bounded and re-encoded; provider PDFs have basic signature/EOF validation and are served as authorized attachments. Add malware scanning/quarantine where required. Protect database/backups as document storage; do not mount private uploads under `public/`.

Queue numbering is per service/day and can leave gaps. Public labels can repeat across services; internal token IDs are the authority. Catalogue bundles form one appointment/queue scope. MongoDB persists allocation/counter state for recovery after Redis loss. Keep assignment, rescheduling and booking transitions on the existing APIs so queue state remains synchronized.

CSV/PDF reports use UTC booking-creation date ranges, explicit payment/source filters and bounded record counts. Waiting/service durations come from recorded transitions; unavailable measurements remain null. Provider performance is operational history, not a certified quality score. Accounts/services/banners are soft-deleted to preserve history; soft deletion is not complete personal-data erasure. Handle privacy requests and retention across primary data, GridFS, backups and external mail under a separately reviewed operator policy.

## Payments, mail and worker supervision

Configure Razorpay/Stripe test credentials and public signed webhooks before accepting online payment. Verify captures, duplicate callbacks, delayed capture after cancellation, refunds and reconciliation on the actual deployment. Catalogue amounts/currency are server-authoritative. A redirect or service completion never means paid. Provider marketplace bookings remain pending-payment reservations; they are excluded from collected revenue. Cash collection requires an explicit exact-amount receipt action; cash refunds need manual reconciliation.

The HTTPS reset-mail adapter requires `EMAIL_DELIVERY_URL` and bearer `EMAIL_DELIVERY_TOKEN`, receiving `{to, subject, text}`. Its response must represent real accepted delivery. Without configuration the UI declares recovery unavailable. Links expire after 30 minutes and are single-use; reset revokes sessions. Generic request acceptance is not proof of mail delivery. After-response work is not a durable mail queue. Redact reset query parameters from proxy/hosting/error logs and test mailbox delivery/authentication.

Supervise the worker separately from web replicas. Each approximately one-minute cycle expires abandoned unpaid bookings, cleans old anchors, reconciles refunds and resumes notification campaigns. Backup scheduling is separately opt-in and uses a lease. Network gateway/mail calls stay outside retryable Mongo transaction callbacks. Shutdown handlers stop gateway streams/listeners and signal the private app; containers bound shutdown time. Test graceful termination/restart on the chosen host.

## Backups, monitoring and acceptance

[BACKUPS.md](BACKUPS.md) retains actual historical snapshot/restore evidence and key-handling procedures. Commands are `backup:key`, `backup`, `backup:verify -- <encrypted-file>`. Production Compose gives only the worker a durable encrypted-backup volume and key settings; a key file requires a real read-only container mount, not merely a host pathname in an environment variable. Backups default off until configured. Protect key recovery separately, test restoration and preserve the original migration backup.

The bounded AES-256-GCM snapshot utility preserves BSON/GridFS/indexes and verifies into a generated QA database without overwriting application records. It is not offsite storage, streaming backup or point-in-time recovery. Provision those operational capabilities separately. Redis loss expires refresh families and can reset rate windows; MongoDB preserves bookings/notifications/queue allocations. Plan persistence/failover for security availability as well as cache performance.

Monitor readiness, errors, p95/p99 latency, transaction retries/pool saturation, Redis memory/latency, active WebSocket/SSE connections, queue/notification progress, pending-refund age and backup/worker failures. Structured application error logs deliberately avoid request bodies/headers/secrets; hosting and reverse-proxy log policy must do the same. Audit records in MongoDB are not immutable against a database administrator.

Run the documented isolated tests/build/browser suite and then real-host gateway/mail/TLS/mobile checks. The local cached-read p95 <300 ms target is a measured test target, not a guarantee for uncached writes, hash operations or production traffic. No 10,000-user, failover, legal-compliance or security certification follows from using MongoDB/Redis. Keep `PUBLIC_LAUNCH_READY=false` and protect preview access until actual launch acceptance.
