import { Types } from "mongoose";

import { AssignmentBriefModel } from "../db/models/AssignmentBrief.js";
import { PortalProjectModel } from "../db/models/PortalProject.js";
import { UserModel } from "../db/models/User.js";
import type { AdminScope } from "../lib/require-admin.js";
import { assertDocInScope, scopeFilter } from "../lib/admin-scope.js";
import { ProjectStatus } from "../lib/portal-enums.js";
import { recordAuditEvent } from "./admin-audit.service.js";

const SUPERVISION_TYPES = [
	"dissertation",
	"thesis",
	"research",
	"project",
	"capstone",
	"publication",
] as const;

export type AdminPortalPerson = {
	id: string | null;
	name: string;
	email: string;
	role: string | null;
};

export type AdminPortalProjectRecord = {
	id: string;
	universityId: string;
	title: string;
	projectType: string;
	status: string;
	stage: string;
	progressPercent: number;
	topicStatus: string;
	score: number | null;
	courseName: string;
	courseYear: string;
	student: AdminPortalPerson;
	supervisor: AdminPortalPerson;
	coSupervisor: AdminPortalPerson;
	assignmentBriefId: string | null;
	updatedAt: string;
	createdAt: string;
};

export type AdminPortalBriefRecord = {
	id: string;
	universityId: string;
	title: string;
	status: string;
	courseName: string;
	courseYear: string;
	maxScore: number;
	dueAt: string | null;
	lecturer: AdminPortalPerson;
	submissionCount: number;
	updatedAt: string;
	createdAt: string;
};

export type AdminPortalSummary = {
	supervisionProjects: number;
	assignmentProjects: number;
	activeProjects: number;
	unassignedSupervisors: number;
	publishedBriefs: number;
	draftBriefs: number;
};

const EMPTY_PERSON: AdminPortalPerson = {
	id: null,
	name: "—",
	email: "—",
	role: null,
};

function iso(value: Date | null | undefined): string {
	return value ? value.toISOString() : new Date(0).toISOString();
}

async function peopleMap(ids: Array<Types.ObjectId | string | null | undefined>) {
	const unique = [
		...new Set(
			ids
				.map((id) => (id ? id.toString() : ""))
				.filter((id) => Types.ObjectId.isValid(id)),
		),
	];
	const map = new Map<string, AdminPortalPerson>();
	if (unique.length === 0) return map;
	const users = await UserModel.find({ _id: { $in: unique.map((id) => new Types.ObjectId(id)) } })
		.select("name email role")
		.lean();
	for (const user of users) {
		map.set(user._id.toString(), {
			id: user._id.toString(),
			name: user.name,
			email: user.email,
			role: user.role,
		});
	}
	return map;
}

function personFrom(map: Map<string, AdminPortalPerson>, id: Types.ObjectId | null | undefined): AdminPortalPerson {
	if (!id) return EMPTY_PERSON;
	return map.get(id.toString()) ?? { ...EMPTY_PERSON, id: id.toString(), name: "Unknown" };
}

export async function getAdminPortalSummary(scope: AdminScope): Promise<AdminPortalSummary> {
	const filter = scopeFilter(scope);
	const [
		supervisionProjects,
		assignmentProjects,
		activeProjects,
		unassignedSupervisors,
		publishedBriefs,
		draftBriefs,
	] = await Promise.all([
		PortalProjectModel.countDocuments({
			...filter,
			projectType: { $in: [...SUPERVISION_TYPES] },
			deletedAt: { $exists: false },
		}),
		PortalProjectModel.countDocuments({
			...filter,
			projectType: "assignment",
			deletedAt: { $exists: false },
		}),
		PortalProjectModel.countDocuments({
			...filter,
			status: ProjectStatus.Active,
			deletedAt: { $exists: false },
		}),
		PortalProjectModel.countDocuments({
			...filter,
			projectType: { $in: [...SUPERVISION_TYPES] },
			$or: [{ supervisorId: { $exists: false } }, { supervisorId: null }],
			deletedAt: { $exists: false },
		}),
		AssignmentBriefModel.countDocuments({
			...filter,
			status: "published",
			deletedAt: { $exists: false },
		}),
		AssignmentBriefModel.countDocuments({
			...filter,
			status: "draft",
			deletedAt: { $exists: false },
		}),
	]);

	return {
		supervisionProjects,
		assignmentProjects,
		activeProjects,
		unassignedSupervisors,
		publishedBriefs,
		draftBriefs,
	};
}

