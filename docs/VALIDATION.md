# Vendor onboarding and administrator oversight — 27 October 2026

GitHub publication preflight corrected an export-filter omission: the authored `app/api/uploads` route directory must be included while actual user-upload directories stay excluded. Both upload API handlers are now mandatory export entries. Earlier archive entry counts below describe older snapshots; the current source manifest records the latest package. No runtime application behavior changed for this packaging correction.

The administrator can create a pending vendor for an existing or new account, attach a private government identity photo with permission, then separately approve/reject/suspend or block the account. A masked Aadhaar photo is the primary choice, with viable alternative photo IDs; manual name/photo/masking review is required. [PROVIDER-ADMIN.md](PROVIDER-ADMIN.md) records the exact workflow, database collections, migration behavior and identity/legal boundaries.

| Check | Result | Evidence |
| --- | --- | --- |
| Onboarding, existing admin and marketplace backend coverage | **11/11 passed**, no skips | `artifacts/provider-admin-backend-final.log` |
| Upload/location regressions | **21/21 passed**, no skips | `artifacts/provider-admin-regressions.log` |
| Final identity migration and registration-policy regression | **10/10 passed**; overlaps the onboarding tests above | `artifacts/provider-admin-policy-final.log` |
| Focused lint | **Passed**, no warnings/errors | `artifacts/provider-admin-static-checks.json` |
| Production build and TypeScript | **Passed**, standalone sanitization passed | `artifacts/provider-admin-build-final.log` |
| Chrome mobile vendor administration | **1 full journey passed** at 320px, including private-file ownership, approval, blocking/session denial, activity filtering and automated WCAG checks | `artifacts/provider-admin-chrome.log`, `artifacts/provider-admin-chrome.json` |
| Windows WebKit mobile vendor administration | **1 full journey passed**, including the final suspended document-panel state and actual mobile More-sheet navigation | `artifacts/provider-admin-webkit.log`, `artifacts/provider-admin-webkit.json` |
| Dependencies | **0 known vulnerabilities** | `artifacts/provider-admin-npm-audit.json` |
| Source/configuration scan | One previously reviewed synthetic URI candidate, no exposed-file candidates, 22 environment names checked | `artifacts/security-audit.json`, `artifacts/security-audit-review.json` |

The new tests cover forged roles, missing consent, foreign/reused image ownership, pending-only creation, duplicate applications, hashed new-account passwords, no sensitive payload in audit/activity, manual identity checks, stale/superseded reviews, PDF rejection for identity evidence, rejection/suspension/blocking, unblock without republication, existing-booking preservation, legacy profile re-review and filtered/paginated activity. An explicit synthetic category is seeded inside each affected isolated fixture; tests no longer depend on demo catalogue seeding, which the application no longer performs automatically.

Browser acceptance uses generated users and private synthetic image fixtures in a dedicated QA database; no real identity photo or business account is submitted. The first Chrome attempt exposed an overly exact label locator; the fixture now uses the control's accessible role/name. The first WebKit attempt navigated natively before an in-flight Next refresh committed; the fixture now waits for the updated state and follows the actual mobile More-sheet link. Runtime-error and accessibility guards remain enabled. The document panel now reloads alongside changed publication/application status so account blocking cannot leave an old approved status displayed. These checks use desktop automation engines, not actual iOS/Safari or physical mobile devices.

The activity feed covers recorded administration/catalogue edits, customer/vendor bookings, queues, payments, account events, support and announcements. It projects safe metadata rather than raw auth/audit/identity/location payloads. It does not invent missing historical events, track visitor clicks or override workforce membership rules. Existing catalogue and ongoing-service boards remain in the admin navigation. Broader historical full-suite, container, physical-device and deployment claims below are unchanged; they were not rerun in full for this feature.

The temporary vendor QA gateway was stopped and only `urbankare_test_e2e_provider_20261027` plus its 52 remaining isolated Redis keys were removed. The normal app was restarted at `http://localhost:3000/` against `urbankare_mongo`; initialization retained 48 services, 12 categories and four original catalogue professionals. The maintenance/backup worker was restarted; it is not a Windows startup service. Runtime readiness and worker metadata are in `artifacts/provider-admin-local-readiness.json` and `artifacts/local-worker-status.json`. The source export excludes the database, private configuration, uploads and backup keys.

