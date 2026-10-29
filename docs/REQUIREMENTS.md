# Requirement traceability

This maps the expanded checklist to source and acceptance evidence. The current hosted setup uses Atlas `urbankare_mongo` and Upstash Redis in Mumbai; local development uses a separate Atlas database and Redis scope without Docker. The final backend suite passed **162/162**, and **17/17** isolated checks passed against the hosted services. See [PRODUCTION-SETUP.md](PRODUCTION-SETUP.md) for resource locations and [VALIDATION.md](VALIDATION.md) for exact browser runs, repairs and remaining limits.

The built-in public catalogue remains available for a fresh checkout without credentials. Operational deployments require persistent services and protected authentication settings; the Vercel Production environment is now configured. Implementation and passing automated tests do not establish legal compliance, live merchant acceptance, Safari hardware acceptance or an unattended offsite backup service. Existing evidence cited in the tables can predate the current hosted setup.

## 1. Authentication, accounts and roles

| Requirement | Implementation | Evidence / boundary |
| --- | --- | --- |
| One shared sign-in for all roles | [`AuthForm`](../components/platform/auth-form.tsx), `/login`, compatibility `/account` redirect | Auth-controls, account-admin and admin-catalog browser checks passed |
| Canonical SUPER_ADMIN / ADMIN / PROVIDER / CUSTOMER | [`roles.ts`](../lib/roles.ts), current Mongo role/status lookup; legacy lowercase compatibility | `tests/auth-sessions.test.ts`, `admin-management.test.ts` |
| Private environment seed; no source credentials | [`admin-bootstrap.ts`](../lib/admin-bootstrap.ts), [`bootstrap-admin.ts`](../scripts/bootstrap-admin.ts); SEED_ADMIN_EMAIL (email or private identifier)/PASSWORD, optional NAME | Seed preserves ID, grants SUPER_ADMIN and revokes sessions; `tests/auth-sessions.test.ts`; no public promotion endpoint |
| Modern password hash and legacy migration | [`password-hashing.ts`](../lib/password-hashing.ts): Argon2id (64 MiB, t=3, p=1); guarded scrypt upgrade | `tests/password-hashing.test.ts`, actual reset/upgrade race cases; per-process bounded work |
| Access 15 minutes and rotating refresh | [`auth-sessions.ts`](../lib/auth-sessions.ts), [`auth-state.ts`](../lib/auth-state.ts), refresh API | Signed JWT; absolute 7-day opaque family; Redis hash/reuse state plus Mongo anchors; `tests/auth-sessions.test.ts` |
| Revocation/reuse/disabled accounts | Mongo anchor deletion and active-user checks; reused refresh revokes family | Auth/reset/admin tests; JWT role alone never authorizes |
| Login 10/15 minutes and 10-failure lockout | Login route Redis identifier/IP-pair and identifier windows, resolved-account lockout | `tests/auth-sessions.test.ts`; separate 15-minute credential lockout |
| Nonadmin administration 404 | [`proxy.ts`](../proxy.ts), `requireAdmin`/`requireSuperAdmin` | Auth/API browser assertions; authorized resource-not-found remains 404 |
| Recovery and accessible password fields | [`password-reset.ts`](../lib/password-reset.ts), password-field/reset forms | Hashed 30-minute one-time token; reset tests; actual delivery requires configured adapter, no false delivery claim |
| Explicit consent and 18+ | [`consent.ts`](../lib/consent.ts), register API and SignupConsent | `tests/registration-consent.test.ts`; no DOB/no fabricated historical consent |
| Safe browser renewal | [`session-client.ts`](../lib/session-client.ts), SessionProvider, `/session/refresh` | Mocked tests 8/8; admin preflight and single 401 retry; browser renewal/WS check passed in Chrome and WebKit |

## 2. Administration, marketplace and workforce

