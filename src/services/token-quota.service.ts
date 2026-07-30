import { Types } from "mongoose";

import {
	buildTokenQuota,
	type StudentTokenQuota,
	type UniversityTokenDefaults,
} from "../constants/student-tokens.js";
import { UniversityModel } from "../db/models/University.js";

export type { UniversityTokenDefaults, StudentTokenQuota };

export function universityDefaultsFromDoc(doc: {
	defaultStudentTokens?: number | null;
	defaultLecturerTokens?: number | null;
} | null | undefined): UniversityTokenDefaults | null {
	if (!doc) return null;
	return {
		student: doc.defaultStudentTokens ?? null,
		lecturer: doc.defaultLecturerTokens ?? null,
	};
}

export async function getUniversityTokenDefaults(
	universityId: string | Types.ObjectId | null | undefined,
): Promise<UniversityTokenDefaults | null> {
	if (!universityId) return null;
	const uni = await UniversityModel.findById(universityId)
		.select("defaultStudentTokens defaultLecturerTokens")
		.lean();
	return universityDefaultsFromDoc(uni);
}

export async function getUniversityTokenDefaultsMap(
	universityIds: Array<string | Types.ObjectId | null | undefined>,
): Promise<Map<string, UniversityTokenDefaults>> {
	const ids = [
		...new Set(
			universityIds
				.filter(Boolean)
				.map((id) => id!.toString())
				.filter((id) => Types.ObjectId.isValid(id)),
		),
	];
	const map = new Map<string, UniversityTokenDefaults>();
	if (ids.length === 0) return map;

	const docs = await UniversityModel.find({
		_id: { $in: ids.map((id) => new Types.ObjectId(id)) },
	})
		.select("defaultStudentTokens defaultLecturerTokens")
		.lean();

	for (const doc of docs) {
		map.set(doc._id.toString(), universityDefaultsFromDoc(doc)!);
	}
	return map;
}

export function quotaForUser(
	user: {
		role: string;
		tokensUsed?: number | null;
		tokenAllowance?: number | null;
		universityId?: Types.ObjectId | string | null;
	},
	defaultsByUniversity?: Map<string, UniversityTokenDefaults>,
): StudentTokenQuota | null {
	const uniId = user.universityId ? user.universityId.toString() : null;
	const universityDefaults = uniId ? defaultsByUniversity?.get(uniId) ?? null : null;
	return buildTokenQuota(user.role, user.tokensUsed ?? 0, {
		tokenAllowance: user.tokenAllowance ?? null,
		universityDefaults,
	});
}

export async function quotaForUserAsync(user: {
	role: string;
	tokensUsed?: number | null;
	tokenAllowance?: number | null;
	universityId?: Types.ObjectId | string | null;
}): Promise<StudentTokenQuota | null> {
	const defaults = await getUniversityTokenDefaults(user.universityId ?? null);
	return buildTokenQuota(user.role, user.tokensUsed ?? 0, {
		tokenAllowance: user.tokenAllowance ?? null,
		universityDefaults: defaults,
	});
}
