# Legal launch review — 25 October 2026

Policy version: `2026-10-25`. This is a source-informed launch checklist, not a legal opinion or certification of compliance. A qualified Indian adviser and the actual operator must review the business model, deployment and operating procedures before launch. The public policies remain visibly marked as drafts while operator details or the launch flag are incomplete.

## Operator information and complaints

Set and verify `BUSINESS_LEGAL_NAME`, `BUSINESS_ADDRESS` (principal address and applicable branches), `BUSINESS_SUPPORT_EMAIL`, `GRIEVANCE_OFFICER_NAME` and `GRIEVANCE_EMAIL`. Publish the officer’s designation and usable contact details. `APP_URL` must identify the real HTTPS deployment. The user supplied WhatsApp number is `+919717621336`; it is a support channel, not a substitute for the legal operator or grievance officer. Do not invent a registered entity, address, registration number, qualification or response history.

Rules 4(2), 4(4) and 4(5) of the [Consumer Protection (E-Commerce) Rules, 2020](https://consumeraffairs.gov.in/public/upload/files/E%20commerce%20rules_1732703966.pdf) require prominent operator/contact disclosures and a grievance mechanism, including acknowledgement within 48 hours and redress within one month. The operator must staff this process, retain complaint references and arrange escalation; a form or policy alone does not discharge those duties. Check applicability, entity structure and the 2021 amendment with counsel. The same rules address refund handling, cancellation charges, seller disclosures, genuine reviews and remedies for deficient services. The standard cancellation window must not remove statutory remedies.

The [2026 e-commerce amendment](https://consumeraffairs.gov.in/public/upload/admin/cmsfiles/whatsnews/E_Commerce_Amendment_Rules_2026_2026-09-11_18-12-58.pdf) adds requirements involving complaint copies, National Consumer Helpline participation, sponsored listings, prior-price disclosures, seller invoice identification, ranking explanations and dark-pattern self-audits. The [government’s 10 September 2026 announcement](https://www.pib.gov.in/newsite/erelcontent.aspx?lang=2&reg=48&relid=294532) confirms commencement on **1 January 2027**. Plan implementation and legal review before that date; do not describe these future provisions as already in force on this document’s date or display an audit certificate without completing the required audit.

## DPDP commencement is staggered

Read the [Digital Personal Data Protection Act, 2023](https://www.meity.gov.in/static/uploads/2024/06/2bf1f0e9f04e6fb4f8fef35e82c42aa5.pdf) together with the [commencement notification, G.S.R. 843(E), dated 13 November 2025](https://www.meity.gov.in/static/uploads/2025/11/c56ceae6c383460ca69577428d36828b.pdf). It does **not** bring the entire Act into force at once:

- The first group takes effect on Gazette publication, including specified institutional and administrative provisions.
- Section 6(9) and section 27(1)(d) take effect one year after publication.
- The principal processing, consent, individual-rights and related provisions listed in clause (c) take effect eighteen months after publication.

On **25 October 2026**, the one-year and eighteen-month stages are still future. Confirm the exact operative dates from the Gazette; do not substitute a website upload date for publication. Review the [official 2025 Rules and corrigendum listing](https://www.meity.gov.in/documents/act-and-policies/digital-personal-data-protection-rules-2025-gDOxUjMtQWa?pageTitle=Digital-Personal-Data-Protection-Rules-2025%3B) and each rule’s commencement separately. Existing applicable privacy, security, consumer and other obligations still require review during the transition. The product does not claim “DPDP compliant.”

## Practices represented in the policies

These are implementation observations, not proof that production infrastructure or day-to-day practices match them. Recheck them after configuration or deployment changes.

| Area | Current implementation / required operational follow-through |
| --- | --- |
| Accounts | Argon2id password hashes in MongoDB; 15-minute HttpOnly access cookie plus a rotating, revocable refresh cookie with a seven-day absolute lifetime. Legacy scrypt hashes upgrade on successful login. Signup does not verify email ownership. Enable secure cookies on production HTTPS. Never log plaintext passwords or session tokens. |
| Consent and age | New registration records policy version `2026-10-25`, terms/privacy acceptance and an 18+ affirmation. No date of birth is collected. An affirmation is not verified age; implement and review a response to suspected child accounts. The combined signup acknowledgement is not consent for unrelated marketing; review purpose-specific notices, lawful grounds and withdrawal handling with counsel. |
| Public contact requests | Name, email, subject, message, reference, consent timestamp/version and status are stored. A MongoDB TTL index schedules expiry at 90 days; expiry is asynchronous and does not exempt unresolved requests. Staff must arrange lawful retention/escalation before expiry when needed. Contact records do not contain IP addresses. Rate limiting uses hashed identifiers in Redis. Separately review proxy/hosting logs, access, retention and backups. |
| Retention | Account, booking, payment, complaint and workforce records do not have a universal automatic erasure process. Business retention settings are preferences only. Write an operational retention schedule, lawful hold rules and a manual deletion/export procedure; identify financial record requirements without inventing a blanket duration. Cover backups and exports too. |
| Rights requests | Public contact form and account support accept requests; staff must verify identity proportionately, track access/correction/deletion requests and explain retained records. No automated “delete all data” promise. |
| Storage and tracking | `urbankare_session` and `urbankare_refresh` HttpOnly cookies, `urbanhome-cart` and `urbankare-theme` local storage, and an IndexedDB session-renewal coordination lock support requested features. Private provider documents are stored in MongoDB GridFS and accessible only to their owner and authorized administrators. No analytics ID, ad pixel or social embed is configured. Re-audit consent and disclosures before enabling any optional tracking. |
| External services | Unsplash image requests expose network information to that host. User-initiated payment flows load the configured gateway. WhatsApp is an external link. Document actual production hosts/processors, locations, contracts, access, transfers and provider notices; do not claim India-only hosting without evidence. |
| Workforce | Owners must inform workers, establish authority to process records and restrict access. Corrections retain an audit history. Exports require secure handling. Attendance itself does not collect GPS. Optional service-booking GPS has separate participant consent and controls. |
| Booking locations | Written service address, optional service pin and arrival instructions are shared with the customer, current assigned professional and authorized administrators. GPS is off by default, requires explicit consent and browser permission, expires after four hours per activation and stores only the latest point. The last saved point remains accessible for up to seven days unless removed earlier. Service addresses and encrypted backups follow separate retention review. Administrator views and sharing/address actions are audited without coordinates in audit details. Maps load after an explicit choice and send the visible map area/IP to the configured tile provider; external Google Maps directions send the chosen destination. Update processor notices/retention and document the operating purpose before public launch. |
| Provider verification | Publication approval and verification record administrator checks and private references. No automated third-party identity/background check, insurance validation or qualification registry integration is implemented. Do not imply stronger assurance than the documented checks support. |
| Government photo ID | Provider approval now requires a consented private image, masked Aadhaar as the primary option and viable government photo ID alternatives. No Aadhaar number field, UIDAI authentication, OCR masking certification or government-record authenticity check exists. Administrators inspect name/photo/masking and record the decision. Obtain actual permission for on-behalf-of applications, establish evidence/superseded-copy retention and deletion procedures, and assess applicable OVSE obligations before public launch. See [PROVIDER-ADMIN.md](PROVIDER-ADMIN.md) and UIDAI sources linked there. |
| Payments | Catalogue paid cancellations in the standard window request the paid total through the original gateway. Late/started-service and cash cases require support review. Provider requests presently remain payment-pending and do not charge cards. Do not promise a fixed bank-credit date or invent cash receipts. |

The publication flag controls draft labels and indexing, not legal approval or access to registration/booking. Its checks require populated operator fields, syntactically valid support/grievance emails and an HTTPS origin; they do not verify those facts or prevent public use of an unprotected preview. Before enabling it, verify the actual details, monitor support channels, test the privacy-request procedure and reconcile policy text with the real provider arrangements. Display accurate provider/seller details before purchase, and retain evidence for any discount, qualification, insurance or verification claim.

Encrypted snapshots include historical application records, and the 90-day contact TTL does not erase copies already held in backups or exports. Document access, expiry and approved-deletion handling for those copies, and ensure a restoration does not silently undo an approved privacy request. Neither the snapshot utility nor the publication flag supplies that operational process.

## Photography, copyright and other rights

The [Unsplash licence](https://unsplash.com/license) permits many commercial uses of covered images subject to its restrictions. It does not establish that every image URL in this repository is covered or clear all other rights. Unsplash’s [releases and trademarks guidance](https://help.unsplash.com/en/articles/2612329-releases-and-trademarks) explains that recognizable people, property and trademarks can require separate permissions; releases are not guaranteed.

Keep an asset register with the source/photo page, creator, licence at acquisition, intended use, and any relevant model/property permissions. Current remote service images need that provenance review. Avoid implying pictured people are employed, endorsed or identity-verified providers. Replace unclear assets with operator-owned or appropriately licensed imagery. The local neutral fallback SVG is code-drawn for this project; it provides a failure state, not clearance for other assets. No blanket copyright or trademark clearance has been performed.

## Release evidence still needed

- Confirm the operating entity, address, grievance appointment, monitored emails and any required tax/business disclosures.
- Obtain legal review of the actual marketplace/catalogue roles, provider agreements, cancellation handling, price/ranking disclosures and consumer redress.
- Approve a retention and security incident process; verify production TLS, access, backup restoration, logs and processor arrangements.
- Verify complaint acknowledgement/redress staffing, rights-request tracking and payment/refund reconciliation.
- Review all advertising, service images and factual claims; retain the supporting evidence.
- Recheck the current law and launch date, including the January 2027 e-commerce changes and staged DPDP commencement.

These items require real operator decisions and evidence. Code, draft policies and successful automated tests cannot certify legal compliance.
