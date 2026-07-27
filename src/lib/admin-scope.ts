import { Types, type Model } from "mongoose";

import { UserModel } from "../db/models/User.js";
import type { AdminScope } from "./require-admin.js";
import { universityFilterForScope } from "./require-admin.js";

// Mongoose InferSchemaType models are not assignable to index-signature generics;
// accept any Model for these helpers.
// eslint-disable-next-line @typescript-eslint/no-explicit-any
type AnyModel = Model<any>;

export function scopeFilter(scope?: AdminScope): Record<string, unknown> {
	return universityFilterForScope(scope ?? { kind: "platform", actorId: "", role: "admin" });
}

export async function resolveUniversityIdForWrite(
	scope?: AdminScope,
	actorId?: string,
	explicitUniversityId?: string | null,
): Promise<string | undefined> {
	if (scope?.kind === "university") return scope.universityId;

	const explicit = explicitUniversityId?.trim();
	if (explicit) return explicit;

	if (actorId) {
		const actor = await UserModel.findById(actorId).select("universityId").lean();
		return actor?.universityId?.toString();
	}

	return undefined;
}

export function universityObjectId(universityId: string | undefined) {
	return universityId ? new Types.ObjectId(universityId) : undefined;
}

export async function assertDocInScope(
	model: AnyModel,
	id: string,
	scope?: AdminScope,
	// Callers cast or narrow as needed — AnyModel erases schema generics.
	// eslint-disable-next-line @typescript-eslint/no-explicit-any
): Promise<(Record<string, any> & { _id: Types.ObjectId }) | null> {
	if (!scope || scope.kind === "platform") {
		return model.findById(id).lean() as Promise<
			(Record<string, any> & { _id: Types.ObjectId }) | null
		>;
	}
	return model
		.findOne({
			_id: id,
			universityId: new Types.ObjectId(scope.universityId),
		})
		.lean() as Promise<(Record<string, any> & { _id: Types.ObjectId }) | null>;
}

/** Backfill universityId from createdBy / ownerId / reported actor user. */
export async function backfillUniversityIdFromUserRef(
	model: AnyModel,
	userField: "createdBy" | "ownerId" | "requesterId" | "generatedBy",
) {
	const missing = await model
		.find({
			$or: [{ universityId: { $exists: false } }, { universityId: null }],
			[userField]: { $exists: true, $ne: null },
		})
		.select(`_id ${userField}`)
		.lean();

	if (missing.length === 0) return;

	const userIds = [
		...new Set(
			missing
				.map((row: Record<string, unknown>) => {
					const ref = row[userField] as Types.ObjectId | string | null | undefined;
					return ref?.toString();
				})
				.filter((id: string | undefined): id is string => Boolean(id)),
		),
	];

	const users = await UserModel.find({ _id: { $in: userIds } })
		.select("_id universityId")
		.lean();
	const map = new Map(
		users
			.filter((u) => u.universityId)
			.map((u) => [u._id.toString(), u.universityId!.toString()] as const),
	);

	await Promise.all(
		missing.map(async (row) => {
			const ref = (row as Record<string, unknown>)[userField] as
				| Types.ObjectId
				| string
				| null
				| undefined;
			const key = ref?.toString();
			if (!key) return;
			const universityId = map.get(key);
			if (!universityId) return;
			await model.updateOne(
				{ _id: (row as { _id: Types.ObjectId })._id },
				{ $set: { universityId: new Types.ObjectId(universityId) } },
			);
		}),
	);
}
