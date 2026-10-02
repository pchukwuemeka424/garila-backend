/** Non-secret fallbacks only — never store real passwords here. Used when DEFAULT_ADMIN_ENABLED=true. */
export const DEFAULT_ADMIN_EMAIL = "admin@aula.com";
export const DEFAULT_ADMIN_NAME = "Admin";

/**
 * Password must come from DEFAULT_ADMIN_PASSWORD env when bootstrap is enabled.
 * Empty string forces bootstrap to fail closed if env is missing.
 */
export const DEFAULT_ADMIN_PASSWORD = "";
