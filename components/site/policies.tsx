import Link from "next/link";
import { businessDetails } from "@/lib/business";

export const POLICY_VERSION = "2026-10-27";
type PolicyKind = "privacy" | "terms" | "cookies" | "refund";

function PrivacyPolicy() {
  return <>
    <h2>Information used to provide the service</h2>
    <p>SanjuNow uses the information you provide to create an account, arrange services, manage your bookings and answer support requests. This can include your name, email, phone number, service address, booking requirements, payment status, messages and account preferences. Please share only information needed for the request. Do not send passwords, card details or identity documents through messages.</p>
    <p>Provider profiles contain the professional information submitted for publication, such as skills, service areas, availability and prices. Published reviews relate to completed provider bookings. Business workspaces contain worker contact details, account links, shifts, check-in and check-out times, corrections, review decisions and audit records. Workforce attendance records are explicit entries and do not collect GPS.</p>
    <h2>Optional booking location sharing</h2>
    <p>Customers can confirm a service address, arrival instructions and an optional map pin for a booking. For confirmed or ongoing services, the customer and currently assigned professional can separately choose to share their device GPS after an explicit consent choice and browser permission. Sharing is off by default, lasts at most four hours per activation, and can be stopped at any time. The other participant and authorized administrators can view the latest shared point, its device accuracy and timestamps. Administrators cannot turn on another participant’s GPS.</p>
    <p>Only the latest GPS point is stored, without a journey history. It remains accessible in the application for up to seven days after the last accepted update unless the participant removes it earlier. Stopping GPS retains that last saved point and the service address to help participants meet. A missing connection, closed browser or locked screen can prevent updates; timestamps distinguish recent from last-known information. Browsers cannot continue GPS after they are closed. A final update on closing is best-effort. Assigned professionals lose location-page access when the booking closes or their assignment changes.</p>
    <p>Removing a saved GPS point does not erase the service address, booking history or encrypted backups. Saved addresses follow booking retention; protected backup copies require their separate retention and deletion review. Location-sharing and address-change actions are audited without putting coordinates in audit details. Administrator location views are recorded in access records retained for 90 days.</p>
    <p>The interactive map loads only when you select Load interactive map. The configured tile provider, OpenStreetMap by default, receives your IP address, browser request information and the visible map area. Directions links open Google Maps and send the destination you choose to Google. Neither action is required to enter a written address. These services have their own privacy terms; no automatic reverse-geocoding or Google Analytics tracking is enabled.</p>
    <h2>Accounts, security and age</h2>
    <p>Passwords are stored as salted password hashes in MongoDB, rather than readable passwords. A short-lived access cookie and a rotating refresh cookie keep you signed in for up to seven days. Access checks restrict customer, provider, employer and administrator records according to their roles. Technical safeguards reduce risk but cannot guarantee that every security incident will be prevented.</p>
    <p>Provider approval requires a private government photo ID image and explicit permission for administrator review. A masked Aadhaar photo is accepted voluntarily; driving licence, passport or voter ID photos are alternatives. Mask unnecessary identity numbers and QR/barcodes while keeping the name and photo readable. We do not collect an Aadhaar number field, authenticate against UIDAI or claim automatic document authenticity checks. Administrators manually inspect the evidence and record approval, rejection or suspension. An administrator can create a pending application with the permission of the provider; this does not automatically approve it. The provider and authorized administrators can access private evidence; customers cannot. Supporting address or qualification documents may also be submitted. Do not upload identity documents through the general contact form. Contact support to request correction, withdrawal or deletion; staff must review any necessary legal retention and backup limitations.</p>
    <p>New accounts require an affirmation that you are at least 18. The registration form does not request a date of birth, and this affirmation is not an independent age check. Accounts are not intended for children. Contact support if a child has created an account or supplied personal information.</p>
    <h2>Why information is used and who can see it</h2>
    <p>Information is used to fulfil your requests, schedule work, communicate service changes, handle payments and refunds, resolve complaints and protect accounts from misuse. Relevant booking information is available to the assigned provider and authorized support staff. Business owners manage their workspace records; linked workers can access their own assigned shifts and attendance. Public provider profiles and published reviews are visible to visitors.</p>
    <p>Hosting, database and payment services process information needed to operate the application. When you initiate an online payment, the configured payment provider handles payment details under its own privacy terms. SanjuNow stores payment references and transaction status, not complete card numbers. Necessary information may also be disclosed where legally required or to resolve a dispute.</p>
    <h2>Contact forms and retention</h2>
    <p>The public contact form records your name, email, subject, message, consent time, policy version and a request reference. These records are scheduled to expire 90 days after submission; database background expiry may occur shortly afterwards. The form does not store your IP address with the request. Abuse prevention uses hashed rate-limit identifiers. Hosting or network services may separately maintain operational logs.</p>
    <p>The 90-day expiry applies to public contact-form records, not account support conversations, bookings or all audit records. Account, booking and workforce records currently require a manual retention or deletion review. A business workspace retention preference does not automatically erase records. Financial and dispute records may need to be retained to meet applicable legal obligations; there is no single promised deletion period for these records.</p>
    <h2>Your requests and choices</h2>
    <p>You can update available profile fields in your account. To request access, correction, a copy of your information, account deletion or withdrawal of consent, use the <Link href="/contact">contact form</Link> or the support details below. Requests are reviewed manually, and we may need proportionate information to confirm that the account is yours. Do not send an identity document unless support explains why it is necessary and provides a suitable method.</p>
    <p>Some information may need to remain for a legal obligation, an unresolved payment or a dispute. Support should explain any such restriction. Withdrawing permission for information required to fulfil a service can prevent that service from continuing. Deleting browser storage does not delete your account or server records.</p>
    <h2>Browser storage and external services</h2>
    <p>The application currently uses essential session and cart storage. Analytics and advertising tracking are disabled; no Google Analytics ID, advertising pixel or embedded social feed is configured. External service photographs may be requested from Unsplash, which receives network information such as your IP address and browser request details. Opening WhatsApp or a payment service takes you to a third party with its own terms. See the <Link href="/cookies">cookie and storage notice</Link>.</p>
    <h2>Updates to this notice</h2>
    <p>The version date identifies this notice. New registration consent is recorded against that version. Material changes to data practices require an updated notice and, where required, a new choice before the changed use begins. This notice does not limit rights available under applicable law.</p>
  </>;
}