# Booking maps and location validation — 27 October 2026

Booking-scoped addresses, service pins, opt-in customer/professional GPS, administrator views and final-location notifications are implemented. [BOOKING-LOCATION.md](BOOKING-LOCATION.md) describes access, storage, retention, setup and browser limits. These are focused results for this feature; the historical full-suite and Linux-image results below were not repeated for the map changes.

| Check | Result | Evidence |
| --- | --- | --- |
| Location backend and registration policy | **13/13 passed**, no skips | `artifacts/map-backend-verified.log` |
| Production build and TypeScript | **Passed**, standalone sanitization removed no private files | `artifacts/map-release-build.log`; `artifacts/map-final-types.log` |
| Focused application/test lint | **Passed**, no warnings/errors | `artifacts/map-lint-verified.log`; `artifacts/map-final-test-lint.log` |
| Chrome journeys | **2/2 passed** | `artifacts/map-browser-release.log`, `artifacts/map-browser-release.json` |
| Windows WebKit journeys | **2/2 passed** with the emulated timestamp correction described below | `artifacts/map-webkit-final.log`, `artifacts/map-webkit-final.json` |
| Dependency audit | **0 known vulnerabilities** | `artifacts/map-npm-audit-final.json` |
| Source/environment heuristic review | **0 confirmed credential leaks, 0 exposed-file candidates**; one previously reviewed generated test URI candidate; 22 environment names checked | `artifacts/security-audit.json`, `artifacts/security-audit-review.json` |

Backend acceptance covers persisted role/ownership checks, consent, versioned address edits, concurrent sequence ordering, fresh timestamps, atomic final-point saving, one-time stored notifications without copied coordinates, stale-session rejection, reassignment, account blocking, closed services, forgetting GPS and retention that cannot be extended by merely restarting sharing. Fixtures use separate MongoDB databases and Redis prefixes.

Both browser engines exercised customer, assigned professional and administrator access, actual map tile rendering, Google Maps destinations, 320/390px layouts, consent before GPS/tiles, last-point preservation after navigation, the stored popup, point removal and denied-GPS/manual-address fallback. Light/dark automated WCAG checks passed without rule exclusions. These use emulated GPS, not physical devices. Successful WebKit screenshots are retained in `artifacts/map-webkit-final-e2e/`.

The initial Windows WebKit run rejected its emulated fix because the driver produced a timestamp 1000 times the expected Unix-millisecond value (year 58787). Its trace recorded an API 400 `Invalid ISO datetime`. A WebKit-only browser fixture now normalizes precisely that synthetic timestamp when it is within two minutes of the current time after division by 1000. Production location code and server freshness validation remain unchanged. The failing report remains in `artifacts/map-webkit-release.log`; this is not certification of Safari or native device GPS.

Acceptance also corrected dark status-badge contrast and the accessible name of the existing ongoing-service link. No journey history is stored. The app retains the last acknowledged point for seven days, with a four-hour sharing session limit; force-closing/offline devices cannot guarantee a final request or notification. HTTPS is required for deployed GPS. Actual iOS/Android behavior, background suspension, external production tile capacity and the broader launch/legal/payment boundaries below remain operator acceptance work.

At this feature handoff the normal development app was restored at `http://localhost:3000/`, using `urbankare_mongo` with 48 services, 12 categories and four original professionals. Home/readiness returned HTTP 200; MongoDB transactions and Redis were healthy (`artifacts/map-local-readiness-final.json`). The maintenance/backup worker was restarted with an empty error log; it is not a Windows startup service. The exact disposable location QA database and its 60 Redis keys were removed after its gateway stopped.

