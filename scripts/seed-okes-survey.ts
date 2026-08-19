/**
 * Seed Research Notebook survey / questionnaire data for
 * info@okesinnovationltd.co.uk
 *
 *   bash scripts/with-node.sh npx tsx scripts/seed-okes-survey.ts
 */
import { config } from "dotenv";
import { resolve } from "node:path";
import { Types } from "mongoose";

import { connectMongo, disconnectMongo } from "../src/db/connect.js";
import { getBackendRoot, getRepoRoot } from "../src/lib/paths.js";
import { UserModel } from "../src/db/models/User.js";
import { ResearchProjectModel } from "../src/db/models/ResearchProject.js";
import { ResearchQuestionnaireModel } from "../src/db/models/ResearchQuestionnaire.js";
import { ResearchDatasetModel } from "../src/db/models/ResearchDataset.js";
import { buildEmptySections } from "../src/lib/research-project-types.js";
import type { QuestionnaireItem } from "../src/lib/research-questionnaire.js";
import { createDataset } from "../src/services/research-assets.service.js";

const LECTURER_EMAIL = "info@okesinnovationltd.co.uk";
const SEED = "okes-survey-v1";
const PROJECT_TITLE = "AI tools in undergraduate research writing";

const dotenvOpts = { quiet: true } as const;
config({ path: resolve(getBackendRoot(), ".env"), ...dotenvOpts });
config({ path: resolve(process.cwd(), ".env"), ...dotenvOpts });
config({ path: resolve(getRepoRoot(), ".env"), ...dotenvOpts });

const ITEMS: QuestionnaireItem[] = [
	{
		id: "q_level",
		prompt: "What is your current level of study?",
		kind: "multiple_choice",
		options: ["Year 2", "Year 3", "Year 4", "Postgraduate"],
		scaleMin: 1,
		scaleMax: 5,
		column: "study_level",
	},
	{
		id: "q_used_ai",
		prompt: "Have you used an AI writing or research assistant in the last semester?",
		kind: "yes_no",
		options: ["Yes", "No"],
		scaleMin: 1,
		scaleMax: 5,
		column: "used_ai",
	},
	{
		id: "q_freq",
		prompt: "How often do you use AI tools when writing coursework?",
		kind: "multiple_choice",
		options: ["Never", "Rarely", "Sometimes", "Often", "Almost always"],
		scaleMin: 1,
		scaleMax: 5,
		column: "ai_frequency",
	},
	{
		id: "q_help_lit",
		prompt: "AI tools help me find and summarise literature.",
		kind: "likert",
		options: [],
		scaleMin: 1,
		scaleMax: 5,
		column: "help_literature",
	},
	{
		id: "q_help_struct",
		prompt: "AI tools help me structure chapters and arguments.",
		kind: "likert",
		options: [],
		scaleMin: 1,
		scaleMax: 5,
		column: "help_structure",
	},
	{
		id: "q_cite",
		prompt: "I am confident that AI-suggested citations are accurate.",
		kind: "likert",
		options: [],
		scaleMin: 1,
		scaleMax: 5,
		column: "citation_confidence",
	},
	{
		id: "q_ethics",
		prompt: "My department has clear rules on acceptable AI use in assessed work.",
		kind: "yes_no",
		options: ["Yes", "No"],
		scaleMin: 1,
		scaleMax: 5,
		column: "ethics_policy",
	},
	{
		id: "q_hours",
		prompt: "About how many hours per week do you spend on research writing?",
		kind: "numeric",
		options: [],
		scaleMin: 0,
		scaleMax: 40,
		column: "hours_writing",
	},
	{
		id: "q_barrier",
		prompt: "What is the main barrier to using AI well in your research?",
		kind: "open",
		options: [],
		scaleMin: 1,
		scaleMax: 5,
		column: "main_barrier",
	},
];

const LEVELS = ["Year 2", "Year 3", "Year 4", "Postgraduate"] as const;
const FREQ = ["Never", "Rarely", "Sometimes", "Often", "Almost always"] as const;
const BARRIERS = [
	"Unclear university policy on disclosure",
	"Fear of being accused of plagiarism",
	"Poor internet access in the hostel",
	"Tools invent references I cannot verify",
	"No training on prompt design",
	"Supervisor discourages any AI use",
	"Cost of paid models",
	"Difficulty checking facts in my discipline",
];

