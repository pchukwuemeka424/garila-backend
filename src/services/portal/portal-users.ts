import { Types } from "mongoose";

import { UniversityModel } from "../../db/models/University.js";
import { UserModel } from "../../db/models/User.js";

const SUPERVISOR_ROLES = ["lecturer", "researcher", "admin"];

function isOid(id: string) {
	return /^[a-f\d]{24}$/i.test(id);
}

function oid(id: string) {
	return new Types.ObjectId(id);
}

function sameUniversity(user: { universityId?: unknown }, universityId: string) {
	return Boolean(user.universityId) && String(user.universityId) === universityId;
}

export const userRepository = {
	async findById(_tenantId: string, id: string) {
		if (!isOid(id)) return null;
		return UserModel.findById(id).select("name email role universityId").lean();
	},

	async findByIds(_tenantId: string, ids: string[]) {
		const objectIds = ids.filter((id) => isOid(id)).map(oid);
		if (objectIds.length === 0) return [];
		return UserModel.find({ _id: { $in: objectIds } })
			.select("name email role universityId")
			.lean();
	},

	async getUniversity(universityId: string | null | undefined) {
		if (!universityId || !isOid(universityId)) return null;
		return UniversityModel.findById(universityId).select("name slug country").lean();
	},

	/** Lecturers/researchers registered to this university only. */
	async listSupervisors(universityId: string | null | undefined) {
		if (!universityId || !isOid(universityId)) return [];
		return UserModel.find({
			role: { $in: SUPERVISOR_ROLES },
			status: "active",
			universityId: oid(universityId),
		})
			.select("name email role universityId")
			.sort({ name: 1 })
			.lean();
	},

	async findSupervisorInUniversity(
		universityId: string | null | undefined,
		id: string,
	) {
		if (!universityId || !isOid(universityId) || !isOid(id)) return null;
		const user = await UserModel.findOne({
			_id: oid(id),
			role: { $in: SUPERVISOR_ROLES },
			status: "active",
			universityId: oid(universityId),
		})
			.select("name email role universityId")
			.lean();
		if (!user || !sameUniversity(user, universityId)) return null;
		return user;
	},
};