function TermsPolicy() {
  return <>
    <h2>Using SanjuNow</h2>
    <p>SanjuNow provides service discovery, booking and workforce-management tools. The operator is identified below. You must be at least 18 to create an account and must provide accurate information, protect your login and use only accounts and business records you are authorized to manage.</p>
    <p>Do not misuse another person’s information, interfere with the platform, post unlawful or misleading content, or request work that is unsafe or unlawful. Administrative publication approval of a provider profile is not a guarantee of identity, qualifications, availability or service outcomes. Any specific verification claim must be supported by the checks described on that profile.</p>
    <h2>Bookings and prices</h2>
    <p>Review the service scope, address, schedule, total, payment method and cancellation terms before submitting. Catalogue services and individual provider bookings have different confirmation and payment flows. A provider request remains pending until accepted. Submitting a provider booking currently records a pending-payment arrangement and does not charge a payment card.</p>
    <p>Catalogue orders show their total before confirmation. Where online payments are enabled, payment confirmation depends on verification from the payment provider. A redirect or a payment screen alone does not establish that payment succeeded. Cash or payment after service is recorded only when an authorized receipt is recorded; completing a service alone does not mark it paid.</p>
    <p>Hourly, daily and monthly provider arrangements use the scope and dates shown before submission. Discuss additional work before agreeing to it. Do not assume that extra materials, travel or work outside the stated scope are included.</p>
    <h2>Changes, cancellations and service concerns</h2>
    <p>Use the available booking actions or <Link href="/contact">contact support</Link> with your reference. Read the <Link href="/refund-policy">cancellation and refund policy</Link> for the standard online cancellation window and payment handling. Raise a missed visit, deficient service, incorrect charge or other concern promptly so the relevant records can be reviewed. A closed online cancellation window does not remove statutory remedies.</p>
    <h2>Business workspaces</h2>
    <p>Business account owners are responsible for having an appropriate basis to add worker information, informing workers how attendance will be used, limiting access and checking exported records before using them for payroll or employment decisions. Workers should record accurate times and request corrections with a reason. The tools do not independently determine employment status, wages or compliance with employment law.</p>
    <p>A selected retention preference is an administrative preference, not an automatic deletion schedule. Business owners must arrange and review retention with support. Keep exports secure and avoid sharing other workers’ information unnecessarily.</p>
    <h2>Content, reviews and availability</h2>
    <p>Only submit content that you are entitled to share. Reviews should describe your own completed booking honestly and avoid unnecessary personal information. Service photographs are illustrative unless expressly identified otherwise; they do not establish that the people pictured will attend your booking. Use the specific written service scope when deciding what to book.</p>
    <p>Features and availability can change, and maintenance or technical failures may interrupt access. Support will review account restrictions and service disputes. These terms do not exclude obligations or remedies that cannot lawfully be excluded, including applicable consumer rights. They do not require you to waive access to a competent consumer forum.</p>
    <h2>Policies and changes</h2>
    <p>Read the <Link href="/privacy">privacy notice</Link> and <Link href="/cookies">cookie and storage notice</Link> alongside these terms. The displayed policy version applies to this text; a later version does not retrospectively remove rights relating to an existing booking.</p>
  </>;
}

