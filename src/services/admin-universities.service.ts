import { Types } from "mongoose";

import { UniversityModel } from "../db/models/University.js";
import { UserModel } from "../db/models/User.js";

export type UniversityRecord = {
	id: string;
	catalogueId: string;
	name: string;
	slug: string;
	country: string;
	status: "active" | "inactive";
	userCount: number;
	adminCount: number;
	defaultStudentTokens: number | null;
	defaultLecturerTokens: number | null;
	onboardedAt: string | null;
	createdAt: string;
	updatedAt: string;
};

function slugify(value: string): string {
	return value
		.trim()
		.toLowerCase()
		.replace(/[^a-z0-9]+/g, "-")
		.replace(/^-+|-+$/g, "")
		.slice(0, 80);
}

function toRecord(
	doc: {
		_id: { toString(): string };
		catalogueId: string;
		name: string;
		slug: string;
		country?: string | null;
		status: string;
		defaultStudentTokens?: number | null;
		defaultLecturerTokens?: number | null;
		onboardedAt?: Date | null;
		createdAt: Date;
		updatedAt: Date;
	},
	counts: { userCount: number; adminCount: number } = { userCount: 0, adminCount: 0 },
): UniversityRecord {
	return {
		id: doc._id.toString(),
		catalogueId: doc.catalogueId,
		name: doc.name,
		slug: doc.slug,
		country: (doc.country ?? "NG").toUpperCase(),
		status: doc.status as "active" | "inactive",
		userCount: counts.userCount,
		adminCount: counts.adminCount,
		defaultStudentTokens: doc.defaultStudentTokens ?? null,
		defaultLecturerTokens: doc.defaultLecturerTokens ?? null,
		onboardedAt: doc.onboardedAt?.toISOString() ?? null,
		createdAt: doc.createdAt.toISOString(),
		updatedAt: doc.updatedAt.toISOString(),
	};
}

async function countsForUniversities(ids: Types.ObjectId[]) {
	if (ids.length === 0) return new Map<string, { userCount: number; adminCount: number }>();

	const [userCounts, adminCounts] = await Promise.all([
		UserModel.aggregate<{ _id: Types.ObjectId; count: number }>([
			{ $match: { universityId: { $in: ids } } },
			{ $group: { _id: "$universityId", count: { $sum: 1 } } },
		]),
		UserModel.aggregate<{ _id: Types.ObjectId; count: number }>([
			{
				$match: {
					universityId: { $in: ids },
					role: { $in: ["governance_admin", "faculty_admin", "auditor"] },
				},
			},
			{ $group: { _id: "$universityId", count: { $sum: 1 } } },
		]),
	]);

	const map = new Map<string, { userCount: number; adminCount: number }>();
	for (const id of ids) {
		map.set(id.toString(), { userCount: 0, adminCount: 0 });
	}
	for (const row of userCounts) {
		const key = row._id.toString();
		const entry = map.get(key) ?? { userCount: 0, adminCount: 0 };
		entry.userCount = row.count;
		map.set(key, entry);
	}
	for (const row of adminCounts) {
		const key = row._id.toString();
		const entry = map.get(key) ?? { userCount: 0, adminCount: 0 };
		entry.adminCount = row.count;
		map.set(key, entry);
	}
	return map;
}

export async function listUniversities(): Promise<UniversityRecord[]> {
	const docs = await UniversityModel.find().sort({ name: 1 }).lean();
	const counts = await countsForUniversities(docs.map((d) => d._id));
	return docs.map((doc) => toRecord(doc, counts.get(doc._id.toString())));
}

export async function getUniversityById(id: string) {
	if (!Types.ObjectId.isValid(id)) return null;
	return UniversityModel.findById(id).lean();
}

export async function isUniversityActive(universityId: string | Types.ObjectId | null | undefined) {
	if (!universityId) return false;
	const uni = await UniversityModel.findById(universityId).select("status").lean();
	return uni?.status === "active";
}

/** Active (onboarded) university for public registration — never creates stubs. */
export async function getActiveUniversityByCatalogueId(catalogueId: string) {
	const id = catalogueId.trim().toLowerCase();
	if (!id) return null;
	const uni = await UniversityModel.findOne({ catalogueId: id, status: "active" });
	return uni;
}