A fresh encrypted snapshot passed restore-and-compare verification for **52 collections / 196 documents**, including indexes; the disposable verification database was removed (`artifacts/map-backup-final.log`, `artifacts/map-backup-verify-final.log`). Counts describe that snapshot only. Snapshot SHA-256: `3a4e8e64a7ef8884aedb4b867c94816c08bca1b86bea3b1a5e5b3f89190500a8`. The snapshot/key stay outside the source export; [BACKUPS.md](BACKUPS.md) describes recovery. The source archive is regenerated by `npm run export:source`, with an explicit source allowlist, private-configuration comparisons and a SHA-256 manifest.

# Local startup update — 26 October 2026

Automatic local Docker/MongoDB/Redis startup, installation-time setup, duplicate dev-server reuse and Windows Webpack selection were added and exercised. See [LOCAL-STARTUP.md](LOCAL-STARTUP.md) for the current command behavior, focused test evidence, restored database snapshot and current localhost:3000 preview. The broader implementation results below remain historical application acceptance evidence; the full suite was not repeated for these launcher changes.

# Expanded requirements validation — 25 October 2026

This section records the expanded JWT/Redis queue/administration/mobile implementation. The earlier migration/security report below is retained as historical evidence and does not establish acceptance of these newer changes.

| Check | Latest result | Evidence |
| --- | --- | --- |
| All TypeScript backend tests | **119/119 passed**, 300.8 seconds, no skips | `artifacts/backend-acceptance.log` |
| Shutdown, origin and configuration regressions | **12/12 passed**, including one additional shutdown regression after the full suite | `artifacts/process-lifecycle-acceptance.log` |
| Payment-signature tests | **3/3 passed** | `artifacts/payment-signatures-requirements.log` |
| Database concurrency smoke | **Passed**: 60 distinct customers / 25 places, rollback, idempotency and payment ownership | `artifacts/concurrency-requirements.log` |
| Private identifier seed regression + container validation | **12/12 passed** after allowing private aliases in environment seeding | `artifacts/auth-seed-regression.log` |
| TypeScript | **Passed** on Windows; current Linux image build also completed TypeScript validation | `artifacts/typecheck-acceptance.log`; Docker build logs |
| ESLint | **Passed**, no warnings/errors; final launcher changes checked separately | `artifacts/lint-acceptance.log`, `artifacts/lifecycle-lint.log` |
| Production build | **Passed** on Windows and Linux, with standalone private-file sanitization | `artifacts/build-acceptance.log`, `artifacts/docker-web-final-build.log`, `artifacts/docker-worker-final-build.log` |
| Chrome acceptance | **53 distinct checks have passing latest results across the recorded runs**; this is an aggregate, not one uninterrupted clean run | `artifacts/chrome-expanded-summary.json` |
| Selected Windows WebKit acceptance | **9/9 passed**: password controls, mobile navigation, four dark pages, renewal/WebSockets, responsive behavior and actual rate limits | `artifacts/browser-webkit-acceptance.json` |
| Cached API p95 | **34.86 ms**, 60 sequential warm HTTP samples on the local gateway; target <300 ms | Latency attachment in `artifacts/browser-final-core.json` |
| Compose configuration | Local default, optional full-stack profile and external-service production config validated | `tests/container-config.test.ts`; synthetic configuration, no secrets printed |
| Linux container runtime | **9/9 passed**: private-file exclusion, isolated DB initialization, mapped-port readiness, non-root execution, catalogue, Argon2/auth/RBAC, WebSockets and graceful web/worker shutdown | `artifacts/container-verified.log` |
| Dependency audit | **0 known vulnerabilities** in the full installed tree | `artifacts/npm-audit-acceptance.json` |
| Source/configuration review | **0 confirmed leaked credentials, 0 exposed-file candidates**; one heuristic test-template finding reviewed; 19 environment names checked; no Git history available | `artifacts/security-audit.json`, `artifacts/security-audit-review.json` |
| Encrypted backup and restore | **49 collections / 179 documents verified**, including recreated indexes; disposable verification database removed | `artifacts/backup-acceptance.log`, `artifacts/backup-verify-acceptance.log` |

The imported application database was initialized without overwriting its records (48 services, 12 categories, 4 original professionals at that check). The requested administrator was seeded into the existing account using the protected environment; its role is SUPER_ADMIN and its password uses Argon2id. The initial seed rejected the non-email private identifier; the seed now accepts the same bounded private identifiers as shared sign-in, and its regression passed before the successful rerun. No credential values are included in these records.

