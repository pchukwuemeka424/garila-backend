/**
 * Fallback seed version when Mongo meta has not been initialised yet.
 * Live version is stored in PlatformLegalDocument id:"meta" and bumped on publish.
 */
export const ACCOUNT_POLICY_VERSION = "1";

export const POLICIES_REQUIRED_ERROR =
	"You must agree to the Terms of Service, Privacy Policy, and Acceptable Use Policy to create an account.";