import { Types } from "mongoose";

import { ResearchProvenanceRecordModel } from "../db/models/ResearchProvenanceRecord.js";
import { UserModel } from "../db/models/User.js";
import type { AdminScope } from "../lib/require-admin.js";
import { universityFilterForScope } from "../lib/require-admin.js";
import { recordAuditEvent } from "./admin-audit.service.js";

export type ProvenanceOutputType =
	| "paper"
	| "outline"
	| "draft"
	| "idea"
	| "note"
	| "dataset"
	| "other";

export type ProvenanceStatus = "available" | "under_review" | "cleared" | "escalated";

export type ProvenanceEvent = {
	at: string;
	action: string;
	agentOrTool: string;
	model: string;
	summary: string;
	humanEdited: boolean;
};

export type ResearchProvenanceRecord = {
	id: string;
	outputRef: string;
	outputTitle: string;
	outputType: ProvenanceOutputType;
	ownerId: string | null;
	ownerName: string;
	ownerEmail: string;
	universityId: string | null;
	faculty: string | null;
	department: string | null;
	status: ProvenanceStatus;
	privacyRedacted: boolean;
	events: ProvenanceEvent[];
	reviewNotes: string;
	reviewedByName: string;
	reviewedAt: string | null;
	accessGrantedTo: string[];
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
	status: string;
	privacyRedacted?: boolean;
	events?: Array<{
		at: Date | string;
		action: string;
		agentOrTool?: string | null;
		model?: string | null;
		summary?: string | null;
		humanEdited?: boolean;
	}>;
	reviewNotes?: string | null;
	reviewedByName?: string | null;
	reviewedAt?: Date | null;
	accessGrantedTo?: string[];
	createdAt: Date;
	updatedAt: Date;
}): ResearchProvenanceRecord {
	return {
		id: doc._id.toString(),
		outputRef: doc.outputRef,
		outputTitle: doc.outputTitle,
		outputType: doc.outputType as ProvenanceOutputType,
		ownerId: doc.ownerId?.toString() ?? null,
		ownerName: doc.ownerName ?? "",
		ownerEmail: doc.ownerEmail ?? "",
		universityId: doc.universityId?.toString() ?? null,
		faculty: doc.faculty ?? null,
		department: doc.department ?? null,
		status: (doc.status as ProvenanceStatus) || "available",
		privacyRedacted: doc.privacyRedacted !== false,
		events: (doc.events ?? []).map((e) => ({
			at: e.at instanceof Date ? e.at.toISOString() : String(e.at),
			action: e.action ?? "event",
			agentOrTool: e.agentOrTool ?? "",
			model: e.model ?? "",
			summary: e.summary ?? "",
			humanEdited: Boolean(e.humanEdited),
		})),
		reviewNotes: doc.reviewNotes ?? "",
		reviewedByName: doc.reviewedByName ?? "",
		reviewedAt: doc.reviewedAt?.toISOString() ?? null,
		accessGrantedTo: doc.accessGrantedTo ?? [],
		createdAt: doc.createdAt.toISOString(),
		updatedAt: doc.updatedAt.toISOString(),
	};
}

function scopeFilter(scope?: AdminScope): Record<string, unknown> {
	return universityFilterForScope(scope ?? { kind: "platform", actorId: "", role: "admin" });
}

async function assertRecordInScope(id: string, scope?: AdminScope) {
	if (!scope || scope.kind === "platform") {
		return ResearchProvenanceRecordModel.findById(id).lean();
	}
	return ResearchProvenanceRecordModel.findOne({
		_id: id,
		universityId: new Types.ObjectId(scope.universityId),
	}).lean();
}

/** Backfill universityId from owners for legacy provenance records. */
export async function normalizeProvenanceDefaults() {
	await ResearchProvenanceRecordModel.updateMany(
		{ $or: [{ outputTitle: { $exists: false } }, { outputTitle: "" }, { outputTitle: "--" }] },
		{ $set: { outputTitle: "Untitled research output" } },
	);
	await ResearchProvenanceRecordModel.updateMany(
		{ $or: [{ outputRef: { $exists: false } }, { outputRef: "" }, { outputRef: "--" }] },
		{ $set: { outputRef: "unspecified" } },
	);
	await ResearchProvenanceRecordModel.updateMany(
		{ status: { $exists: false } },
		{ $set: { status: "available" } },
	);

	const missingUniversity = await ResearchProvenanceRecordModel.find({
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
			await ResearchProvenanceRecordModel.updateOne(
				{ _id: row._id },
				{ $set: { universityId: new Types.ObjectId(universityId) } },
			);
		}),
	);
}

