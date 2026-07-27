import { Types } from "mongoose";

import { AiContributionStatementModel } from "../db/models/AiContributionStatement.js";
import { UserModel } from "../db/models/User.js";
import type { AdminScope } from "../lib/require-admin.js";
import { universityFilterForScope } from "../lib/require-admin.js";
import { recordAuditEvent } from "./admin-audit.service.js";

export type ContributionOutputType =
	| "paper"
	| "outline"
	| "draft"
	| "idea"
	| "note"
	| "dataset"
	| "other";

export type AiContributionStatementRecord = {
	id: string;
	outputRef: string;
	outputTitle: string;
	outputType: ContributionOutputType;
	ownerId: string | null;
	ownerName: string;
	ownerEmail: string;
	universityId: string | null;
	faculty: string | null;
	department: string | null;
	programme: string | null;
	aiAssisted: boolean;
	contributionSummary: string;
	toolsUsed: string[];
	modelNames: string[];
	humanEdited: boolean;
	disclosureComplete: boolean;
	verified: boolean;
	verifiedAt: string | null;
	verifiedByName: string;
	verificationNotes: string;
	generatedAt: string;
	createdAt: string;
	updatedAt: string;
};

function toRecord(doc: {
	_id: { toString(): string };
	outputRef: string;
	outputTitle: string;
	outputType: string;
	ownerId?: { toString(): string } | null;
	ownerName?: string | null;
	ownerEmail?: string | null;
	universityId?: { toString(): string } | null;
	faculty?: string | null;
	department?: string | null;
	programme?: string | null;
	aiAssisted?: boolean;
	contributionSummary?: string | null;
	toolsUsed?: string[];
	modelNames?: string[];
	humanEdited?: boolean;
	disclosureComplete?: boolean;
	verified?: boolean;
	verifiedAt?: Date | null;
	verifiedByName?: string | null;
	verificationNotes?: string | null;
	generatedAt?: Date | null;
	createdAt: Date;
	updatedAt: Date;
}): AiContributionStatementRecord {
	return {
		id: doc._id.toString(),
		outputRef: doc.outputRef,
		outputTitle: doc.outputTitle,
		outputType: doc.outputType as ContributionOutputType,
		ownerId: doc.ownerId?.toString() ?? null,
		ownerName: doc.ownerName ?? "",
		ownerEmail: doc.ownerEmail ?? "",
		universityId: doc.universityId?.toString() ?? null,
		faculty: doc.faculty ?? null,
		department: doc.department ?? null,
		programme: doc.programme ?? null,
		aiAssisted: doc.aiAssisted !== false,
		contributionSummary: doc.contributionSummary ?? "",
		toolsUsed: doc.toolsUsed ?? [],
		modelNames: doc.modelNames ?? [],
		humanEdited: Boolean(doc.humanEdited),
		disclosureComplete: Boolean(doc.disclosureComplete),
		verified: Boolean(doc.verified),
		verifiedAt: doc.verifiedAt?.toISOString() ?? null,
		verifiedByName: doc.verifiedByName ?? "",
		verificationNotes: doc.verificationNotes ?? "",
		generatedAt: (doc.generatedAt ?? doc.createdAt).toISOString(),
		createdAt: doc.createdAt.toISOString(),
		updatedAt: doc.updatedAt.toISOString(),
	};
}

function scopeFilter(scope?: AdminScope): Record<string, unknown> {
	return universityFilterForScope(scope ?? { kind: "platform", actorId: "", role: "admin" });
}

async function assertStatementInScope(id: string, scope?: AdminScope) {
	if (!scope || scope.kind === "platform") {
		const doc = await AiContributionStatementModel.findById(id).lean();
		return doc;
	}
	const doc = await AiContributionStatementModel.findOne({
		_id: id,
		universityId: new Types.ObjectId(scope.universityId),
	}).lean();
	return doc;
}

