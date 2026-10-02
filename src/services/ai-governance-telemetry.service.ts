import { UserModel } from "../db/models/User.js";
import type { AiPolicyTarget } from "../lib/ai-governance-targets.js";
import { recordAuditEvent } from "./admin-audit.service.js";
import { createContributionStatement } from "./admin-contributions.service.js";
import { createProvenanceRecord } from "./admin-provenance.service.js";

export type AiGovernanceSurface =
	| "research_ideas"
	| "research_outline"
	| "research_generate"
	| "research_assistant"
	| "research_notebook"
	| "portal_ai_chat"
	| "portal_page_summary"
	| "chapter_ai_reviewer"
	| "assignment_ai_assist";

const SURFACE_TO_TARGET: Record<AiGovernanceSurface, AiPolicyTarget> = {
	research_ideas: "research_ideas",
	research_outline: "research_outline",
	research_generate: "research_generate",
	research_assistant: "research_assistant",
	research_notebook: "research_notebook",
	portal_ai_chat: "portal_ai_chat",
	portal_page_summary: "portal_page_summary",
	chapter_ai_reviewer: "chapter_ai_reviewer",
	assignment_ai_assist: "assignment_ai_assist",
};

const SURFACE_LABEL: Record<AiGovernanceSurface, string> = {
	research_ideas: "Research ideas generation",
	research_outline: "Research outline generation",
	research_generate: "Live paper generation",
	research_assistant: "Research Assistant",
	research_notebook: "Research Notebook",
	portal_ai_chat: "Project AI assist",
	portal_page_summary: "Page AI summary",
	chapter_ai_reviewer: "Chapter AI reviewer",
	assignment_ai_assist: "Assignment AI assist",
};

type RecordAiUseInput = {
	userId: string;
	surface: AiGovernanceSurface;
	summary: string;
	outputRef: string;
	outputTitle: string;
	/** When true, also write contribution + provenance (use for discrete AI outputs, not every chat turn). */
	recordIntegrity?: boolean;
	modelName?: string;
	details?: Record<string, unknown>;
	universityId?: string;
};

/**
 * Records an AI-use audit event (and optional integrity records) for governance.
 * Failures are swallowed so product flows are never blocked by telemetry.
 */
export async function recordAiGovernanceUse(input: RecordAiUseInput): Promise<void> {
	try {
		const user = await UserModel.findById(input.userId)
			.select("name email role faculty department programme universityId")
			.lean();
		if (!user) return;

		const universityId =
			input.universityId ?? (user.universityId ? user.universityId.toString() : undefined);
		const target = SURFACE_TO_TARGET[input.surface];
		const label = SURFACE_LABEL[input.surface];

		await recordAuditEvent({
			action: `ai.${input.surface}`,
			category: "ai_use",
			actorId: input.userId,
			summary: input.summary || `${label} used`,
			targetType: "ai_surface",
			targetId: input.outputRef,
			details: {
				surface: input.surface,
				policyTarget: target,
				outputTitle: input.outputTitle,
				modelName: input.modelName ?? null,
				...(input.details ?? {}),
			},
			faculty: user.faculty ?? undefined,
			department: user.department ?? undefined,
			severity: "info",
		});

		if (!input.recordIntegrity) return;

		const toolsUsed = [label];
		const modelNames = input.modelName ? [input.modelName] : [];

		await createContributionStatement(
			{
				outputRef: input.outputRef,
				outputTitle: input.outputTitle || label,
				outputType: input.surface.includes("research") ? "draft" : "other",
				ownerId: input.userId,
				ownerName: user.name ?? "",
				ownerEmail: user.email ?? "",
				faculty: user.faculty ?? undefined,
				department: user.department ?? undefined,
				programme: user.programme ?? undefined,
				universityId,
				contributionSummary: input.summary || `AI-assisted via ${label}`,
				toolsUsed,
				modelNames,
				aiAssisted: true,
				disclosureComplete: false,
			},
			input.userId,
		);

		await createProvenanceRecord(
			{
				outputRef: input.outputRef,
				outputTitle: input.outputTitle || label,
				outputType: input.surface.includes("research") ? "draft" : "other",
				ownerId: input.userId,
				ownerName: user.name ?? "",
				ownerEmail: user.email ?? "",
				faculty: user.faculty ?? undefined,
				department: user.department ?? undefined,
				universityId,
				events: [
					{
						at: new Date().toISOString(),
						action: input.surface,
						agentOrTool: label,
						model: input.modelName ?? "",
						summary: input.summary || `${label} completed`,
						humanEdited: false,
					},
				],
			},
			input.userId,
		);
	} catch {
		/* never block product AI on governance telemetry */
	}
}