/** Public catalogue for /register — only onboarded universities, optionally filtered by country. */
export async function listActiveUniversitiesForRegistration(
	country?: string,
): Promise<Array<{ catalogueId: string; name: string; country: string }>> {
	const code = country?.trim().toUpperCase();
	const filter: Record<string, unknown> = { status: "active" };

	if (code) {
		// Legacy Nigeria rows may omit country; treat them as NG.
		filter.$or =
			code === "NG"
				? [
						{ country: "NG" },
						{ country: { $exists: false } },
						{ country: null },
						{ country: "" },
					]
				: [{ country: code }];
	}

	const docs = await UniversityModel.find(filter)
		.select("catalogueId name country")
		.sort({ name: 1 })
		.lean();
	return docs.map((doc) => ({
		catalogueId: doc.catalogueId,
		name: doc.name,
		country: ((doc as { country?: string }).country ?? "NG").toUpperCase(),
	}));
}

export async function onboardUniversity(input: {
	catalogueId: string;
	name: string;
	country?: string;
	status?: "active" | "inactive";
	onboardedBy: string;
}): Promise<UniversityRecord> {
	const catalogueId = input.catalogueId.trim().toLowerCase();
	const name = input.name.trim();
	const country = (input.country?.trim().toUpperCase() || "NG").slice(0, 2);
	if (!catalogueId) throw new Error("catalogueId is required.");
	if (name.length < 2) throw new Error("name is required.");

	const status = input.status ?? "active";
	const existing = await UniversityModel.findOne({ catalogueId });
	const now = status === "active" ? new Date() : undefined;

	if (existing) {
		existing.name = name;
		existing.country = country;
		existing.status = status;
		if (status === "active") {
			existing.onboardedAt = existing.onboardedAt ?? now;
			existing.onboardedBy = new Types.ObjectId(input.onboardedBy);
		}
		await existing.save();
		const counts = await countsForUniversities([existing._id]);
		return toRecord(existing.toObject(), counts.get(existing._id.toString()));
	}

	const baseSlug = slugify(catalogueId) || slugify(name) || "university";
	let slug = baseSlug;
	let attempt = 0;
	while (await UniversityModel.exists({ slug })) {
		attempt += 1;
		slug = `${baseSlug}-${attempt}`;
	}

	const created = await UniversityModel.create({
		catalogueId,
		name,
		slug,
		country,
		status,
		...(status === "active"
			? { onboardedAt: now, onboardedBy: new Types.ObjectId(input.onboardedBy) }
			: {}),
	});
	return toRecord(created.toObject());
}

export type BulkOnboardResult = {
	created: number;
	updated: number;
	failed: number;
	total: number;
	errors: Array<{ catalogueId: string; error: string }>;
};

/** Idempotent bulk onboard — upserts each catalogue entry as active. */
export async function onboardUniversitiesBulk(input: {
	country?: string;
	universities: Array<{ catalogueId: string; name: string }>;
	status?: "active" | "inactive";
	onboardedBy: string;
}): Promise<BulkOnboardResult> {
	const items = input.universities ?? [];
	if (items.length === 0) throw new Error("At least one university is required.");
	if (items.length > 5000) throw new Error("Bulk onboard is limited to 5000 universities per request.");

	const country = (input.country?.trim().toUpperCase() || "NG").slice(0, 2);
	const status = input.status ?? "active";
	const result: BulkOnboardResult = {
		created: 0,
		updated: 0,
		failed: 0,
		total: items.length,
		errors: [],
	};

	const seen = new Set<string>();
	for (const item of items) {
		const catalogueId = item.catalogueId?.trim().toLowerCase() ?? "";
		if (!catalogueId || seen.has(catalogueId)) {
			if (!catalogueId) {
				result.failed += 1;
				result.errors.push({ catalogueId: "", error: "catalogueId is required." });
			}
			continue;
		}
		seen.add(catalogueId);

		const existed = await UniversityModel.exists({ catalogueId });
		try {
			await onboardUniversity({
				catalogueId,
				name: item.name,
				country,
				status,
				onboardedBy: input.onboardedBy,
			});
			if (existed) result.updated += 1;
			else result.created += 1;
		} catch (err) {
			result.failed += 1;
			result.errors.push({
				catalogueId,
				error: err instanceof Error ? err.message : String(err),
			});
		}
	}

	return result;
}