function csvEscape(value: string): string {
	if (/[",\n]/.test(value)) return `"${value.replace(/"/g, '""')}"`;
	return value;
}

function buildResponses(count: number): string {
	const headers = ITEMS.map((item) => item.column);
	const lines = [headers.join(",")];
	for (let i = 0; i < count; i++) {
		const level = LEVELS[i % LEVELS.length];
		const used = i % 7 === 0 ? "No" : "Yes";
		const freq = used === "No" ? "Never" : FREQ[1 + (i % 4)];
		const lit = used === "No" ? 2 : 3 + (i % 3);
		const struct = used === "No" ? 2 : 2 + (i % 4);
		const cite = 1 + (i % 4);
		const ethics = i % 3 === 0 ? "Yes" : "No";
		const hours = 4 + ((i * 3) % 16);
		const barrier = BARRIERS[i % BARRIERS.length];
		const row = [
			level,
			used,
			freq,
			String(lit),
			String(struct),
			String(cite),
			ethics,
			String(hours),
			barrier,
		].map(csvEscape);
		lines.push(row.join(","));
	}
	return lines.join("\n");
}

async function main() {
	await connectMongo();

	const lecturer = await UserModel.findOne({ email: LECTURER_EMAIL.toLowerCase() });
	if (!lecturer) {
		throw new Error(`User not found: ${LECTURER_EMAIL}`);
	}

	const userId = lecturer._id.toString();

	let project = await ResearchProjectModel.findById("6a7edd13cf4c94d65472b164");
	if (!project || String(project.userId) !== userId) {
		project = await ResearchProjectModel.findOne({ userId: lecturer._id }).sort({ updatedAt: -1 });
	}
	if (!project) {
		project = await ResearchProjectModel.create({
			userId: lecturer._id,
			title: PROJECT_TITLE,
			description:
				"Pilot survey of undergraduate and postgraduate writers on AI-assisted literature search, chapter structure, and citation confidence.",
			projectType: "research",
			sections: buildEmptySections("research"),
			status: "in_progress",
			favorite: false,
			progress: 40,
			startedAt: new Date(),
		});
	}

	await ResearchQuestionnaireModel.deleteMany({
		userId: lecturer._id,
		projectId: project._id,
		$or: [{ description: { $regex: SEED } }, { title: "Untitled questionnaire" }],
	});
	const priorDatasets = await ResearchDatasetModel.find({
		userId: lecturer._id,
		projectId: project._id,
		tags: "questionnaire",
		format: "survey_responses",
		title: /responses$/i,
	});
	for (const ds of priorDatasets) {
		if (ds.description?.includes(SEED) || ds.tags?.includes(SEED)) {
			await ds.deleteOne();
		}
	}

	const csv = buildResponses(28);
	const fileData = `data:text/csv;base64,${Buffer.from(csv, "utf8").toString("base64")}`;
	const dataset = await createDataset(userId, {
		projectId: project._id.toString(),
		title: `${PROJECT_TITLE} responses`,
		description: `Collated questionnaire responses (28 rows). seed:${SEED}`,
		discipline: lecturer.department || "Education",
		format: "survey_responses",
		year: "2026",
		license: "",
		accessUrl: "",
		sizeLabel: "",
		tags: ["questionnaire", "survey", SEED],
		visibility: "private",
		fileName: "ai-research-writing-survey.csv",
		fileMime: "text/csv",
		fileData,
	});

	const created = await ResearchQuestionnaireModel.create({
		userId: lecturer._id,
		projectId: project._id,
		title: "Student survey: AI in research writing",
		description: `Distributed as a Google Form to writers in the faculty, then exported to CSV. seed:${SEED}`,
		population: "Undergraduate and postgraduate students in the faculty",
		sampleSize: 28,
		distributionNote: "Google Form shared via departmental WhatsApp groups",
		items: ITEMS,
		responseDatasetId: new Types.ObjectId(dataset.id),
		instrumentDocumentId: null,
		rowCount: 28,
		importedFileName: "ai-research-writing-survey.csv",
		columns: ITEMS.map((item) => item.column),
	});

	console.log("Seeded Research Notebook survey");
	console.log(`  user:     ${lecturer.email}  (${lecturer.name})`);
	console.log(`  project:  ${project.title}  (${project._id.toString()})`);
	console.log(`  survey:   ${created.title}  (${created._id.toString()})`);
	console.log(`  dataset:  ${dataset.id}  (${dataset.fileName})`);
	console.log(`  open:     /research/notebook/${project._id.toString()}  → Survey tab`);
}

main()
	.catch((error) => {
		console.error(error instanceof Error ? error.message : error);
		process.exitCode = 1;
	})
	.finally(async () => {
		await disconnectMongo().catch(() => undefined);
	});
