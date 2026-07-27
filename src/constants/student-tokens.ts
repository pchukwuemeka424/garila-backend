export const STUDENT_TOKEN_ALLOWANCE = 400_000;
export const LECTURER_TOKEN_ALLOWANCE = 1_000_000;

export type StudentTokenQuota = {
	allowance: number;
	used: number;
	remaining: number;
};

export function tokenAllowanceForRole(role: string): number | null {
	if (role === "student") return STUDENT_TOKEN_ALLOWANCE;
	if (role === "lecturer" || role === "researcher") return LECTURER_TOKEN_ALLOWANCE;
	return null;
}

export function buildTokenQuota(role: string, tokensUsed: number): StudentTokenQuota | null {
	const allowance = tokenAllowanceForRole(role);
	if (!allowance) return null;
	const used = Math.max(0, Math.round(tokensUsed));
	const remaining = Math.max(0, allowance - used);
	return { allowance, used, remaining };
}

export function buildStudentTokenQuota(tokensUsed: number): StudentTokenQuota {
	return buildTokenQuota("student", tokensUsed)!;
}