export async function listAdminPortalProjects(
	scope: AdminScope,
	opts: {
		family?: "supervision" | "assignment" | "all";
		status?: string;
		universityId?: string;
		search?: string;
		limit?: number;
	} = {},
): Promise<AdminPortalProjectRecord[]> {
	const filter: Record<string, unknown> = {
		...scopeFilter(scope),
		deletedAt: { $exists: false },
	};

	if (scope.kind === "platform" && opts.universityId && Types.ObjectId.isValid(opts.universityId)) {
		filter.universityId = new Types.ObjectId(opts.universityId);
	}

	const family = opts.family ?? "all";
	if (family === "supervision") {
		filter.projectType = { $in: [...SUPERVISION_TYPES] };
	} else if (family === "assignment") {
		filter.projectType = "assignment";
	}

	if (opts.status && Object.values(ProjectStatus).includes(opts.status as ProjectStatus)) {
		filter.status = opts.status;
	}

	const search = opts.search?.trim();
	if (search) {
		filter.$or = [
			{ title: { $regex: search, $options: "i" } },
			{ courseName: { $regex: search, $options: "i" } },
			{ topic: { $regex: search, $options: "i" } },
		];
	}

	const limit = Math.min(Math.max(opts.limit ?? 200, 1), 500);
	const docs = await PortalProjectModel.find(filter)
		.select(
			"universityId studentId supervisorId coSupervisorId projectType title status stage progressPercent topicStatus score courseName courseYear assignmentBriefId createdAt updatedAt",
		)
		.sort({ updatedAt: -1 })
		.limit(limit)
		.lean();

	const people = await peopleMap(
		docs.flatMap((d) => [d.studentId, d.supervisorId, d.coSupervisorId]),
	);

	return docs.map((doc) => ({
		id: doc._id.toString(),
		universityId: doc.universityId.toString(),
		title: doc.title,
		projectType: doc.projectType,
		status: doc.status,
		stage: doc.stage,
		progressPercent: doc.progressPercent ?? 0,
		topicStatus: doc.topicStatus ?? "draft",
		score: doc.score ?? null,
		courseName: doc.courseName ?? "",
		courseYear: doc.courseYear ?? "",
		student: personFrom(people, doc.studentId),
		supervisor: personFrom(people, doc.supervisorId),
		coSupervisor: personFrom(people, doc.coSupervisorId),
		assignmentBriefId: doc.assignmentBriefId ? doc.assignmentBriefId.toString() : null,
		updatedAt: iso(doc.updatedAt),
		createdAt: iso(doc.createdAt),
	}));
}

export async function updateAdminPortalProject(
	scope: AdminScope,
	projectId: string,
	input: Partial<{
		supervisorId: string | null;
		coSupervisorId: string | null;
		status: string;
	}>,
	actorId: string,
): Promise<AdminPortalProjectRecord | null> {
	const existing = await assertDocInScope(PortalProjectModel, projectId, scope);
	if (!existing) return null;

	const project = await PortalProjectModel.findById(projectId);
	if (!project || project.deletedAt) return null;

	const universityId = project.universityId.toString();

	if (input.supervisorId !== undefined) {
		if (input.supervisorId === null || input.supervisorId === "") {
			project.supervisorId = undefined;
		} else {
			if (!Types.ObjectId.isValid(input.supervisorId)) {
				throw new Error("Invalid supervisor id.");
			}
			const supervisor = await UserModel.findOne({
				_id: new Types.ObjectId(input.supervisorId),
				universityId: project.universityId,
				role: { $in: ["lecturer", "researcher", "admin"] },
				status: "active",
			})
				.select("_id")
				.lean();
			if (!supervisor) throw new Error("Supervisor must be an active lecturer at this university.");
			project.supervisorId = supervisor._id;
		}
	}

	if (input.coSupervisorId !== undefined) {
		if (input.coSupervisorId === null || input.coSupervisorId === "") {
			project.coSupervisorId = undefined;
		} else {
			if (!Types.ObjectId.isValid(input.coSupervisorId)) {
				throw new Error("Invalid co-supervisor id.");
			}
			const co = await UserModel.findOne({
				_id: new Types.ObjectId(input.coSupervisorId),
				universityId: project.universityId,
				role: { $in: ["lecturer", "researcher", "admin"] },
				status: "active",
			})
				.select("_id")
				.lean();
			if (!co) throw new Error("Co-supervisor must be an active lecturer at this university.");
			project.coSupervisorId = co._id;
		}
	}

	if (input.status !== undefined) {
		if (!Object.values(ProjectStatus).includes(input.status as ProjectStatus)) {
			throw new Error("Invalid project status.");
		}
		project.status = input.status as ProjectStatus;
	}

	await project.save();

	await recordAuditEvent({
		action: "admin.portal_project_updated",
		category: "admin",
		actorId,
		summary: `Updated portal project "${project.title}"`,
		targetType: "portal_project",
		targetId: projectId,
		severity: "medium",
		details: {
			universityId,
			supervisorId: project.supervisorId?.toString() ?? null,
			coSupervisorId: project.coSupervisorId?.toString() ?? null,
			status: project.status,
		},
	});

	const people = await peopleMap([project.studentId, project.supervisorId, project.coSupervisorId]);
	return {
		id: project._id.toString(),
		universityId,
		title: project.title,
		projectType: project.projectType,
		status: project.status,
		stage: project.stage,
		progressPercent: project.progressPercent ?? 0,
		topicStatus: project.topicStatus ?? "draft",
		score: project.score ?? null,
		courseName: project.courseName ?? "",
		courseYear: project.courseYear ?? "",
		student: personFrom(people, project.studentId),
		supervisor: personFrom(people, project.supervisorId),
		coSupervisor: personFrom(people, project.coSupervisorId),
		assignmentBriefId: project.assignmentBriefId ? project.assignmentBriefId.toString() : null,
		updatedAt: iso(project.updatedAt),
		createdAt: iso(project.createdAt),
	};
}