| Requirement | Implementation | Evidence / boundary |
| --- | --- | --- |
| User search/filter/history/block/delete/roles | [`admin-management.ts`](../lib/admin-management.ts), admin-users UI/API | Admin-management tests; role grants only SUPER_ADMIN; self/last-active-admin protections; deletion preserves history |
| Service/category CRUD, pricing and assignments | [`platform.ts`](../lib/platform.ts), services/categories/pricing admin panels | Platform/catalog-policy tests; archive/restore/soft-delete; same transaction catalogue lock as booking quotes |
| Banner listing/upload/schedule/order | Platform banner mutations and banner-manager UI | Platform/upload tests; admin-catalog and admin-management browser specs cover file selection, preview, public image retrieval and reordering; latest browser result in VALIDATION.md |
| Provider verification and status | Provider documents/status review in admin-management and provider workspace | Identity/current-document approval required; rejected/suspended states; admin/upload tests; manual review, not third-party identity checks |
| Administrator adds vendors and requires identity photos | `admin-providers.ts`, private creation API, Add vendor form and `provider-identity.ts` | Pending-only creation, existing/new accounts, hashed initial passwords, private image ownership, current consent and explicit masking/name/photo review. [PROVIDER-ADMIN.md](PROVIDER-ADMIN.md) |
| Combined platform activity | `admin-activity.ts`, `/admin/activity`, admin-only paginated API | Recorded administration/catalogue, booking, queue, payment, account, support and announcement events; raw sensitive payloads excluded; workforce membership scope preserved |
| Private files and public images | [`uploads.ts`](../lib/uploads.ts), upload routes, GridFS | `tests/uploads.test.ts`, `tests/e2e/uploads.spec.ts`; 5 MiB/pixel limits; PDFs not antivirus-scanned |
| Customer/provider ownership and booking flows | [`catalog-bookings.ts`](../lib/catalog-bookings.ts), [`marketplace.ts`](../lib/marketplace.ts), customer/provider workspaces | Booking/marketplace/platform tests; browser booking isolation retained; hourly/full-day/monthly professional reservations |
| Saved services, reviews, profile, support | Platform customer mutations/dashboard/support admin | Platform tests; account-admin browser scenario; reviews require eligible completed booking |
| Attendance/business membership | [`workforce.ts`](../lib/workforce.ts), workforce workspace | Workforce tests/browser scenarios; role memberships, overlap prevention, correction audit, timesheets/CSV; no payroll or automatic retention purge |
| Administration audit | [`admin-access.ts`](../lib/admin-access.ts), auth-audit/platform_audit | Mutation/auth tests; application records can still be changed by privileged DB operators |

## 3. Service tokens, queues and ongoing work

Booking maps and optional customer/professional GPS were added subsequently. Focused location acceptance passed 13 backend/policy checks and two journeys each in Chrome and Windows WebKit; see the timestamp-fixture caveat and exact evidence in [VALIDATION.md](VALIDATION.md). The older aggregate totals above describe the earlier application suite.

| Requirement | Implementation | Evidence / boundary |
| --- | --- | --- |
| Per-service/day numbering with concurrency safety | [`queue-numbering.ts`](../lib/queue-numbering.ts), durable Mongo counter/allocation plus Redis candidate | `tests/service-queue.test.ts`, concurrency/recovery tests; gaps allowed, committed numbers not reused |
| Real token issue and private tracking | [`service-operations.ts`](../lib/service-operations.ts), booking transaction, tracking API/UI | Service-operations/queue tests; internal token ID disambiguates labels that repeat across services |
| Waiting/called/in-service/completed/cancelled/no-show | [`service-queue.ts`](../lib/service-queue.ts), versioned queue UI | Queue tests; call-next/skip/assign/start/complete/cancel/no-show authorization and stale-version checks |
| Provider assignment and own queue | Active persisted provider/user checks and assignment filters | Queue/admin tests; a claimed role alone cannot operate another provider's token |
| Position/current serving/estimated wait | Queue metrics and customer timeline | Actual durations/progress; estimates are not guaranteed arrival times |
| Ongoing-only workspace | `/admin/ongoing`, queue status filter | Queue backend and admin-management navigation checks passed |
| Booking location ecosystem | [`booking-location.ts`](../lib/booking-location.ts), private location API/page and responsive map workspace | Current customer, assigned professional and administrator access; service address/pin, opt-in GPS, last saved point and one-time stop notification. Seven-day point retention; no GPS after browser closure. [BOOKING-LOCATION.md](BOOKING-LOCATION.md) |
| Reschedule/cancel consistency | [`reschedule.ts`](../lib/reschedule.ts), [`queue-state.ts`](../lib/queue-state.ts) | Queue/service-operations tests; old controls synchronize current queue state |
| Scope assumptions | A catalogue bundle is one appointment/queue; provider booking uses provider scope | Public `TKN-date-sequence` may repeat elsewhere; use internal ID + ownership; unused allocation gaps are deliberate |