export async function listProvenanceRecords(
	options: {
		status?: string;
		outputType?: string;
		limit?: number;
	} = {},
	scope?: AdminScope,
) {
	const filter: Record<string, unknown> = {
		...scopeFilter(scope),
	};
	if (options.status) filter.status = options.status;
	if (options.outputType) filter.outputType = options.outputType;
	const limit = Math.min(Math.max(options.limit ?? 100, 1), 300);
	const rows = await ResearchProvenanceRecordModel.find(filter)
		.sort({ createdAt: -1 })
		.limit(limit)
		.lean();
	return rows.map(toRecord);
}

export async function createProvenanceRecord(
	input: {
		outputRef: string;
		outputTitle: string;
		outputType?: ProvenanceOutputType;
		ownerId?: string;
		ownerName?: string;
		ownerEmail?: string;
		faculty?: string;
		department?: string;
		universityId?: string;
		events?: Array<{
			at?: string;
			action: string;
			agentOrTool?: string;
			model?: string;
			summary?: string;
			humanEdited?: boolean;
		}>;
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
		throw new Error("You can only create provenance records for your university.");
	}

	const doc = await ResearchProvenanceRecordModel.create({
		outputRef: input.outputRef.trim(),
		outputTitle: input.outputTitle.trim(),
		outputType: input.outputType ?? "draft",
		ownerId: input.ownerId,
		ownerName: input.ownerName?.trim() ?? "",
		ownerEmail: input.ownerEmail?.trim() ?? "",
		universityId: universityId ? new Types.ObjectId(universityId) : undefined,
		faculty: input.faculty?.trim(),
		department: input.department?.trim(),
		privacyRedacted: true,
		events: (input.events ?? []).map((e) => ({
			at: e.at ? new Date(e.at) : new Date(),
			action: e.action.trim(),
			agentOrTool: e.agentOrTool?.trim() ?? "",
			model: e.model?.trim() ?? "",
			summary: e.summary?.trim() ?? "",
			humanEdited: Boolean(e.humanEdited),
		})),
	});

	if (actorId) {
		await recordAuditEvent({
			action: "provenance.recorded",
			category: "ai_use",
			actorId,
			summary: `Recorded provenance for “${doc.outputTitle}”`,
			targetType: "research_provenance",
			targetId: doc._id.toString(),
			details: { outputRef: doc.outputRef, eventCount: doc.events?.length ?? 0 },
			faculty: doc.faculty ?? undefined,
			department: doc.department ?? undefined,
		});
	}

	return toRecord(doc.toObject());
}

export async function reviewProvenanceRecord(
	id: string,
	input: {
		status?: ProvenanceStatus;
		reviewNotes?: string;
		accessGrantedTo?: string[];
	},
	actorId: string,
	actorName?: string,
	scope?: AdminScope,
) {
	const existing = await assertRecordInScope(id, scope);
	if (!existing) return null;

	const doc = await ResearchProvenanceRecordModel.findByIdAndUpdate(
		id,
		{
			...(input.status !== undefined ? { status: input.status } : {}),
			...(input.reviewNotes !== undefined ? { reviewNotes: input.reviewNotes.trim() } : {}),
			...(input.accessGrantedTo !== undefined ? { accessGrantedTo: input.accessGrantedTo } : {}),
			reviewedAt: new Date(),
			reviewedBy: actorId,
			reviewedByName: actorName ?? "",
		},
		{ new: true },
	).lean();

	if (!doc) return null;

	await recordAuditEvent({
		action: "provenance.reviewed",
		category: "admin",
		actorId,
		summary: `Reviewed provenance for “${doc.outputTitle}” (${doc.status})`,
		targetType: "research_provenance",
		targetId: id,
		severity: doc.status === "escalated" ? "high" : "info",
		flagged: doc.status === "escalated",
		flagReason: doc.status === "escalated" ? "Provenance escalated for integrity review" : undefined,
	});

	return toRecord(doc);
}

export async function getProvenanceStats(scope?: AdminScope) {
	const base = scopeFilter(scope);
	const [total, underReview, cleared, escalated, available] = await Promise.all([
		ResearchProvenanceRecordModel.countDocuments(base),
		ResearchProvenanceRecordModel.countDocuments({ ...base, status: "under_review" }),
		ResearchProvenanceRecordModel.countDocuments({ ...base, status: "cleared" }),
		ResearchProvenanceRecordModel.countDocuments({ ...base, status: "escalated" }),
		ResearchProvenanceRecordModel.countDocuments({ ...base, status: "available" }),
	]);
	return { total, underReview, cleared, escalated, available };
}