/** Normalize sparse legacy documents and backfill universityId from owners. */
export async function normalizeContributionDefaults() {
	await Promise.all([
		AiContributionStatementModel.updateMany(
			{ aiAssisted: { $exists: false } },
			{ $set: { aiAssisted: true } },
		),
		AiContributionStatementModel.updateMany(
			{ disclosureComplete: { $exists: false } },
			{ $set: { disclosureComplete: false } },
		),
		AiContributionStatementModel.updateMany(
			{ verified: { $exists: false } },
			{ $set: { verified: false } },
		),
		AiContributionStatementModel.updateMany(
			{ humanEdited: { $exists: false } },
			{ $set: { humanEdited: false } },
		),
		AiContributionStatementModel.updateMany(
			{ $or: [{ outputTitle: { $exists: false } }, { outputTitle: "" }, { outputTitle: "--" }] },
			{ $set: { outputTitle: "Untitled research output" } },
		),
		AiContributionStatementModel.updateMany(
			{ $or: [{ outputRef: { $exists: false } }, { outputRef: "" }, { outputRef: "--" }] },
			{ $set: { outputRef: "unspecified" } },
		),
	]);

	const missingUniversity = await AiContributionStatementModel.find({
		$or: [{ universityId: { $exists: false } }, { universityId: null }],
		ownerId: { $exists: true, $ne: null },
	})
		.select("_id ownerId")
		.lean();

	if (missingUniversity.length === 0) return;

	const ownerIds = [
		...new Set(
			missingUniversity
				.map((row) => row.ownerId?.toString())
				.filter((id): id is string => Boolean(id)),
		),
	];
	const owners = await UserModel.find({ _id: { $in: ownerIds } })
		.select("_id universityId")
		.lean();
	const universityByOwner = new Map(
		owners
			.filter((u) => u.universityId)
			.map((u) => [u._id.toString(), u.universityId!.toString()] as const),
	);

	await Promise.all(
		missingUniversity.map(async (row) => {
			const ownerKey = row.ownerId?.toString();
			if (!ownerKey) return;
			const universityId = universityByOwner.get(ownerKey);
			if (!universityId) return;
			await AiContributionStatementModel.updateOne(
				{ _id: row._id },
				{ $set: { universityId: new Types.ObjectId(universityId) } },
			);
		}),
	);
}

export async function listContributionStatements(
	options: {
		verified?: boolean;
		disclosureComplete?: boolean;
		outputType?: string;
		limit?: number;
	} = {},
	scope?: AdminScope,
) {
	const filter: Record<string, unknown> = {
		...scopeFilter(scope),
	};
	if (options.verified !== undefined) filter.verified = options.verified;
	if (options.disclosureComplete !== undefined) {
		filter.disclosureComplete = options.disclosureComplete;
	}
	if (options.outputType) filter.outputType = options.outputType;
	const limit = Math.min(Math.max(options.limit ?? 100, 1), 300);
	const rows = await AiContributionStatementModel.find(filter)
		.sort({ createdAt: -1 })
		.limit(limit)
		.lean();
	return rows.map(toRecord);
}