New backend coverage includes JWT tampering/expiry/revocation, refresh rotation/reuse, five-failure lockout, current role/state checks, Redis window/caching/lease behavior, scoped token uniqueness even after Redis loss, duplicate display labels, version conflicts, provider concurrency, reschedule rollback/history, notification audience isolation, provider evidence review, bounded image normalization/private GridFS ownership, reports with measured versus missing durations, and client renewal retries preserving request bodies and idempotency keys.

Gateway tests simulate provider responses; they do not certify live charges or refunds. Actual Safari on macOS/iOS, physical mobile keyboards, independent penetration testing, real domain/TLS/email/gateway configuration, uploaded-PDF malware scanning and offsite recovery remain separate operational acceptance tasks. Analytics remains off.

Both Linux image targets build successfully without private environment files. The retained local tags are `urbankare-web:validated` and `urbankare-worker:validated`. Runtime acceptance passed all nine checks using a generated isolated database and temporary port 3004 mapped to container port 3000. The worker stopped with exit 0; the web gateway stopped in 1.063 seconds with Next's documented SIGTERM exit 143, without OOM or forced killing. Owned QA containers, the generated container database, its Redis keys and temporary environment file were removed. This verifies the tested local Linux image path, not an external production deployment or OS-image vulnerability certification.

Chrome evidence is drawn from `browser-requirements-public.json`, `browser-final-core.json`, `browser-final-workflows.json`, `browser-acceptance-workflows.json`, and `browser-navigation-acceptance.json` in `artifacts/`. The summary keys each check by its complete suite/title path, preserving separate desktop/mobile accessibility cases. All 53 latest distinct results pass, without disabling accessibility rules or application rate limits. QA used `urbankare_test_e2e_requirements_20261025` and its own Redis prefix; the imported application database was not used for browser fixtures.

Failures found and resolved during acceptance remain documented: dark-page contrast and search heading order; an auth navigation race after cookie renewal; proxy headers overriding public-image caching and private-document sandboxing; and container public-origin handling under host-port mapping. Shutdown review added explicit handling for requested signal termination while preserving failures and forced kills. The initial container assertion incorrectly required exit 0: the installed Next 16.4 `start-server.js` deliberately exits 143 after asynchronous SIGTERM cleanup. The corrected assertion accepts 0/143, rejects OOM/forced shutdown and requires completion before the wrapper's kill deadline. Test fixtures now capture the actual login response before native navigation and wait for loaded service results before following another link. The latter prevents abandoning a streamed loading boundary; the runtime-error guard remains enabled. Workforce acceptance encountered a real local Mongo monitor timeout during a page load, then an outdated selector for the replaced mobile dropdown. Its final independent run passed the entire attendance/correction/isolation flow and keyboard-accessible bottom tabs/More navigation. The timeout is not evidence of production reliability under load.

The latest backup is `.data/backups/encrypted/mongodb-urbankare_mongo-2026-10-25T15-16-52-844Z-240d64fb-06c8-4355-8f99-53d8c93dca52.ukbackup`: 199,771 encrypted bytes, SHA-256 `d523831ef8485b2b37272fb039cf26266eeb3de5b6007600deb6d25fcc5f78c3`. Counts describe that snapshot, not a live business metric. The historical snapshots below remain retained.

The current nine-check WebKit run is additional selected coverage. It does not clear every older Windows WebKit diagnostic recorded below, certify Safari, or establish physical keyboard/touch behavior. No live payment/refund, mailbox, domain/DNS, public HTTPS, offsite recovery, production load or independent penetration-test claim is made.

At local handoff, the normal application was restarted on `http://localhost:3002/` against `urbankare_mongo`, with forwarded-header trust disabled. The home page and readiness endpoint returned HTTP 200; readiness confirmed MongoDB transactions and Redis. The hidden maintenance supervisor and worker were restarted with backups enabled, a configured protected key and an empty error log at 15:34 UTC. Current process metadata is in `artifacts/local-worker-status.json`. This worker is not an automatic Windows startup service; the computer and Docker services must remain available.