function CookiesPolicy() {
  return <>
    <h2>Essential browser storage</h2>
    <ul>
      <li><strong>Access cookie: urbankare_session.</strong> Authorizes requests for up to 15 minutes. It is HTTP-only, so application JavaScript cannot read it.</li>
      <li><strong>Refresh cookie: urbankare_refresh.</strong> Renews access while you use the app, for up to seven days from sign-in. It rotates when used and is HTTP-only. Both sign-in cookies use SameSite=Lax, use Secure on HTTPS deployments, and are cleared when you sign out. Blocking them prevents authenticated features from working.</li>
      <li><strong>Session coordination: urbankare-session-lock.</strong> Browsers without Web Locks use an IndexedDB record to coordinate renewal between tabs. It contains a random lock identifier and a short expiry, not your password or sign-in tokens.</li>
      <li><strong>Appearance preference: urbankare-theme.</strong> Local storage remembers your light or dark appearance choice until you change it or clear site storage.</li>
      <li><strong>Cart storage: urbanhome-cart.</strong> Browser local storage remembers selected service slugs and quantities. It does not store your password or card details. It remains until you remove the items, clear the site’s storage or the browser removes it.</li>
    </ul>
    <h2>Analytics and advertising are off</h2>
    <p>No analytics cookies, Google Analytics ID, advertising pixels or embedded social feeds are configured in this release. Essential storage supports the features you request. There is no optional analytics category currently enabled for you to accept or reject. GPS requires a separate in-app consent choice and browser permission. Map tiles load only after an explicit map-loading choice, and directions links open an external service. The application does not store precise GPS in browser local storage or a journey-history cache.</p>
    <h2>External images, payments and links</h2>
    <p>Service images hosted by Unsplash can load when a page is opened. The image host receives the network information needed to respond, including your IP address and browser request details. This can happen without a cookie.</p>
    <p>Payment integrations are loaded when you initiate the relevant payment flow. A payment provider may use its own storage and security checks. WhatsApp opens only when you choose its link. These services have separate privacy and cookie notices; SanjuNow does not control their storage.</p>
    <h2>Your browser controls</h2>
    <p>You can inspect, block or clear cookies and local storage in your browser’s site settings. Clearing the session signs you out, and clearing cart storage removes saved selections. These actions do not cancel bookings or delete information held on the server. For those requests, see the <Link href="/privacy">privacy notice</Link> or <Link href="/contact">contact support</Link>.</p>
  </>;
}

