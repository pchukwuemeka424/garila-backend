import { Schema, model, type InferSchemaType, type Types } from "mongoose";

/**
 * Append-only institutional audit log.
 * Updates and deletes are rejected at the schema middleware layer.
 */
const auditLogSchema = new Schema(
	{
		action: { type: String, required: true, trim: true, index: true },
		category: {
			type: String,
			enum: [
				"auth",
				"admin",
				"ai_use",
				"policy",
				"approval",
				"data",
				"security",
				"system",
				"report",
			],
			required: true,
			index: true,
		},
		actorId: { type: Schema.Types.ObjectId, ref: "User", index: true },
		actorEmail: { type: String, trim: true },
		actorName: { type: String, trim: true },
		actorRole: { type: String, trim: true },
		targetType: { type: String, trim: true },
		targetId: { type: String, trim: true },
		summary: { type: String, required: true, trim: true },
		details: { type: Schema.Types.Mixed },
		faculty: { type: String, trim: true, index: true },
		department: { type: String, trim: true },
		ip: { type: String, trim: true },
		userAgent: { type: String, trim: true },
		severity: {
			type: String,
			enum: ["info", "low", "medium", "high", "critical"],
			default: "info",
			index: true,
		},
		flagged: { type: Boolean, default: false, index: true },
		flagReason: { type: String, trim: true },
		alertSent: { type: Boolean, default: false },
		immutableHash: { type: String, trim: true },
		universityId: { type: Schema.Types.ObjectId, ref: "University", index: true },
	},
	{ timestamps: { createdAt: true, updatedAt: false } },
);

auditLogSchema.index({ createdAt: -1 });
auditLogSchema.index({ flagged: 1, severity: 1, createdAt: -1 });

function rejectMutation(this: unknown, next?: (err?: Error) => void) {
	const err = new Error("Audit logs are immutable and cannot be modified or deleted.");
	if (typeof next === "function") next(err);
	else throw err;
}

auditLogSchema.pre("updateOne", rejectMutation);
auditLogSchema.pre("updateMany", rejectMutation);
auditLogSchema.pre("findOneAndUpdate", rejectMutation);
auditLogSchema.pre("findOneAndDelete", rejectMutation);
auditLogSchema.pre("deleteOne", rejectMutation);
auditLogSchema.pre("deleteMany", rejectMutation);

export type AuditLogDocument = InferSchemaType<typeof auditLogSchema> & {
	_id: Types.ObjectId;
	createdAt: Date;
};

export const AuditLogModel = model("AuditLog", auditLogSchema);
