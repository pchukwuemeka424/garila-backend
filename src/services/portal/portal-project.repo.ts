import { Types } from "mongoose";

import { PortalProjectModel } from "../../db/models/PortalProject.js";

function uni(data: Record<string, unknown>) {
	const { tenantId, ...rest } = data;
	return { ...rest, universityId: tenantId };
}

export const projectRepository = {
	findById: (tenantId: string, id: string) =>
		PortalProjectModel.findOne({
			_id: id,
			universityId: tenantId,
			deletedAt: { $exists: false },
		}),

	list: (tenantId: string, filter: Record<string, unknown> = {}) =>
		PortalProjectModel.find({
			universityId: tenantId,
			deletedAt: { $exists: false },
			...filter,
		}).sort({ updatedAt: -1 }),

	listByAssignmentBrief: (tenantId: string, assignmentBriefId: string) =>
		PortalProjectModel.find({
			universityId: tenantId,
			assignmentBriefId,
			projectType: "assignment",
			deletedAt: { $exists: false },
		}).sort({ updatedAt: -1 }),

	countByAssignmentBriefIds: async (
		tenantId: string,
		briefIds: string[],
	): Promise<Map<string, number>> => {
		if (briefIds.length === 0) return new Map();
		const objectIds = briefIds
			.filter((id) => Types.ObjectId.isValid(id))
			.map((id) => new Types.ObjectId(id));
		if (objectIds.length === 0) return new Map();

		const aggregated = await PortalProjectModel.aggregate<{
			_id: unknown;
			count: number;
		}>([
			{
				$match: {
					universityId: new Types.ObjectId(tenantId),
					assignmentBriefId: { $in: objectIds },
					projectType: "assignment",
					deletedAt: { $exists: false },
				},
			},
			{ $group: { _id: "$assignmentBriefId", count: { $sum: 1 } } },
		]);

		return new Map(aggregated.map((row) => [String(row._id), row.count] as const));
	},

	create: (data: Record<string, unknown>) => PortalProjectModel.create(uni(data)),

	update: (tenantId: string, id: string, update: Record<string, unknown>) =>
		PortalProjectModel.findOneAndUpdate(
			{ _id: id, universityId: tenantId, deletedAt: { $exists: false } },
			update,
			{ new: true },
		),

	softDelete: (tenantId: string, id: string) =>
		PortalProjectModel.findOneAndUpdate(
			{ _id: id, universityId: tenantId, deletedAt: { $exists: false } },
			{ deletedAt: new Date() },
			{ new: true },
		),
};
