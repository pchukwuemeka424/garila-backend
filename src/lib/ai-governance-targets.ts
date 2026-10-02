/** Canonical AI policy targets — keep in sync with lib/ai-governance-targets.ts */
export const AI_POLICY_TARGETS = [
	{ value: "research_assistant", label: "Research Assistant (chat / papers)" },
	{ value: "research_ideas", label: "Research ideas generation" },
	{ value: "research_outline", label: "Research outline generation" },
	{ value: "research_generate", label: "Live paper generation" },
	{ value: "research_notebook", label: "Research Notebook AI" },
	{ value: "portal_ai_chat", label: "Project AI assist (student)" },
	{ value: "portal_page_summary", label: "Page AI summary (lecturer)" },
	{ value: "chapter_ai_reviewer", label: "Chapter AI reviewer" },
	{ value: "assignment_ai_assist", label: "Assignment AI assist" },
	{ value: "advanced_research", label: "Advanced research scopes" },
	{ value: "bulk_export", label: "Bulk export" },
	{ value: "sensitive_data", label: "Sensitive data handling" },
] as const;

export type AiPolicyTarget = (typeof AI_POLICY_TARGETS)[number]["value"];
