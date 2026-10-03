/** Shared password strength rules for registration, reset, and admin invites. */
export function assertPasswordPolicy(password: string): void {
	if (password.length < 10) {
		throw new Error("Password must be at least 10 characters.");
	}
	if (!/[A-Za-z]/.test(password) || !/[0-9]/.test(password)) {
		throw new Error("Password must include at least one letter and one number.");
	}
}