## 4. Live updates, follow-ups and notifications

| Requirement | Implementation | Evidence / boundary |
| --- | --- | --- |
| Actual WebSocket connection | [`gateway.mjs`](../scripts/gateway.mjs), `/api/live`, Redis-backed internal authenticated SSE | Real browser handshake/reconnect and private follow-up checks passed; rejected origins/unauthenticated sockets and malformed frames tested |
| Fallback, reconnection and shared update subscriptions | [`live-client.ts`](../lib/live-client.ts), ServiceUpdates, updates-hub | SSE fallback; focus/online refresh; bounded reauthentication; no offline write queue |
| Individual/service/all-user notifications | Durable campaign+inbox records and worker resumable batches | Service-operations tests; deduplicated per-recipient delivery; sender authorization rechecked each batch |
| Follow-ups, popup and unread/read/dismiss | Tracking/admin notifications/customer inbox UI | Service-operations tests/E2E; timestamps persist; next-follow-up field does not schedule a reminder automatically |
| Private payloads and origins | WS bridge validates Origin and auth; frames contain only hints; API fetch reauthorizes | Gateway/session tests; user-scoped Redis channels; command frames rejected |

## 5. Payments, transactions and reports

| Requirement | Implementation | Evidence / boundary |
| --- | --- | --- |
| Real transaction states and references | Catalogue gateway/cash/refund records, [`admin-reports.ts`](../lib/admin-reports.ts) | Payment/refund/admin tests; provider pending totals excluded from received funds |
| Server price/integrity and webhook verification | Payment routing/signatures, booking quote+catalogue locks | `tests/payments.test.ts`, Stripe/routing/refunds/signature tests; provider network responses simulated |
| Refund requests and reconciliation | Guarded admin request, durable jobs and worker | Only provider-confirmed success marks refunded; real gateway acceptance remains external; cash refunds manual |
| Cash collection distinct from completion | Explicit exact-amount receipt action after service starts | Service-operations/admin tests; completing a booking never fabricates payment |
| UTC date/source/payment filters and summaries | Admin reports API/UI | Up to 1 year/10,000 records; booking-creation date basis; current report tests in backend suite |
| Token wait and provider performance | Recorded queued/start/completion durations, provider assignment outcomes | Missing duration=null; average measured waits/count shown; performance is recorded workflow, not quality certification |
| CSV/PDF reports and receipts | [`admin-pdf.ts`](../lib/admin-pdf.ts), reports/payments routes | Ledger/token/performance CSV and PDF report; formula escaping; receipt requires actual reference |

## 6. Mobile, desktop and accessibility

