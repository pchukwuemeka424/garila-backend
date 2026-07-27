import { Schema, model, type InferSchemaType, type Types } from "mongoose";

export const ALL_ROLES = [
	"lecturer",
	"admin",
	"viewer",
	"researcher",
	"student",
	"governance_admin",
	"faculty_admin",
	"department_admin",
	"compliance_officer",
	"data_protection_officer",
	"research_integrity_officer",
	"auditor",
] as const;

export type UserRole = (typeof ALL_ROLES)[number];

export const GOVERNANCE_FEATURES = [
	"dashboard",
	"analytics",
	"audit",
	"alerts",
	"users",
	"incidents",
	"reports",
	"tokens",
	"contributions",
	"provenance",
	"privacy",
	"retention",
	"policies",
	"risks",
	"compliance",
	"inventory",
	"approvals",
	"governance_hub",
	"sessions",
	"backup",
] as const;

export type GovernanceFeature = (typeof GOVERNANCE_FEATURES)[number];

export const FEATURE_ACTIONS = ["view", "create", "edit", "delete", "export"] as const;
export type FeatureAction = (typeof FEATURE_ACTIONS)[number];

const userSchema = new Schema(
	{
		name: { type: String, required: true, trim: true },
		email: { type: String, required: true, unique: true, trim: true, lowercase: true },
		passwordHash: { type: String, select: false },
		department: { type: String, trim: true },
		institution: { type: String, trim: true },
		universityId: { type: Schema.Types.ObjectId, ref: "University", index: true },
		faculty: { type: String, trim: true },
		programme: { type: String, trim: true },
		cohort: { type: String, trim: true },
		role: {
			type: String,
			enum: ALL_ROLES,
			default: "lecturer",
		},
		status: { type: String, enum: ["active", "inactive", "suspended"], default: "active" },
		lastActiveAt: { type: Date },
		tokensUsed: { type: Number, default: 0, min: 0 },
		permissions: {
			type: Map,
			of: [String],
			default: undefined,
		},
		tokenQuota: {
			allowance: { type: Number, default: 50000 },
			used: { type: Number, default: 0 },
			resetAt: { type: Date },
		},
		invitedBy: { type: Schema.Types.ObjectId, ref: "User" },
		invitedAt: { type: Date },
		suspensionReason: { type: String, trim: true },
		complianceFlags: [{ type: String, trim: true }],
	},
	{ timestamps: true },
);

export type UserDocument = InferSchemaType<typeof userSchema> & { _id: Types.ObjectId };

export const UserModel = model("User", userSchema);

export const DEFAULT_ROLE_PERMISSIONS: Record<string, Record<string, FeatureAction[]>> = {
	admin: Object.fromEntries(GOVERNANCE_FEATURES.map((f) => [f, [...FEATURE_ACTIONS]])),
	governance_admin: Object.fromEntries(GOVERNANCE_FEATURES.map((f) => [f, [...FEATURE_ACTIONS]])),
	compliance_officer: {
		dashboard: ["view"],
		analytics: ["view", "export"],
		audit: ["view", "export"],
		alerts: ["view"],
		incidents: ["view"],
		reports: ["view", "create", "export"],
		risks: ["view", "create", "edit", "export"],
		compliance: ["view", "create", "edit", "delete", "export"],
		inventory: ["view", "export"],
		policies: ["view"],
		contributions: ["view"],
		provenance: ["view"],
		privacy: ["view"],
		retention: ["view"],
		governance_hub: ["view"],
	},
	faculty_admin: {
		dashboard: ["view"],
		analytics: ["view", "export"],
		audit: ["view"],
		alerts: ["view"],
		users: ["view", "create", "edit"],
		incidents: ["view", "create"],
		reports: ["view"],
		tokens: ["view", "edit"],
		contributions: ["view"],
		provenance: ["view"],
		governance_hub: ["view"],
	},
	department_admin: {
		dashboard: ["view"],
		analytics: ["view"],
		users: ["view", "edit"],
		tokens: ["view"],
		contributions: ["view"],
		governance_hub: ["view"],
	},
	data_protection_officer: {
		dashboard: ["view"],
		privacy: ["view", "create", "edit", "delete", "export"],
		retention: ["view", "create", "edit", "delete", "export"],
		audit: ["view", "export"],
		compliance: ["view"],
		governance_hub: ["view"],
	},
	research_integrity_officer: {
		dashboard: ["view"],
		contributions: ["view", "edit", "export"],
		provenance: ["view", "edit", "export"],
		incidents: ["view", "create", "edit"],
		audit: ["view"],
		governance_hub: ["view"],
	},
	auditor: {
		dashboard: ["view"],
		analytics: ["view", "export"],
		audit: ["view", "export"],
		alerts: ["view"],
		incidents: ["view"],
		reports: ["view", "export"],
		tokens: ["view"],
		contributions: ["view"],
		provenance: ["view"],
		privacy: ["view"],
		retention: ["view"],
		policies: ["view"],
		risks: ["view"],
		compliance: ["view"],
		inventory: ["view"],
		approvals: ["view"],
		governance_hub: ["view"],
	},
};
