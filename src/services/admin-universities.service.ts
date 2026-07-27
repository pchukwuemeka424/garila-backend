import { Types } from "mongoose";

import { UniversityModel } from "../db/models/University.js";
import { UserModel } from "../db/models/User.js";

export type UniversityRecord = {
	id: string;
	catalogueId: string;
	name: string;
	slug: string;
	status: "active" | "inactive";
	userCount: number;
	adminCount: number;
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
		status: string;
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
		status: doc.status as "active" | "inactive",
		userCount: counts.userCount,
		adminCount: counts.adminCount,
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

/** Find by catalogue id, or create an inactive university stub for registration. */
export async function ensureUniversityFromCatalogue(input: {
	catalogueId: string;
	name: string;
}) {
	const catalogueId = input.catalogueId.trim().toLowerCase();
	const name = input.name.trim();
	if (!catalogueId) throw new Error("Please select your institution.");
	if (name.length < 2) throw new Error("Please select your institution.");

	const existing = await UniversityModel.findOne({ catalogueId });
	if (existing) return existing;

	const baseSlug = slugify(catalogueId) || slugify(name) || "university";
	let slug = baseSlug;
	let attempt = 0;
	while (await UniversityModel.exists({ slug })) {
		attempt += 1;
		slug = `${baseSlug}-${attempt}`;
	}

	try {
		return await UniversityModel.create({
			catalogueId,
			name,
			slug,
			status: "inactive",
		});
	} catch {
		const raced = await UniversityModel.findOne({ catalogueId });
		if (raced) return raced;
		throw new Error("Could not resolve institution.");
	}
}

export async function onboardUniversity(input: {
	catalogueId: string;
	name: string;
	status?: "active" | "inactive";
	onboardedBy: string;
}): Promise<UniversityRecord> {
	const catalogueId = input.catalogueId.trim().toLowerCase();
	const name = input.name.trim();
	if (!catalogueId) throw new Error("catalogueId is required.");
	if (name.length < 2) throw new Error("name is required.");

	const status = input.status ?? "active";
	const existing = await UniversityModel.findOne({ catalogueId });
	const now = status === "active" ? new Date() : undefined;

	if (existing) {
		existing.name = name;
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
		status,
		...(status === "active"
			? { onboardedAt: now, onboardedBy: new Types.ObjectId(input.onboardedBy) }
			: {}),
	});
	return toRecord(created.toObject());
}

export async function updateUniversity(
	id: string,
	input: Partial<{ name: string; status: "active" | "inactive" }>,
	actorId?: string,
): Promise<UniversityRecord | null> {
	const uni = await UniversityModel.findById(id);
	if (!uni) return null;

	if (input.name !== undefined) uni.name = input.name.trim();
	if (input.status !== undefined) {
		uni.status = input.status;
		if (input.status === "active") {
			uni.onboardedAt = uni.onboardedAt ?? new Date();
			if (actorId) uni.onboardedBy = new Types.ObjectId(actorId);
		}
	}
	await uni.save();
	const counts = await countsForUniversities([uni._id]);
	return toRecord(uni.toObject(), counts.get(uni._id.toString()));
}
