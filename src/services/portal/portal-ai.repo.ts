import { PortalAiReviewModel } from "../../db/models/PortalAiReview.js";

function uni(data: Record<string, unknown>) {
	const { tenantId, ...rest } = data;
	return { ...rest, universityId: tenantId };
}

export const aiReviewRepository = {
	findByVersion: (tenantId: string, versionId: string) =>
		PortalAiReviewModel.findOne({ universityId: tenantId, versionId }),
	findById: (tenantId: string, id: string) =>
		PortalAiReviewModel.findOne({ _id: id, universityId: tenantId }),
	create: (data: Record<string, unknown>) => PortalAiReviewModel.create(uni(data)),
	listByProject: (tenantId: string, projectId: string) =>
		PortalAiReviewModel.find({ universityId: tenantId, projectId }).sort({
			createdAt: -1,
		}),
	listByProjects: (tenantId: string, projectIds: string[]) =>
		PortalAiReviewModel.find({
			universityId: tenantId,
			projectId: { $in: projectIds },
		}).sort({ createdAt: -1 }),
};
