import {
	LECTURER_TOKEN_ALLOWANCE,
	STUDENT_TOKEN_ALLOWANCE,
	buildStudentTokenQuota,
	buildTokenQuota,
	type StudentTokenQuota,
} from "../constants/student-tokens.js";
import { UserModel } from "../db/models/User.js";

export {
	LECTURER_TOKEN_ALLOWANCE,
	STUDENT_TOKEN_ALLOWANCE,
	buildStudentTokenQuota,
	buildTokenQuota,
	type StudentTokenQuota,
};

export async function getStudentTokenQuota(userId: string): Promise<StudentTokenQuota | null> {
	const user = await UserModel.findById(userId).select("role tokensUsed").lean();
	if (!user) return null;
	return buildTokenQuota(user.role, user.tokensUsed ?? 0);
}

export async function assertStudentHasTokenBalance(userId: string): Promise<void> {
	const quota = await getStudentTokenQuota(userId);
	if (!quota) return;
	if (quota.remaining <= 0) {
		throw new Error(
			`You have used all ${quota.allowance.toLocaleString()} research tokens. Contact support for more.`,
		);
	}
}

export async function deductStudentTokens(
	userId: string,
	amount: number,
): Promise<StudentTokenQuota | null> {
	if (!Number.isFinite(amount) || amount <= 0) return getStudentTokenQuota(userId);

	const user = await UserModel.findByIdAndUpdate(
		userId,
		{ $inc: { tokensUsed: Math.round(amount) } },
		{ new: true },
	)
		.select("role tokensUsed")
		.lean();

	if (!user) return null;
	return buildTokenQuota(user.role, user.tokensUsed ?? 0);
}