export async function createContributionStatement(
	input: {
		outputRef: string;
		outputTitle: string;
		outputType?: ContributionOutputType;
		ownerId?: string;
		ownerName?: string;
		ownerEmail?: string;
		faculty?: string;
		department?: string;
		programme?: string;
		contributionSummary?: string;
		toolsUsed?: string[];
		modelNames?: string[];
		aiAssisted?: boolean;
		humanEdited?: boolean;
		disclosureComplete?: boolean;
		universityId?: string;
	},
	actorId?: string,
	scope?: AdminScope,
) {
	let universityId =
		scope?.kind === "university"
			? scope.universityId
			: input.universityId?.trim() || undefined;

	if (!universityId && input.ownerId) {
		const owner = await UserModel.findById(input.ownerId).select("universityId").lean();
		universityId = owner?.universityId?.toString();
	}

	if (!universityId && actorId) {
		const actor = await UserModel.findById(actorId).select("universityId").lean();
		universityId = actor?.universityId?.toString();
	}

	if (scope?.kind === "university" && universityId && universityId !== scope.universityId) {
		throw new Error("You can only create contribution statements for your university.");
	}

	const doc = await AiContributionStatementModel.create({
		outputRef: input.outputRef.trim(),
		outputTitle: input.outputTitle.trim(),
		outputType: input.outputType ?? "draft",
		ownerId: input.ownerId,
		ownerName: input.ownerName?.trim() ?? "",
		ownerEmail: input.ownerEmail?.trim() ?? "",
		universityId: universityId ? new Types.ObjectId(universityId) : undefined,
		faculty: input.faculty?.trim(),
		department: input.department?.trim(),
		programme: input.programme?.trim(),
		contributionSummary: input.contributionSummary?.trim() ?? "",
		toolsUsed: input.toolsUsed ?? [],
		modelNames: input.modelNames ?? [],
		aiAssisted: input.aiAssisted !== false,
		humanEdited: Boolean(input.humanEdited),
		disclosureComplete: Boolean(input.disclosureComplete),
		generatedAt: new Date(),
	});

	if (actorId) {
		await recordAuditEvent({
			action: "contribution.recorded",
			category: "ai_use",
			actorId,
			summary: `Recorded AI contribution statement for “${doc.outputTitle}”`,
			targetType: "ai_contribution_statement",
			targetId: doc._id.toString(),
			details: { outputRef: doc.outputRef, outputType: doc.outputType },
			faculty: doc.faculty ?? undefined,
			department: doc.department ?? undefined,
		});
	}

	return toRecord(doc.toObject());
}

export async function verifyContributionStatement(
	id: string,
	input: { verified?: boolean; verificationNotes?: string; disclosureComplete?: boolean },
	actorId: string,
	actorName?: string,
	scope?: AdminScope,
) {
	const existing = await assertStatementInScope(id, scope);
	if (!existing) return null;

	const doc = await AiContributionStatementModel.findByIdAndUpdate(
		id,
		{
			...(input.verified !== undefined
				? {
						verified: input.verified,
						verifiedAt: input.verified ? new Date() : null,
						verifiedBy: input.verified ? actorId : null,
						verifiedByName: input.verified ? (actorName ?? "") : "",
					}
				: {}),
			...(input.verificationNotes !== undefined
				? { verificationNotes: input.verificationNotes.trim() }
				: {}),
			...(input.disclosureComplete !== undefined
				? { disclosureComplete: input.disclosureComplete }
				: {}),
		},
		{ new: true },
	).lean();

	if (!doc) return null;

	await recordAuditEvent({
		action: input.verified ? "contribution.verified" : "contribution.updated",
		category: "admin",
		actorId,
		summary: `${input.verified ? "Verified" : "Updated"} AI contribution statement for “${doc.outputTitle}”`,
		targetType: "ai_contribution_statement",
		targetId: id,
	});

	return toRecord(doc);
}

export async function getContributionStats(scope?: AdminScope) {
	const base = scopeFilter(scope);
	const [total, verified, incomplete, aiAssisted, humanEdited] = await Promise.all([
		AiContributionStatementModel.countDocuments(base),
		AiContributionStatementModel.countDocuments({ ...base, verified: true }),
		AiContributionStatementModel.countDocuments({
			...base,
			$or: [{ disclosureComplete: false }, { disclosureComplete: { $exists: false } }],
		}),
		AiContributionStatementModel.countDocuments({
			...base,
			$or: [{ aiAssisted: true }, { aiAssisted: { $exists: false } }],
		}),
		AiContributionStatementModel.countDocuments({ ...base, humanEdited: true }),
	]);
	return {
		total,
		verified,
		incomplete,
		aiAssisted,
		humanEdited,
		pendingVerification: Math.max(0, total - verified),
	};
}