function RefundPolicy() {
  return <>
    <h2>Catalogue service cancellations</h2>
    <p>For a confirmed catalogue booking, online cancellation is available at least two hours before the scheduled start. An eligible cancellation of a fully paid booking requests a full refund of the paid booking total. An unpaid booking has no collected payment to refund.</p>
    <p>Within two hours of the scheduled start, or after work has started, contact support with your booking reference and the reason for your request. Support must review the circumstances. This is not an automatic denial of a refund, and the online cut-off does not override rights relating to a missed, deficient or misdescribed service.</p>
    <h2>Individual provider bookings</h2>
    <p>Provider bookings currently use a pending-payment arrangement: submitting a request does not charge your card. Pending or confirmed requests can be cancelled before the scheduled start using the available booking action. After work starts, raise an issue through account support. Any separately collected payment or disputed service needs a review of the actual payment and booking records.</p>
    <h2>How refunds are handled</h2>
    <p>Eligible online-payment refunds are requested through the original payment provider to the original payment method. The booking may show a pending refund while the provider processes it. Processing and bank-credit times vary; no fixed completion date is promised. Accepted refunds must be handled within applicable legal requirements.</p>
    <p>If money was collected in cash, support must verify the receipt and arrange the appropriate repayment. An unpaid cash booking is not treated as a paid transaction. Never share a card number, password, PIN or one-time password to request a refund.</p>
    <h2>Failed, duplicate or disputed payments</h2>
    <p>If your bank shows a debit without a confirmed payment, or you believe a charge is duplicated, provide your booking reference, payment reference and a brief description through <Link href="/contact">support</Link>. Avoid sending a full bank statement or card details. Payment-provider and bank records must be checked before the outcome can be confirmed.</p>
    <h2>Getting help</h2>
    <p>Keep your booking and support references. Signed-in customers can raise a concern through <Link href="/dashboard/notifications">account support</Link>; the public contact form is also available. This policy preserves statutory consumer rights and does not restrict lawful remedies for deficient services, misleading descriptions or other actionable concerns.</p>
  </>;
}

export function PolicyContent({ kind }: { kind: PolicyKind }) {
  const business = businessDetails();
  const configured = Boolean(business.legalName && business.address && business.supportEmail && business.grievanceName && business.grievanceEmail);
  const draft = !configured || !business.launchReady;
  return <article className="uk-shell prose-page break-words">
    <p><strong>Policy version: <time dateTime={POLICY_VERSION}>26 October 2026</time></strong></p>
    {draft && <aside aria-label="Policy draft notice" className="mt-5 rounded-xl border border-amber-300 bg-amber-50 p-5 text-amber-950"><strong>Draft for launch review</strong><p className="!text-amber-950">{configured ? "Operator details have been provided. Public launch review is still pending." : "The operator’s legal identity, business address or required support and grievance details are not yet complete. This policy remains a draft until those details and the operating procedures are confirmed."}</p></aside>}
    {kind === "privacy" && <PrivacyPolicy />}
    {kind === "terms" && <TermsPolicy />}
    {kind === "cookies" && <CookiesPolicy />}
    {kind === "refund" && <RefundPolicy />}
    <section aria-labelledby="policy-contact-heading" className="mt-10 border-t border-slate-200 pt-2">
      <h2 id="policy-contact-heading">Operator and grievance contact</h2>
      <p><strong>Legal operator:</strong> {business.legalName || "Awaiting operator details before public launch."}</p>
      <p><strong>Business address:</strong> <span className="whitespace-pre-line">{business.address || "Awaiting the operator’s principal business address."}</span></p>
      <p><strong>Customer support:</strong> {business.supportEmail ? <a href={`mailto:${business.supportEmail}`}>{business.supportEmail}</a> : <>Email awaiting confirmation. Use the <Link href="/contact">contact form</Link>.</>}</p>
      <p><strong>Grievance officer:</strong> {business.grievanceName || "Appointment details awaiting confirmation."}{business.grievanceEmail && <> · <a href={`mailto:${business.grievanceEmail}`}>{business.grievanceEmail}</a></>}</p>
      {!business.grievanceEmail && <p>The grievance officer’s email must be supplied before public launch.</p>}
      <p>For consumer complaints covered by India’s e-commerce rules, the grievance process must acknowledge receipt within 48 hours and provide redress within one month. Keep the reference supplied with your request. These obligations and your statutory rights remain applicable regardless of this policy’s draft status.</p>
      {business.whatsapp && <p><a href={business.whatsapp} target="_blank" rel="noopener noreferrer">Message customer support on WhatsApp</a>. WhatsApp is an external service with its own privacy terms.</p>}
    </section>
    <nav aria-label="Related policies" className="mt-8 flex flex-wrap gap-x-5 gap-y-2 border-t border-slate-200 pt-4">
      {([{ kind: "privacy", href: "/privacy", label: "Privacy" }, { kind: "terms", href: "/terms", label: "Terms" }, { kind: "cookies", href: "/cookies", label: "Cookies & storage" }, { kind: "refund", href: "/refund-policy", label: "Cancellations & refunds" }] as const).map(item => <Link key={item.kind} href={item.href} aria-current={item.kind === kind ? "page" : undefined} className="inline-flex min-h-11 items-center text-sm">{item.label}</Link>)}
    </nav>
  </article>;
}
