import { ApprovalRequestModel } from "../db/models/ApprovalRequest.js";
import { UserModel } from "../db/models/User.js";
import {
	assertDocInScope,
	backfillUniversityIdFromUserRef,
	resolveUniversityIdForWrite,
	scopeFilter,
	universityObjectId,
} from "../lib/admin-scope.js";
import { orgDimensionsForUser } from "../lib/org-dimensions.js";
import type { AdminScope } from "../lib/require-admin.js";
import { recordAuditEvent } from "./admin-audit.service.js";

export type ApprovalKind = "tool" | "dataset" | "use_case" | "model" | "integration";
export type ApprovalStatus = "pending" | "under_review" | "approved" | "rejected" | "withdrawn";

export type ApprovalRequestRecord = {
	id: string;
	title: string;
	description: string;
	kind: ApprovalKind;
	status: ApprovalStatus;
	requesterId: string;
	requesterName: string | null;
	requesterEmail: string | null;
	faculty: string | null;
	department: string | null;
	justification: string;
	riskNotes: string;
	reviewerId: string | null;
	reviewerName: string | null;
	reviewNotes: string;
	decidedAt: string | null;
	createdAt: string;
	updatedAt: string;
};

function toRecord(doc: {
	_id: { toString(): string };
	title: string;
	description?: string | null;
	kind: string;
	status: string;
	requesterId: { toString(): string };
	requesterName?: string | null;
	requesterEmail?: string | null;
	faculty?: string | null;
	department?: string | null;
	justification?: string | null;
	riskNotes?: string | null;
	reviewerId?: { toString(): string } | null;
	reviewerName?: string | null;
	reviewNotes?: string | null;
	decidedAt?: Date | null;
	createdAt: Date;
	updatedAt: Date;
}): ApprovalRequestRecord {
	return {
		id: doc._id.toString(),
		title: doc.title,
		description: doc.description ?? "",
		kind: doc.kind as ApprovalKind,
		status: doc.status as ApprovalStatus,
		requesterId: doc.requesterId.toString(),
		requesterName: doc.requesterName ?? null,
		requesterEmail: doc.requesterEmail ?? null,
		faculty: doc.faculty ?? null,
		department: doc.department ?? null,
		justification: doc.justification ?? "",
		riskNotes: doc.riskNotes ?? "",
		reviewerId: doc.reviewerId?.toString() ?? null,
		reviewerName: doc.reviewerName ?? null,
		reviewNotes: doc.reviewNotes ?? "",
		decidedAt: doc.decidedAt?.toISOString() ?? null,
		createdAt: doc.createdAt.toISOString(),
		updatedAt: doc.updatedAt.toISOString(),
	};
}

/** Backfill universityId from requesterId for legacy approval requests. */
export async function normalizeApprovalDefaults() {
	await backfillUniversityIdFromUserRef(ApprovalRequestModel, "requesterId");
}

export async function listApprovals(
	options: {
		status?: string;
		kind?: string;
		limit?: number;
	} = {},
	scope?: AdminScope,
): Promise<ApprovalRequestRecord[]> {
	const filter: Record<string, unknown> = {
		...scopeFilter(scope),
	};
	if (options.status) filter.status = options.status;
	if (options.kind) filter.kind = options.kind;
	const limit = Math.min(Math.max(options.limit ?? 100, 1), 300);
	const rows = await ApprovalRequestModel.find(filter).sort({ createdAt: -1 }).limit(limit).lean();
	return rows.map(toRecord);
}

export async function createApproval(
	input: {
		title: string;
		description?: string;
		kind: ApprovalKind;
		justification?: string;
		riskNotes?: string;
		requesterId: string;
		universityId?: string;
	},
	actorId?: string,
	scope?: AdminScope,
): Promise<ApprovalRequestRecord> {
	const requester = await UserModel.findById(input.requesterId)
		.select("name email role department faculty programme cohort createdAt universityId")
		.lean();
	if (!requester) throw new Error("Requester not found.");
	const org = orgDimensionsForUser(requester);

	const universityId = await resolveUniversityIdForWrite(
		scope,
		actorId ?? input.requesterId,
		input.universityId ?? requester.universityId?.toString(),
	);

	const doc = await ApprovalRequestModel.create({
		title: input.title.trim(),
		description: input.description?.trim() ?? "",
		kind: input.kind,
		status: "pending",
		requesterId: input.requesterId,
		requesterName: requester.name,
		requesterEmail: requester.email,
		universityId: universityObjectId(universityId),
		faculty: org.faculty,
		department: org.department,
		justification: input.justification?.trim() ?? "",
		riskNotes: input.riskNotes?.trim() ?? "",
	});

	await recordAuditEvent({
		action: "approval.submitted",
		category: "approval",
		actorId: actorId ?? input.requesterId,
		summary: `Submitted ${input.kind} approval: “${doc.title}”`,
		targetType: "approval",
		targetId: doc._id.toString(),
		details: { kind: input.kind },
		faculty: org.faculty,
		department: org.department,
	});

	return toRecord(doc.toObject());
}

export async function reviewApproval(
	id: string,
	input: {
		status: "under_review" | "approved" | "rejected" | "withdrawn";
		reviewNotes?: string;
	},
	reviewerId: string,
	scope?: AdminScope,
): Promise<ApprovalRequestRecord | null> {
	const existing = await assertDocInScope(ApprovalRequestModel, id, scope);
	if (!existing) return null;

	const reviewer = await UserModel.findById(reviewerId).select("name email").lean();
	const decided =
		input.status === "approved" || input.status === "rejected" || input.status === "withdrawn";

	const doc = await ApprovalRequestModel.findByIdAndUpdate(
		id,
		{
			status: input.status,
			reviewNotes: input.reviewNotes?.trim() ?? "",
			reviewerId,
			reviewerName: reviewer?.name,
			...(decided ? { decidedAt: new Date() } : {}),
		},
		{ new: true },
	).lean();

	if (!doc) return null;

	await recordAuditEvent({
		action: `approval.${input.status}`,
		category: "approval",
		actorId: reviewerId,
		summary: `${input.status.replace("_", " ")} approval “${doc.title}”`,
		targetType: "approval",
		targetId: id,
		details: { status: input.status, reviewNotes: input.reviewNotes },
		severity: input.status === "rejected" ? "medium" : "info",
		faculty: doc.faculty ?? undefined,
		department: doc.department ?? undefined,
	});

	return toRecord(doc);
}

export async function getApprovalStats(scope?: AdminScope) {
	const base = scopeFilter(scope);
	const [total, pending, underReview, approved, rejected] = await Promise.all([
		ApprovalRequestModel.countDocuments(base),
		ApprovalRequestModel.countDocuments({ ...base, status: "pending" }),
		ApprovalRequestModel.countDocuments({ ...base, status: "under_review" }),
		ApprovalRequestModel.countDocuments({ ...base, status: "approved" }),
		ApprovalRequestModel.countDocuments({ ...base, status: "rejected" }),
	]);
	return { total, pending, underReview, approved, rejected };
}
