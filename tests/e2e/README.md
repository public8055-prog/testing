# Browser acceptance tests

Run against a local application that is already started. Playwright defaults to `http://localhost:3000`, uses an isolated headless Edge profile on Windows, and never opens a personal browser profile. Other platforms use Playwright Chromium (`npx playwright install chromium`). Set `PLAYWRIGHT_CHANNEL=chrome` to select installed Chrome. The suite does not start or stop the web server. Run builds, lint and browser suites sequentially on memory-constrained workstations.

## Isolated MongoDB and Redis configuration

Start this project's local infrastructure, which uses dedicated ports and volumes:

```powershell
docker compose -p urbankare-infra -f docker-compose.infra.yml up -d
```

Use a fresh database for each full acceptance run. Do not use `urbankare_mongo` with imported user records or any production target. Set the same connection, database name and Redis key prefix in both the server terminal and the test terminal. Choose a unique name beginning with `urbankare_test_e2e_`:

```powershell
$env:MONGODB_URI = 'mongodb://127.0.0.1:27018/?replicaSet=rs0&directConnection=true'
$env:MONGODB_DB = 'urbankare_test_e2e_your_unique_run'
$env:REDIS_URL = 'redis://127.0.0.1:6380'
$env:REDIS_KEY_PREFIX = 'urbankare:test:e2e:your_unique_run'
$env:APP_URL = 'http://localhost:3002'
$env:COOKIE_SECURE = 'false'
$env:PUBLIC_LAUNCH_READY = 'false'
```

In the server terminal:

```powershell
# This header trust is for the loopback QA gateway only.
$env:TRUST_PROXY = 'true'
$env:HOSTNAME = 'localhost'
npm run db:init
npm run build -- --webpack
npm start -- --port 3002
```

In the test terminal, after setting the identical database/Redis variables:

```powershell
$env:E2E_BASE_URL = 'http://localhost:3002'
$env:E2E_ISOLATED_CLIENT_IPS = '1'
$env:PLAYWRIGHT_CHANNEL = 'chrome'
npm run test:e2e
npm run test:e2e:report
```

Shell values override `.env.local`. The server also needs a protected `AUTH_JWT_SECRET` as described in the root README; do not publish it in a test command or report. Verify `/api/health` is healthy before the suite. The local MongoDB replica set must be ready; a standalone `mongod` cannot support the required transactions. The suite creates multiple test accounts and exercises real Redis-backed rate limits. The isolated-client fixture assigns a separate synthetic benchmark-network IP to each test context so unrelated test users do not share one loopback allowance. It refuses non-loopback origins or databases without the required test prefix. Never enable arbitrary forwarded-header trust on a public gateway. Keep the actual limit values enabled; do not flush shared Redis or disable application limits.

## WebKit compatibility

Install the matching engine with `npx playwright install webkit`, then select it with `E2E_BROWSER=webkit`. Use a fresh isolated database/Redis namespace in both terminals when changing suites. For example:

```powershell
$env:E2E_BROWSER = 'webkit'
npm run test:e2e -- tests/e2e/public-platform.spec.ts tests/e2e/customer-journey.spec.ts tests/e2e/mobile-navigation.spec.ts tests/e2e/responsive-preview.spec.ts tests/e2e/auth-controls.spec.ts tests/e2e/image-resilience.spec.ts tests/e2e/security-contact.spec.ts
```

The live stream instrumentation in `service-operations.spec.ts` uses Chrome DevTools Protocol and belongs in the Chromium/Chrome run. WebKit compatibility is useful evidence, but does not replace actual Safari on macOS/iOS or physical-device acceptance. `docs/VALIDATION.md` records what actually ran and any remaining gaps.

## Fixtures and coverage

The account/admin and marketplace fixtures use trusted direct access to their local test database to promote only accounts they create, and revoke those privileges in cleanup. The private-login catalogue test bootstraps a randomly generated private alias and password, signs in through the actual UI, creates/deletes a service and banner, and revokes its administrator account. These are test-specific credentials, never a shared default or the operator's real private administrator password. Do not supply real administrator secrets to the suite or include them in reports. The application has no public privilege-escalation endpoint. Trusted fixtures intentionally require local HTTP and local MongoDB targets.

Coverage includes:

- Catalogue discovery, search/sorting, category/service pages, cart and authenticated checkout; cross-account/admin denial; booking details, rescheduling and cancellation.
- Provider profile/application, actual administrator approval and reservation conflicts.
- Customer profile/favorites/support and an administrator's recorded support response.
- Private-ID administrator login, real service creation/soft deletion, banner management and transaction view.
- Workforce check-in/out, correction approval, audit/export and business isolation.
- Successful workforce writes followed by a failed snapshot read, a read-only retry without a duplicate mutation, and preserved input after a rejected write.
- Public/protected routes, responsive navigation and horizontal overflow across mobile/tablet/desktop layouts.
- Password visibility/recovery entry points, consent, private-file denial, parser-inserted script blocking, contact storage and administrator access, responsive image fallbacks, and accessibility/keyboard checks.

Payment configuration and network responses in relevant tests are simulated. Those tests do not certify live provider payments/refunds, mail delivery or production capacity. Service tracking, notifications and other integrated acceptance results are listed in `docs/VALIDATION.md`; inspect the recorded results rather than assuming every command has passed.

Fixtures label accounts and content with `QA`, `E2E` or `example.test`. Booking cleanup affects only records created by that test; services/banners are soft-deleted to preserve history, and audit records remain inspectable. Some records remain for diagnosis. Treat the entire test database as disposable only after confirming its exact name and that no server or operator is using it. Never aim this suite at a live service or real appointment fulfilment.

## Artifacts

- `artifacts/playwright-report/index.html`: browsable outcomes and attachments.
- `artifacts/e2e-results.json`: machine-readable outcomes.
- `artifacts/e2e/`: screenshots, diagnostics and failure traces.

Traces may contain authenticated sessions, request data and synthetic test credentials. Keep artifacts private, inspect/redact before sharing, and never use production credentials during acceptance runs. The build excludes them from deployment output.

Screenshots trigger lazy image loading through normal page scrolling. Remote photo failures are recorded separately from application assertions. Browser runtime exceptions fail the applicable tests. Functional acceptance does not establish a concurrency or load-capacity claim.