| Requirement | Implementation | Evidence / boundary |
| --- | --- | --- |
| 320 px layout and mobile 4–5 tabs | [`mobile-navigation.tsx`](../components/site/mobile-navigation.tsx), responsive CSS | Requirements/mobile/responsive/admin/workforce browser checks passed |
| Administrator More sheet and role-aware menus | Shared role helpers, workspace navigation | Admin-management browser spec defines 320 px five-control navigation, Escape/focus return and Reports/Ongoing navigation; latest result in VALIDATION.md; hidden links are not the security boundary |
| Safe areas, touch targets and keyboard hiding | Safe-area CSS, minimum 44 px controls, visualViewport handling | Browser specs exercise keyboard resize signal; physical mobile keyboard testing still required |
| Desktop/tablet reachability | Desktop sidebar and bottom navigation breakpoints | 320/390/768/960/1023/1280 browser coverage passed |
| Dark mode, loading/empty/error states | Theme preference/provider, route loading/error views and component states | `requirements.spec.ts`, accessibility and resilience specs; theme storage is functional, not tracking |
| Keyboard/password/accessibility checks | Native controls, visible focus, show/hide buttons and axe checks | Auth-controls/accessibility specs; no claim of complete WCAG or screen-reader/iOS Safari certification |

## 7. Architecture, delivery and nonfunctional requirements

| Requirement | Implementation | Evidence / boundary |
| --- | --- | --- |
| Full MongoDB application data | [`mongo.ts`](../lib/mongo.ts), native domain collections and GridFS | Verified original import: 31 collections/159 documents; counts historical; Mongo fixtures + db smoke; no SQL runtime |
| Redis rate/cache/session/queue/pubsub | [`redis.ts`](../lib/redis.ts), auth-state/queue-numbering/updates-hub | Redis/backend tests; security dependencies fail closed; public cached reads can fall back to Mongo |
| Indexes, plain records, pagination | Native-driver projections/indexes, paginated users/tracking/inbox and bounded reports/queues | No Mongoose hydration to disable; bounded screens state limits; not every list is unbounded/export-all |
| Cached API p95 <300 ms | Cache generations and requirements E2E warm-read benchmark | Measured 34.86 ms over 60 sequential warm local requests; no production/10,000-user capacity claim |
| Docker app+Mongo+Redis and worker | Dockerfile, local infra optional app profile; production external TLS Compose | Both Linux images built; 9/9 local runtime checks passed, including mapped public origin, non-root operation and graceful shutdown; deployment-host acceptance remains separate |
| Health, logs and graceful shutdown | `/api/health`, logger, gateway/start/container-entrypoint/worker | Readiness checks Mongo replica capability+Redis; structured error metadata excludes secrets; deployment signal behavior requires host validation |
| Helmet/CORS/CSP/config privacy | Gateway headers, proxy nonce/origin/private-path checks | HTTP/security/gateway tests; no wildcard credentials; TLS and trusted-edge config still external |
| Token/rate/auth/payment tests | Unit/integration/concurrency suites, signature test and db smoke | Full TypeScript suite 119/119; signatures 3/3; concurrency smoke passed; subsequent focused startup checks in VALIDATION.md |
| Encrypted backup/restore | [`backups.ts`](../lib/backups.ts), backup CLI and worker lease | Current restore verified 49 collections/179 documents; bounded snapshot, not offsite/PITR; keys never in reports |
| Original privacy/legal/contact/SEO requirements | Consent/contact/policy/metadata/business configuration | Contacts need real monitoring; policies draft until operator review; no guaranteed legal compliance/indexing |
| No invented business/contact details or public placeholders | Empty source defaults, explicit draft labels and configurable real business fields | Operator legal name/address and monitored support/grievance contacts need verified values; illustrative catalogue/profile content needs review or replacement before launch; implemented forms do not complete these external inputs |
| Analytics off | No GA code/property/cookies installed | Optional future analytics requires explicit operator configuration and consent implementation |
| External safety/launch limits | [SECURITY-AUDIT.md](SECURITY-AUDIT.md), [LAUNCH-CONFIGURATION.md](LAUNCH-CONFIGURATION.md) | Real domain/TLS/email/gateways, MFA, malware scanning, copyright, actual Safari, load/failover and offsite recovery not certified |

No secret values appear in this matrix. QA fixtures use isolated databases and must never be pointed at imported live customer data. Test artifacts can contain synthetic cookies/private records and are not public documentation.
