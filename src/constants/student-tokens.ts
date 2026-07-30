export const STUDENT_TOKEN_ALLOWANCE = 400_000;
export const LECTURER_TOKEN_ALLOWANCE = 1_000_000;

export type StudentTokenQuota = {
	allowance: number;
	used: number;
	remaining: number;
};

export type UniversityTokenDefaults = {
	student: number | null;
	lecturer: number | null;
};

export function tokenAllowanceForRole(
	role: string,
	universityDefaults?: UniversityTokenDefaults | null,
): number | null {
	if (role === "student") {
		return universityDefaults?.student && universityDefaults.student > 0
			? Math.round(universityDefaults.student)
			: STUDENT_TOKEN_ALLOWANCE;
	}
	if (role === "lecturer" || role === "researcher") {
		return universityDefaults?.lecturer && universityDefaults.lecturer > 0
			? Math.round(universityDefaults.lecturer)
			: LECTURER_TOKEN_ALLOWANCE;
	}
	return null;
}

/**
 * Resolve effective allowance: per-user override → university default → platform default.
 */
export function resolveTokenAllowance(
	role: string,
	opts?: {
		tokenAllowance?: number | null;
		universityDefaults?: UniversityTokenDefaults | null;
	},
): number | null {
	const roleBase = tokenAllowanceForRole(role, null);
	if (!roleBase) return null;

	if (opts?.tokenAllowance != null && opts.tokenAllowance > 0) {
		return Math.round(opts.tokenAllowance);
	}
	return tokenAllowanceForRole(role, opts?.universityDefaults ?? null);
}

export function buildTokenQuota(
	role: string,
	tokensUsed: number,
	opts?: {
		tokenAllowance?: number | null;
		universityDefaults?: UniversityTokenDefaults | null;
		allowance?: number | null;
	},
): StudentTokenQuota | null {
	const allowance =
		opts?.allowance != null && opts.allowance > 0
			? Math.round(opts.allowance)
			: resolveTokenAllowance(role, opts);
	if (!allowance) return null;
	const used = Math.max(0, Math.round(tokensUsed));
	const remaining = Math.max(0, allowance - used);
	return { allowance, used, remaining };
}

export function buildStudentTokenQuota(tokensUsed: number): StudentTokenQuota {
	return buildTokenQuota("student", tokensUsed)!;
}