---

## Archived baseline before the expanded requirements

# Migration and security validation — 25 October 2026

This archived report covers the MongoDB + Redis baseline before the expanded requirements, on Windows with Node.js 24 and Next.js 16.4.3. At that point it superseded the earlier SQLite validation report. Tests used generated isolated databases against this project's local MongoDB replica set on port 27018 and Redis on port 6380. Results and process states in this archived section are historical, not a current runtime inventory or acceptance of subsequent changes.

## Confirmed automated results

| Command | Result | Main coverage |
| --- | --- | --- |
| `npm run test:logic` | **20/20 passed** | Request origins, booking rules, gateway routing/state and refunds |
| `npm run test:payments` | **3/3 passed** | Payment signature validation |
| `npm run test:platform` | **6/6 passed** | Catalogue policy/QA cleanup, marketplace, workforce, customer/admin records and password recovery |
| `npm run test:operations` | **25/25 passed** | Service operations and Redis behavior |
| `npm run test:db` | **Passed** | MongoDB smoke checks, including 60 competing customers against 25 available booking places |
| `npm run test:security` | **10/10 passed** | Streaming request limits, origins, contact consent/admin access, versioned registration consent, strong password hashes/reset races, encrypted backup/restore/tamper checks |
| `npm run lint` | **0 errors, 0 warnings** | Authored source checks; generated/private artifacts excluded |
| `npm run build -- --webpack` | **Passed, exit 0** | Compilation, TypeScript, page generation, standalone tracing and private-file sanitizer |
| `npx tsc --noEmit` | **Passed, exit 0** | Final source and strengthened browser-test typing; evidence in `artifacts/typecheck-final.log` |
| `npm audit` | **0 known vulnerabilities** | Full installed dependency tree at the recorded check; compatible updates applied |
| `npm run security:audit` | **0 source / exposed-file candidates** | Limited signature scan and 16 environment-variable names checked without printing their values |

The latest backend suites total **64 passing tests**, plus the separate concurrency smoke command. The platform run completed in approximately 34 seconds with no failures, cancellations or skips. Its assertions include provider approval, interval collisions, authoritative prices, idempotency, ownership/business isolation, attendance corrections, private administrator login, concurrent account deactivation, service soft deletion, scheduled banners and password-reset replay/session revocation. The archived-service favorite-removal and review-ID operator-injection regressions passed. Test fixtures select their own database names and guard cleanup; they do not load the imported application database.

Gateway network behavior is simulated where applicable. Passing these tests does not verify live provider charges, refunds or email delivery.

## Data migration and administrator setup

The read-only legacy import into `urbankare_mongo` verified **31 collections and 159 documents** using per-collection counts and canonical content hashes. This is the migration snapshot, not a current business metric. Retained evidence:

- `.data/backups/before-mongodb-2026-10-25T09-39-49-930Z.sqlite`
- `.data/backups/mongodb-migration-2026-10-25T09-39-49-930Z.json`

The importer requires an empty target and does not overwrite existing data. SQLite references remaining in production source/documentation concern this legacy import and retained backup; application runtime storage is MongoDB, with Redis for shared limits/cache/update transport.

The requested private administrator was configured through the trusted bootstrap path with protected input. No actual login ID, password or session token is recorded here or shipped as a default credential. Public endpoints cannot grant administrator privileges.

## Build and browser acceptance status