export async function updateUniversity(
	idOrSlug: string,
	input: Partial<{
		name: string;
		status: "active" | "inactive";
		defaultStudentTokens: number | null;
		defaultLecturerTokens: number | null;
	}>,
	actorId?: string,
): Promise<UniversityRecord | null> {
	const key = idOrSlug.trim();
	if (!key) return null;

	let uni =
		Types.ObjectId.isValid(key) && String(new Types.ObjectId(key)) === key
			? await UniversityModel.findById(key)
			: null;
	if (!uni) {
		const normalized = key.toLowerCase();
		uni = await UniversityModel.findOne({
			$or: [{ slug: normalized }, { catalogueId: normalized }],
		});
	}
	if (!uni) return null;

	if (input.name !== undefined) uni.name = input.name.trim();
	if (input.status !== undefined) {
		uni.status = input.status;
		if (input.status === "active") {
			uni.onboardedAt = uni.onboardedAt ?? new Date();
			if (actorId) uni.onboardedBy = new Types.ObjectId(actorId);
		}
	}
	if (input.defaultStudentTokens !== undefined) {
		uni.defaultStudentTokens =
			input.defaultStudentTokens == null || input.defaultStudentTokens <= 0
				? null
				: Math.round(input.defaultStudentTokens);
	}
	if (input.defaultLecturerTokens !== undefined) {
		uni.defaultLecturerTokens =
			input.defaultLecturerTokens == null || input.defaultLecturerTokens <= 0
				? null
				: Math.round(input.defaultLecturerTokens);
	}
	await uni.save();
	const counts = await countsForUniversities([uni._id]);
	return toRecord(uni.toObject(), counts.get(uni._id.toString()));
}

export type UniversityDetailRecord = UniversityRecord & {
	studentCount: number;
	lecturerCount: number;
};

export async function getUniversityRecord(idOrSlug: string): Promise<UniversityDetailRecord | null> {
	const key = idOrSlug.trim();
	if (!key) return null;

	let uni =
		Types.ObjectId.isValid(key) && String(new Types.ObjectId(key)) === key
			? await UniversityModel.findById(key).lean()
			: null;

	if (!uni) {
		const normalized = key.toLowerCase();
		uni = await UniversityModel.findOne({
			$or: [{ slug: normalized }, { catalogueId: normalized }],
		}).lean();
	}

	if (!uni) return null;

	const oid = uni._id;
	const counts = await countsForUniversities([oid]);
	const base = toRecord(uni, counts.get(oid.toString()));

	const [studentCount, lecturerCount] = await Promise.all([
		UserModel.countDocuments({ universityId: oid, role: "student" }),
		UserModel.countDocuments({ universityId: oid, role: { $in: ["lecturer", "researcher"] } }),
	]);

	return { ...base, studentCount, lecturerCount };
}

async function resolveUniversityDoc(idOrSlug: string) {
	const key = idOrSlug.trim();
	if (!key) return null;
	if (Types.ObjectId.isValid(key) && String(new Types.ObjectId(key)) === key) {
		const byId = await UniversityModel.findById(key);
		if (byId) return byId;
	}
	const normalized = key.toLowerCase();
	return UniversityModel.findOne({
		$or: [{ slug: normalized }, { catalogueId: normalized }],
	});
}

/**
 * Soft-offboard: deactivate university, suspend affiliated users.
 * Hard-delete the university document only when it has zero users.
 */
export async function offboardUniversity(
	idOrSlug: string,
	confirmName: string,
): Promise<{ university: UniversityRecord | null; hardDeleted: boolean; suspendedUsers: number }> {
	const uni = await resolveUniversityDoc(idOrSlug);
	if (!uni) throw new Error("University not found.");

	const expected = uni.name.trim().toLowerCase();
	if (!confirmName?.trim() || confirmName.trim().toLowerCase() !== expected) {
		throw new Error("Confirmation name does not match the university name.");
	}

	uni.status = "inactive";
	await uni.save();

	const suspendResult = await UserModel.updateMany(
		{ universityId: uni._id, role: { $ne: "admin" } },
		{ status: "suspended", suspensionReason: "University offboarded" },
	);

	const remainingUsers = await UserModel.countDocuments({ universityId: uni._id });
	if (remainingUsers === 0) {
		await UniversityModel.findByIdAndDelete(uni._id);
		return {
			university: null,
			hardDeleted: true,
			suspendedUsers: suspendResult.modifiedCount,
		};
	}

	const counts = await countsForUniversities([uni._id]);
	return {
		university: toRecord(uni.toObject(), counts.get(uni._id.toString())),
		hardDeleted: false,
		suspendedUsers: suspendResult.modifiedCount,
	};
}
