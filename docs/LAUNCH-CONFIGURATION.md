# Connecting the real business and deployment

Analytics remains **off**. The application is implemented locally; no external hosting account, public domain, DNS zone, mailbox, payment account or Google property is created by these files. Use [DEPLOYMENT.md](DEPLOYMENT.md) for runtime setup and [VALIDATION.md](VALIDATION.md) for exact executed checks.

## Business identity and publication

Supply the actual legal name, principal address, monitored support email, grievance officer/email and intended WhatsApp number through the named configuration fields. No private administrator identifier, password or personal contact is a source-code default. Validate each contact using the real operated account. Review [LEGAL-LAUNCH.md](LEGAL-LAUNCH.md), customer/provider terms, cancellation/refund policy and image/document rights before publication.

Keep `PUBLIC_LAUNCH_READY=false` until acceptance is complete. It controls draft policy labels and crawler metadata, not application access. Protect public previews with hosting/network authentication; robots exclusions are not authorization. Presence/format checks cannot verify legal identity, mailbox delivery or ownership of a domain/image.

The contact form stores a consented request/reference in the admin inbox. A stored request is not an email-delivery confirmation. Staff must monitor and respond; the reply link opens an email client. The contact TTL is 90 days, including unresolved records, so do not rely on indefinite inbox retention.

## HTTPS, infrastructure and sessions

Choose the real host/domain, configure DNS and managed TLS renewal, redirect HTTP to HTTPS and set canonical HTTPS `APP_URL` plus `COOKIE_SECURE=true`. Test the real browser certificate, redirect chain and mixed-content console. Do not use a padlock graphic as evidence of encryption.

Provision authenticated TLS MongoDB/Redis on private networks with least-privilege credentials and tested recovery. The supplied local single-member replica set/Redis listeners on 27018/6380 are development-only. Production Compose runs separate web/worker processes against external endpoints. The Node gateway must support `/api/live` WebSocket upgrades and `/api/updates/stream` SSE fallback; its internal Next port stays private. Configure forwarded-header trust only behind a verified proxy that replaces spoofed headers.

Generate a protected canonical-base64 32-byte `AUTH_JWT_SECRET`, shared by all replicas. Use one-shot `SEED_ADMIN_EMAIL/SEED_ADMIN_PASSWORD` and optional name with `npm run admin:bootstrap` (or `admin:seed` alias); remove those credentials from the invoking environment. The seed identifier field accepts a normal email or a private login identifier. Do not put actual credentials in source, container layers, browser variables or public documentation. All roles use `/login`; a nonadmin receives 404 for administration paths. Seed grants `SUPER_ADMIN`; only that role can grant/change global roles.

Argon2id protects new passwords; legacy scrypt upgrades on successful login. Access JWTs last 15 minutes; opaque refresh cookies rotate within seven days and rely on Redis plus revocable Mongo anchors. Cookies are HttpOnly/SameSite=Lax and Secure on public deployment. Confirm refresh/reuse rejection, logout, reset and disabled-account revocation through the deployed proxy. Changing only the signing key does not revoke surviving refresh families; use the incident revocation procedure in DEPLOYMENT.md.

Rotate credentials previously shared in conversation before launch. Administrator MFA and email ownership verification are not implemented. Apply an independent authenticated operations-access layer where required.

## Domain mail and recovery

Use a real email provider and a monitored mailbox on the verified domain. Obtain that provider's exact MX/SPF/DKIM records and configure DMARC; test the authentication headers of an actually received message. DNS values, account billing and ownership must come from the real provider/account.

Recovery requires an HTTPS `EMAIL_DELIVERY_URL` adapter and bearer `EMAIL_DELIVERY_TOKEN`. It accepts `{to, subject, text}` and must deliver the message. Without configuration recovery is explicitly unavailable. Test an actual delivered link, expiry/reuse rejection and old-session revocation. Generic request acceptance is not proof of delivery: after-response work has no durable mail queue/retry worker. Signup does not verify email ownership, and general transactional email/push delivery is outside the implemented path.

Recovery tokens are hashed at rest and never returned by the request API. A delivered link intentionally carries its token in the URL. Protect the mailbox/link and redact reset query parameters from hosting/proxy/error logs. The reset page's no-referrer policy does not erase browser history or control external logging.

## Search, sharing and analytics

After domain/launch review, create the intended Search Console property and complete its real ownership verification. `GOOGLE_SITE_VERIFICATION` supports an operator-supplied HTML-tag verification value; DNS verification uses the actual property-issued record. See Google's [ownership instructions](https://support.google.com/webmasters/answer/9008080).

Deliberately enable `PUBLIC_LAUNCH_READY=true`, rebuild/redeploy and verify public robots/sitemap metadata. Submit the sitemap in the verified property. Submission does not promise indexing/ranking. Private workspace/admin/API URLs are excluded from public sitemap generation and remain protected independently.

Open Graph metadata and a sharing image are supplied. Check the public HTTPS URL in WhatsApp and verify its absolute image URL is reachable without login. Localhost is not a share-preview endpoint; cached social previews can lag changes.

No Google Analytics code, measurement ID or analytics cookie is installed. Keep analytics off until the operator explicitly authorizes a consent-based implementation and supplies an approved property. Decide purposes/retention/sharing, offer equally usable accept/reject choices and verify withdrawal before loading optional tracking. Never include passwords, names, email, messages, service tokens or payment details in analytics events. Theme preference and the temporary cross-tab refresh lease are functional local browser storage, not analytics.

## Documents, backups and operational acceptance

Provider verification documents are private GridFS uploads accessible only to their owner/authorized administrators; banner uploads are public assets. Images are decoded/re-encoded, while PDFs have basic format checks and download restrictions. This is not malware scanning or third-party identity verification. Establish review, retention, quarantine and privacy-erasure procedures appropriate to the evidence collected. Soft-deleting an account/listing preserves history and is not complete erasure from databases/backups.

Recorded local encrypted snapshot/restore evidence is retained in [BACKUPS.md](BACKUPS.md). The daily schedule requires a supervised worker and protected key/destination. Configure offsite retention, key recovery, monitoring and repeated restore checks; the application utility is not point-in-time recovery. Do not publish original migration backups or authenticated browser artifacts.

Redis/WebSocket notifications prompt authenticated API reads from durable Mongo records. Reconnect/focus/online recovery is implemented; offline bookings and workforce writes are not queued. Test through the real proxy and unstable mobile networks. Native Windows WebKit is not actual Safari; test macOS/iOS Safari, screen readers, real keyboards/safe areas and devices separately. Automated axe/viewport checks do not establish full accessibility conformance.

## Payments, performance and final release

Configure the chosen gateway's test credentials and signed HTTPS webhooks first. Verify real checkout, amount/currency, duplicate/delayed callbacks, cancellation and refunds before live charges. Catalogue completion alone never means paid; cash needs an actual receipt action. Professional marketplace reservations remain pending-payment records and do not count as collected revenue. Existing automated payment tests simulate provider network responses.

The local cached-read p95 target is <300ms under the documented test. Production concurrency, failover, transaction latency and 10,000-user capacity remain separate acceptance work. Monitor health, queue/campaign/refund age, error rates and resource saturation. A green health endpoint confirms data-service readiness, not every business integration.

The latest backend suite passed 106 tests; final TypeScript/lint/build/browser and external-host checks remain separately tracked in VALIDATION.md. No public deployment, legal compliance, rights clearance or blanket security guarantee is implied by source completion.