export async function listAdminPortalBriefs(
	scope: AdminScope,
	opts: { universityId?: string; status?: string; search?: string; limit?: number } = {},
): Promise<AdminPortalBriefRecord[]> {
	const filter: Record<string, unknown> = {
		...scopeFilter(scope),
		deletedAt: { $exists: false },
	};

	if (scope.kind === "platform" && opts.universityId && Types.ObjectId.isValid(opts.universityId)) {
		filter.universityId = new Types.ObjectId(opts.universityId);
	}
	if (opts.status === "draft" || opts.status === "published") {
		filter.status = opts.status;
	}
	const search = opts.search?.trim();
	if (search) {
		filter.$or = [
			{ title: { $regex: search, $options: "i" } },
			{ courseName: { $regex: search, $options: "i" } },
		];
	}

	const limit = Math.min(Math.max(opts.limit ?? 200, 1), 500);
	const docs = await AssignmentBriefModel.find(filter)
		.select(
			"universityId lecturerId title status courseName courseYear maxScore dueAt createdAt updatedAt",
		)
		.sort({ updatedAt: -1 })
		.limit(limit)
		.lean();

	const people = await peopleMap(docs.map((d) => d.lecturerId));
	const briefIds = docs.map((d) => d._id);
	const submissionCounts =
		briefIds.length === 0
			? []
			: await PortalProjectModel.aggregate<{ _id: Types.ObjectId; count: number }>([
					{
						$match: {
							assignmentBriefId: { $in: briefIds },
							deletedAt: { $exists: false },
						},
					},
					{ $group: { _id: "$assignmentBriefId", count: { $sum: 1 } } },
				]);
	const countMap = new Map(submissionCounts.map((row) => [row._id.toString(), row.count]));

	return docs.map((doc) => ({
		id: doc._id.toString(),
		universityId: doc.universityId.toString(),
		title: doc.title,
		status: doc.status,
		courseName: doc.courseName ?? "",
		courseYear: doc.courseYear ?? "",
		maxScore: doc.maxScore ?? 100,
		dueAt: doc.dueAt ? iso(doc.dueAt) : null,
		lecturer: personFrom(people, doc.lecturerId),
		submissionCount: countMap.get(doc._id.toString()) ?? 0,
		updatedAt: iso(doc.updatedAt),
		createdAt: iso(doc.createdAt),
	}));
}

export async function updateAdminPortalBrief(
	scope: AdminScope,
	briefId: string,
	input: Partial<{ status: "draft" | "published"; archive: boolean }>,
	actorId: string,
): Promise<AdminPortalBriefRecord | null> {
	const existing = await assertDocInScope(AssignmentBriefModel, briefId, scope);
	if (!existing) return null;

	const brief = await AssignmentBriefModel.findById(briefId);
	if (!brief || brief.deletedAt) return null;

	if (input.archive) {
		brief.deletedAt = new Date();
	} else if (input.status) {
		brief.status = input.status;
	}

	await brief.save();

	await recordAuditEvent({
		action: "admin.portal_brief_updated",
		category: "admin",
		actorId,
		summary: input.archive
			? `Archived assignment brief "${brief.title}"`
			: `Updated assignment brief "${brief.title}" (${brief.status})`,
		targetType: "assignment_brief",
		targetId: briefId,
		severity: "medium",
		details: {
			universityId: brief.universityId.toString(),
			status: brief.status,
			archived: Boolean(brief.deletedAt),
		},
	});

	if (brief.deletedAt) return null;

	const list = await listAdminPortalBriefs(scope, {
		universityId: scope.kind === "platform" ? brief.universityId.toString() : undefined,
		limit: 500,
	});
	return list.find((b) => b.id === briefId) ?? null;
}

export async function listAdminSupervisors(
	scope: AdminScope,
	universityId?: string,
): Promise<AdminPortalPerson[]> {
	const filter: Record<string, unknown> = {
		role: { $in: ["lecturer", "researcher"] },
		status: "active",
	};
	if (scope.kind === "university") {
		filter.universityId = new Types.ObjectId(scope.universityId);
	} else if (universityId && Types.ObjectId.isValid(universityId)) {
		filter.universityId = new Types.ObjectId(universityId);
	} else {
		return [];
	}

	const users = await UserModel.find(filter).select("name email role").sort({ name: 1 }).limit(500).lean();
	return users.map((u) => ({
		id: u._id.toString(),
		name: u.name,
		email: u.email,
		role: u.role,
	}));
}