- The final production build completed with exit 0, including standalone tracing and post-build sanitization. Evidence: `artifacts/build-final.log` and `artifacts/build-exit-code.txt`. The build uses one page-generation worker and was run with a 768 MiB V8 heap limit on this constrained workstation.
- **44 distinct Chrome checks have passing results across the main run and focused retests.** This is an aggregate, not a claim that one final 44-test run completed cleanly. The main 43-test run passed 40 and exposed three failures. The subsequent four-test run passed contact security and workforce operations; its remaining failures concerned reconnect recovery and an actual MongoDB write timeout. The final two-test run passed live service operations/reconnect and the new workforce refresh regression in 52.3 seconds. The test databases were `urbankare_acceptance_20261025_v4`, `_v5` and `_v6`, with matching isolated Redis prefixes and normal limits enabled.
- Evidence is retained in `artifacts/chrome-main/e2e-results.json`, `artifacts/chrome-regressions-initial/e2e-results.json` and `artifacts/chrome-final-regressions/e2e-results.json`, with screenshots/traces alongside each report. Corresponding logs are `artifacts/chrome-final.log`, `artifacts/chrome-regressions.log` and `artifacts/chrome-final-regressions.log`. Earlier failures remain inspectable.
- The strengthened mobile-navigation test also passed in a final Chrome run (15.8 seconds including runner startup), retained in `artifacts/chrome-navigation-final/`. `artifacts/browser-verification-summary.json` computes the latest result per distinct check across all recorded Chrome/WebKit runs.
- **All 25 Chrome accessibility/keyboard checks passed in the main run.** The initial run had 15 contrast failures, corrected without suppressing rules. Keyboard skip, focus order, dialog trapping, Escape and focus return checks passed. Initial evidence is retained under `artifacts/accessibility-initial/`.
- Regression fixes include explicit private configuration-path denial, a grid sizing correction that prevents tracking/popup overflow at 320px and 390px, explicit offline/online stream recovery with durable inbox refresh, and separating successful workforce writes from subsequent snapshot-read failures. The workforce test proves the refresh retry does not resubmit a mutation and a genuinely rejected write preserves editable input. The CSP probe inserts an unnonced script into the HTML parser stream; trusted JavaScript inserting a script dynamically is intentionally permitted by CSP `strict-dynamic` and is not a valid blocked-script assertion.
- An earlier functional browser run was interrupted after local MongoDB timeouts while lint/browser processes overlapped under memory pressure. It is not counted as acceptance. Heavy build, lint and browser work now runs sequentially; unrelated containers were not modified.
- Playwright 1.64.1 / native Windows WebKit r2370 (27.2) ran nine focused checks: the initial run passed five and failed four. The mobile navigation test had two timing errors: its broad login URL match accepted the previous destination, and it opened the menu before Home finished loading. Exact destination/visible-menu waits corrected the test without changing application behavior or suppressing runtime errors. Its final WebKit rerun passed. **Six of nine distinct WebKit checks therefore have passing results; three remain failed. This is not a clean WebKit acceptance pass.** Evidence: `artifacts/webkit-initial/`, `artifacts/webkit-navigation-initial/`, `artifacts/webkit-navigation-final/`, `artifacts/webkit-final.log` and `artifacts/webkit-navigation-final.log`.
- Production Compose configuration passed a quiet syntax/configuration check with non-secret validation values. No production container deployment was performed by that check.

Keep the test server and test terminal on the same isolated database/Redis namespace, with normal authorization and rate limits enabled. Do not infer a pass from the existence of a test file or an interrupted run.

Expected browser artifacts are `artifacts/e2e-results.json`, `artifacts/playwright-report/index.html` and `artifacts/e2e/`. Treat traces and screenshots as private test data; they may contain authenticated request/session information. They are excluded from deployment output.

### Remaining WebKit / Safari acceptance limits

The desktop customer journey completed booking, ownership denial, rescheduling, cancellation and login, but its runtime-error assertion failed on five background RSC requests during `/cart` reload. The trace places all five errors between reload start and the replacement-document commit; the same URLs subsequently returned HTTP 200 as same-origin prefetches. The public-route flow similarly completed its functional assertions but failed its runtime-error guard on departing-document background requests. This is consistent with the engine's documented navigation-cancellation misclassification in [Playwright issue 43120](https://github.com/microsoft/playwright/issues/43120) and the [Windows Next.js prefetch report 42823](https://github.com/microsoft/playwright/issues/42823). No CORS/CSP rules, prefetch behavior or error assertions were relaxed to hide those results.

