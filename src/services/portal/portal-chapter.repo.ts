import { PortalChapterModel } from "../../db/models/PortalChapter.js";
import { PortalChapterVersionModel } from "../../db/models/PortalChapterVersion.js";

function uni(data: Record<string, unknown>) {
	const { tenantId, ...rest } = data;
	return { ...rest, universityId: tenantId };
}

export const chapterRepository = {
	findById: (tenantId: string, id: string) =>
		PortalChapterModel.findOne({
			_id: id,
			universityId: tenantId,
			deletedAt: { $exists: false },
		}),

	findByNumber: (tenantId: string, projectId: string, number: number) =>
		PortalChapterModel.findOne({
			universityId: tenantId,
			projectId,
			number,
			deletedAt: { $exists: false },
		}),

	listByProject: (tenantId: string, projectId: string) =>
		PortalChapterModel.find({
			universityId: tenantId,
			projectId,
			deletedAt: { $exists: false },
		}).sort({ number: 1 }),

	listPendingByProjectIds: (tenantId: string, projectIds: string[], statuses: string[]) => {
		if (projectIds.length === 0) return Promise.resolve([]);
		return PortalChapterModel.find({
			universityId: tenantId,
			projectId: { $in: projectIds },
			status: { $in: statuses },
			deletedAt: { $exists: false },
		}).sort({ updatedAt: -1 });
	},

	create: (data: Record<string, unknown>) => PortalChapterModel.create(uni(data)),

	createVersion: (data: Record<string, unknown>) =>
		PortalChapterVersionModel.create(uni(data)),

	lastVersion: (tenantId: string, chapterId: string) =>
		PortalChapterVersionModel.findOne({
			universityId: tenantId,
			chapterId,
			deletedAt: { $exists: false },
		}).sort({ versionNumber: -1 }),

	findVersion: (tenantId: string, id: string) =>
		PortalChapterVersionModel.findOne({
			_id: id,
			universityId: tenantId,
			deletedAt: { $exists: false },
		}),

	listVersions: (tenantId: string, chapterId: string) =>
		PortalChapterVersionModel.find({
			universityId: tenantId,
			chapterId,
			deletedAt: { $exists: false },
		}).sort({ versionNumber: -1 }),
};
