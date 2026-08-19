import { AssignmentBriefModel } from "../../db/models/AssignmentBrief.js";

function uni(data: Record<string, unknown>) {
	const { tenantId, ...rest } = data;
	return { ...rest, universityId: tenantId };
}

export const assignmentBriefRepository = {
	findById: (tenantId: string, id: string) =>
		AssignmentBriefModel.findOne({
			_id: id,
			universityId: tenantId,
			deletedAt: { $exists: false },
		}),

	listForLecturer: (tenantId: string, lecturerId: string) =>
		AssignmentBriefModel.find({
			universityId: tenantId,
			lecturerId,
			deletedAt: { $exists: false },
		}).sort({ updatedAt: -1 }),

	listPublishedByLecturer: (
		tenantId: string,
		lecturerId: string,
		filters?: { courseYear?: string; courseName?: string },
	) => {
		const query: Record<string, unknown> = {
			universityId: tenantId,
			lecturerId,
			status: "published",
			deletedAt: { $exists: false },
		};
		const courseYear = filters?.courseYear?.trim();
		if (courseYear) query.courseYear = courseYear;
		const courseName = filters?.courseName?.trim();
		if (courseName) {
			query.courseName = new RegExp(
				`^${courseName.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}$`,
				"i",
			);
		}
		return AssignmentBriefModel.find(query).sort({ updatedAt: -1 });
	},

	create: (data: Record<string, unknown>) => AssignmentBriefModel.create(uni(data)),

	softDelete: (tenantId: string, id: string, lecturerId: string) =>
		AssignmentBriefModel.findOneAndUpdate(
			{
				_id: id,
				universityId: tenantId,
				lecturerId,
				deletedAt: { $exists: false },
			},
			{ deletedAt: new Date() },
			{ new: true },
		),
};
