/**
 * One-time cleanup of previously seeded mock governance rows so /admin
 * reflects only live institutional data.
 */
import { AiSystemInventoryModel } from "../db/models/AiSystemInventory.js";
import { ComplianceControlModel } from "../db/models/ComplianceControl.js";
import { GovernancePolicyModel } from "../db/models/GovernancePolicy.js";
import { GovernanceRiskModel } from "../db/models/GovernanceRisk.js";
import { SEEDED_COMPLIANCE_CODES } from "./admin-compliance.service.js";

const MOCK_RISK_TITLES = [
	"Sensitive personal data in AI prompts",
	"Ungoverned third-party AI tools",
	"Academic integrity erosion in research drafting",
];

const MOCK_POLICY_NAMES = [
	"Research ideas — staff permitted",
	"Research ideas — student restricted",
	"Paper generation — permitted",
	"Personal / health data — blocked",
	"External model tools — approval required",
	"Dataset ingest — restricted",
];

const MOCK_SYSTEM_NAMES = [
	"Research paper drafting (OpenRouter)",
	"Research ideas generator",
	"Literature search (AlphaXiv / arXiv / Tavily)",
	"Research Note AI drafting",
];

/** Remove seeded demo rows that were never owned/updated by an admin actor. */
export async function cleanupSeededGovernanceMocks(): Promise<void> {
	await Promise.all([
		GovernanceRiskModel.deleteMany({
			title: { $in: MOCK_RISK_TITLES },
			createdBy: { $exists: false },
			updatedBy: { $exists: false },
		}),
		GovernancePolicyModel.deleteMany({
			name: { $in: MOCK_POLICY_NAMES },
			createdBy: { $exists: false },
			updatedBy: { $exists: false },
		}),
		AiSystemInventoryModel.deleteMany({
			name: { $in: MOCK_SYSTEM_NAMES },
			createdBy: { $exists: false },
			updatedBy: { $exists: false },
			notes: { $not: /^Synced from/ },
		}),
		ComplianceControlModel.deleteMany({
			code: { $in: [...SEEDED_COMPLIANCE_CODES] },
		}),
	]);
}