The contact-security flow reached the private inbox and passed its preceding consent, origin, CSP and stored-text assertions, then failed browser-cookie metadata: native Windows WebKit returned `sameSite: None`. Its recorded login HTTP response correctly contained `HttpOnly; SameSite=lax`, matching the server implementation and Chrome result. The exact Playwright version's [upstream cookie tests](https://github.com/microsoft/playwright/blob/v1.64.1/tests/library/browsercontext-cookies.spec.ts#L110-L131) mark Strict/Lax reporting as expected failures on this port and [expect None for supplied Lax cookies](https://github.com/microsoft/playwright/blob/v1.64.1/tests/library/browsercontext-cookies.spec.ts#L165-L201). This does not prove the port's issue is metadata-only or establish cross-site cookie enforcement.

Actual Safari on macOS/iOS is unavailable on this Windows workstation. Before public launch, run supported Safari/WebKit acceptance, including cookie behavior, keyboard/touch use and live checkout on the intended HTTPS domain. Do not treat the passing Chrome checks or these diagnosed Windows limitations as Safari certification.

## Encrypted backup and configuration evidence

The final `urbankare_mongo` snapshot was restored into a generated isolated verification database. **44 collections and 176 documents** matched, including recreated index specifications; the verification database was removed afterwards. The AES-256-GCM encrypted file size was 191723 bytes, with SHA-256 `fa75ef20d1e14ec41344ab344e9f03ed0dd5d1d12bc72dfbb28ddc2011997228`. Evidence: `artifacts/backup-final.log` and `artifacts/backup-verify-final.log`. An earlier 43-collection/173-document snapshot also passed verification. See `docs/BACKUPS.md` for protected storage and operating limits.

Before the final snapshot, the exact historical marketplace-fixture cleanup revoked zero remaining QA administrator roles and withdrew one matching QA provider. Its timestamp-based `example.test` allowlist does not delete accounts, bookings or genuine reviews. No unrelated accounts were modified. The final source scan reported zero candidates/exposed files, and a separate application-source/static-bundle search found neither of the actual private administrator credential strings.

The encryption key was generated outside the workspace with owner-only Windows file access and was never printed. Local environment/data file access was also restricted. `BACKUPS_ENABLED=true` is configured locally. The maintenance/backup worker was started as a hidden local background process at 12:57 UTC, its process and first maintenance cycle were verified, and its error log was empty. The database backup state records today's completed snapshot with no last error. Local runtime evidence is `artifacts/local-worker-status.json`; private logs and PID are under `.data/`. This process is not an operating-system startup service and needs supervision/restart after shutdown. Offsite storage and point-in-time recovery have not been configured.

At the end of this archived acceptance run, the owned QA preview server on port 3002 was stopped; local MongoDB/Redis and the actual-data worker were left running. This is not a statement of their present process state. To reopen the application against the protected `.env.local` configuration, first verify the current processes and port availability, then run `npm start -- --port 3002` in a fresh terminal without the QA database/prefix overrides. No public deployment was performed in that run.

No Git repository exists in the workspace or its parents, so historical/deleted/remote secrets could not be audited. The source-signature scan is not a complete secret detector or penetration test. The private administrator was re-bootstrapped with the stronger hash and old sessions revoked; rotate the conversation-shared password before public launch.

## Verification boundaries

- Live gateway/email integrations, production deployment, failover and production load capacity remain unverified. Local backup restoration passed; destination/offsite recovery remains an operator acceptance task. No 10,000-concurrent-user capacity claim is supported by these functional tests.
- Provider bookings retain pending-payment status; their totals are not collected revenue. Catalogue cash collection requires a separately recorded receipt.
- Provider verification records administrator checks; it is not automated third-party identity verification. Follow-up dates do not automatically send reminders, and in-app updates do not imply email/mobile push delivery.
- Responsive photo requests use bounded sizes/quality and a local fallback. Copyright/provenance for existing remote imagery still needs operator review. Automated accessibility checks do not establish complete WCAG conformance or real-device usability.
- Business identity/address, support and grievance contacts, domain/hosting/email configuration and gateway credentials remain missing. Policies remain drafts, optional analytics is off, and indexing is disabled. See `docs/LAUNCH-CONFIGURATION.md` and `docs/LEGAL-LAUNCH.md`.

See `README.md`, `docs/DEPLOYMENT.md` and `tests/e2e/README.md` for configuration, operating procedures and test isolation.
