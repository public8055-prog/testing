/** Version of the terms/privacy text presented by this release's registration forms. */
export const REGISTRATION_POLICY_VERSION="2026-10-27";
export type RegistrationConsent={termsAccepted:true;privacyConsent:true;adultConfirmed:true};
export function isRegistrationConsent(value:unknown):value is RegistrationConsent{
 if(!value||typeof value!=="object")return false;
 const record=value as Record<string,unknown>;
 return record.termsAccepted===true&&record.privacyConsent===true&&record.adultConfirmed===true;
}
