# Vendor onboarding and administrator oversight

## Where to manage the site

Sign in through the shared sign-in screen with an administrator account. Open **Providers** in the desktop administration sidebar or mobile **More** sheet. The administrator role is read from the database and is required by the API; a customer or provider cannot approve themselves by calling it directly.

Use **Add vendor** to create a pending provider application for an existing registered account or a new account. Enter the email, professional details, active category, rates, working hours and a private identity photo. Record the vendor's permission reference and confirm the consent/masking declarations. For a new account, set a unique initial password of at least ten characters and give it to the vendor privately. It is Argon2id-hashed; existing account passwords cannot be replaced through this form. New accounts are not marked email verified, no signup consent is fabricated, and no invitation email is claimed or sent automatically. The vendor can use Forgot password to choose a different password through the configured recovery channel.

Creating an application never publishes or approves it. Duplicate profiles, foreign/reused uploads, blocked/deleted targets and administrator accounts are rejected. The initial private upload is transferred from the uploading administrator to the vendor account in the same MongoDB transaction as application creation. The vendor and authorized administrators can download it; other customers cannot.

## Required identity evidence

An approved current **government photo ID image** is mandatory before a provider can be approved or published. The primary form choice is **Masked Aadhaar card**. Driving licence, passport and voter ID are alternatives. These alternatives follow UIDAI guidance on voluntary Aadhaar use and viable identification alternatives; this application does not force an unmasked Aadhaar photocopy.

For Aadhaar, use a masked copy and cover QR/barcodes. For all accepted documents, mask unnecessary identity numbers/codes/personal details while retaining a readable name and photograph. Identity evidence must actually decode as a JPEG, PNG or WebP image; a PDF is not sufficient for identity approval. Other supporting documents can still be PDFs. Uploads have a five MiB limit, pixel limits and image re-encoding that strips metadata. An image is not automatically recognized as Aadhaar and masking is not automatically certified. The administrator must inspect it and reject unsuitable/unmasked/irrelevant evidence. No Aadhaar number input field or UIDAI authentication integration exists.

The current identity consent version is `2026-10-27`. The provider explicitly consents when submitting their own image. An administrator submitting on behalf of a vendor records permission and its reference. Do not put identity numbers in the filename, permission reference or review notes. No email, WhatsApp message or public URL should carry the image.

1. Open the vendor's **Documents & verification** section and download the private evidence.
2. Check the chosen ID type, holder name/photo and masking. Select Approve document, check the explicit manual-review declaration, add the review reason and save.
3. Approve all other current submissions, or reject them with reasons.
4. Set Provider application status to **approved**, record the reason and save. This publishes the profile only after the required evidence checks pass and the account is active.

Approval, rejection and suspension are administrator-only transactions with audit entries. A replacement identity image supersedes the old review copy and returns publication/verification to pending. Superseded evidence cannot be approved through a stale form. A provider's self-edit never grants approval. The startup initializer returns active marketplace profiles without current consented/reviewed photo evidence to pending and records that policy review; existing bookings/history are retained. Such profiles need a new image/review rather than retroactive fabricated consent.

**Rejected** and **suspended** applications are unpublished. **Block vendor account** also ends account access and revokes Mongo session anchors. Use **People & accounts** to inspect or unblock an account. Unblocking alone does not approve or republish the provider; explicitly review it again. Existing bookings remain visible for reassignment/refund/delivery decisions. Blocked providers cannot continue protected queue/location/account operations.

Private evidence and superseded copies follow the platform's operator-managed document retention and rights-request process; there is no new automatic identity-document purge or biometric/OCR/background-check service. Before public launch, establish a proportionate documented retention/deletion process, backup handling and any OVSE/other legal obligations applicable to the actual business. Manual review is not a guarantee of authenticity or legal clearance.

## Catalogue, ongoing services and activity

The administration sidebar and mobile More sheet provide **Services**, **Categories**, **Banners**, **Pricing policy**, **Bookings**, **Payments**, **Reports & exports**, **Providers**, **People & accounts**, **Tokens & follow-ups**, **Ongoing services**, **Notifications**, support and audit views. The ongoing board is restricted to in-service queue entries; the full queue and booking history are separate views. Customer/vendor maps remain booking-scoped.

**Website activity** at `/admin/activity` combines recorded administration changes (including catalogue/provider/location actions), customer and vendor booking creation, vendor booking events, queue events, payment events/refunds/cash receipts, account events, contact/support creation and notification campaigns. It refreshes every thirty seconds while visible, supports type/reference/action/date filters, and pages over the matching records in the database rather than silently showing only the newest five hundred. Date filters use UTC; displayed times use IST. An event and its corresponding administrative audit entry may both appear because they are distinct records.

The feed projects only action, status, actor ID/name, reference, timestamp and an internal module link. It excludes passwords, token/cookie values, identity images, raw auth hashes, GPS coordinates and free-form audit payloads. It is a record of stored operations, not a visitor click tracker or a reconstruction of missing historical events. Private workforce attendance stays protected by business membership; global administration does not override that scope. Admin-only, private/no-store, rate-limited API: `GET /api/admin/activity`.

Application data lives in MongoDB `urbankare_mongo` on local `127.0.0.1:27018`, replica set `rs0`. Vendor profiles use `marketplace_providers`; reviews/consent use `platform_provider_documents`; private files use `uploads` plus GridFS `assets.files`/`assets.chunks`; decisions use `platform_audit`. Redis on port `6380` supplies shared request limits and session/cache infrastructure. See [README.md](../README.md), [VALIDATION.md](VALIDATION.md) and [BACKUPS.md](BACKUPS.md) for setup, executed results and recovery.

Sources: [UIDAI OVSE dos and don'ts](https://uidai.gov.in/images/Dos_and_Don_ts_for_Offline_Verification_Seeking_entities.pdf), [UIDAI OVSE FAQ](https://www.uidai.gov.in/images/FAQ_OVSE.pdf). These inform the consent, alternatives and masking workflow; the application does not certify legal compliance or independently authenticate government records.
