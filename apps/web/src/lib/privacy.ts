/** Single source of truth for the privacy notice. The version stamps every
 *  consent record (see sign-up), so we can always prove *which* version of the
 *  notice a given user agreed to. Bump it whenever the notice materially
 *  changes — and, when that happens, re-collect consent from existing users. */
export const PRIVACY_NOTICE_VERSION = "2026-06-16.2";

/** Where data-protection requests (access, deletion, questions) go. Named in
 *  the notice and used as the controller contact. Received via ImprovMX
 *  forwarding to the owner's inbox; replies send as this address via Resend. */
export const PRIVACY_CONTACT_EMAIL = "privacy@villageos.co.uk";

/** Shape of the consent record stored in the user's auth metadata at sign-up. */
export type PrivacyConsent = {
  version: string;
  accepted_at: string; // ISO 8601
};
