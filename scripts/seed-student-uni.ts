/**
 * Seed one research project + one assignment for student@uni.com
 * (Maxwell Johnson, Delta State University / Mechanical Engineering).
 *
 * Supervisor: okeke@trustledai.com
 *
 *   bash scripts/with-node.sh npx tsx scripts/seed-student-uni.ts
 */
import { config } from "dotenv";
import { resolve } from "node:path";
import type { Types } from "mongoose";

import { connectMongo, disconnectMongo } from "../src/db/connect.js";
import { getBackendRoot, getRepoRoot } from "../src/lib/paths.js";
import {
	ChapterStatus,
	ContentType,
	ProjectStage,
	ProjectStatus,
} from "../src/lib/portal-enums.js";
import { UserModel } from "../src/db/models/User.js";
import { AssignmentBriefModel } from "../src/db/models/AssignmentBrief.js";
import { PortalProjectModel } from "../src/db/models/PortalProject.js";
import { PortalChapterModel } from "../src/db/models/PortalChapter.js";
import { PortalChapterVersionModel } from "../src/db/models/PortalChapterVersion.js";
import { PortalNotificationModel } from "../src/db/models/PortalNotification.js";

const STUDENT_EMAIL = "student@uni.com";
const LECTURER_EMAIL = "okeke@trustledai.com";
const SEED = "student-uni-v1";
const SEED_MARK = `<!--seed:${SEED}-->`;
const MAT_NO = "MEE/2022/0148";

const CHAPTER_TITLES = [
	"Abstract",
	"Introduction",
	"Literature Review",
	"Methodology",
	"Results",
	"Discussion & Conclusion",
	"References",
] as const;

const dotenvOpts = { quiet: true } as const;
config({ path: resolve(getBackendRoot(), ".env"), ...dotenvOpts });
config({ path: resolve(process.cwd(), ".env"), ...dotenvOpts });
config({ path: resolve(getRepoRoot(), ".env"), ...dotenvOpts });

function daysFromNow(days: number) {
	const date = new Date();
	date.setDate(date.getDate() + days);
	date.setHours(17, 0, 0, 0);
	return date;
}

function daysAgo(days: number) {
	const date = new Date();
	date.setDate(date.getDate() - days);
	return date;
}

function countWords(html: string) {
	return String(html || "")
		.replace(/<[^>]+>/g, " ")
		.replace(/&nbsp;/gi, " ")
		.trim()
		.split(/\s+/)
		.filter(Boolean).length;
}

function p(text: string) {
	return `<p>${text}</p>`;
}

async function main() {
	await connectMongo();

	const student = await UserModel.findOne({
		email: STUDENT_EMAIL.toLowerCase(),
	});
	if (!student) {
		throw new Error(`Student not found: ${STUDENT_EMAIL}`);
	}
	if (!student.universityId) {
		throw new Error(`${STUDENT_EMAIL} has no universityId`);
	}

	const lecturer = await UserModel.findOne({
		email: LECTURER_EMAIL.toLowerCase(),
	});
	if (!lecturer) {
		throw new Error(`Lecturer not found: ${LECTURER_EMAIL}`);
	}
	if (
		String(lecturer.universityId) !== String(student.universityId)
	) {
		throw new Error(
			`Lecturer ${LECTURER_EMAIL} is not in the same university as ${STUDENT_EMAIL}`,
		);
	}

	const universityId = student.universityId as Types.ObjectId;

	const priorProjects = await PortalProjectModel.find({
		studentId: student._id,
		"metadata.seed": SEED,
	}).select("_id");
	const priorIds = priorProjects.map((row) => row._id);
	if (priorIds.length > 0) {
		await PortalChapterVersionModel.deleteMany({
			projectId: { $in: priorIds },
		});
		await PortalChapterModel.deleteMany({ projectId: { $in: priorIds } });
		await PortalProjectModel.deleteMany({ _id: { $in: priorIds } });
	}
	await AssignmentBriefModel.deleteMany({
		universityId,
		lecturerId: lecturer._id,
		instructions: { $regex: SEED },
	});
	await PortalNotificationModel.deleteMany({
		universityId,
		"data.seed": SEED,
	});

	const brief = await AssignmentBriefModel.create({
		universityId,
		lecturerId: lecturer._id,
		title: "MEE 312 — Critical review of renewable energy storage",
		instructions: `${SEED_MARK}
<p>Write a critical review of energy storage options for small-campus microgrids in southern Nigeria. Your paper should:</p>
<ul>
<li>Define the problem space for intermittent solar supply on university campuses.</li>
<li>Compare at least three storage approaches (battery chemistries, pumped storage where feasible, and hybrid flywheel/battery).</li>
<li>Take a clear position for Mechanical Engineering undergraduates and defend it with cited evidence.</li>
</ul>
<p>Use APA citation style. Do not submit uncited claims.</p>`,
		requiredItems: [
			"Title and abstract (150–200 words)",
			"Literature synthesis (minimum 8 sources)",
			"Critical argument and limitations",
			"Reference list",
		],
		wordCountMin: 1500,
		wordCountMax: 2500,
		maxScore: 100,
		rubric: [
			{ name: "Argument and structure", maxMarks: 30 },
			{ name: "Use of literature", maxMarks: 30 },
			{ name: "Critical analysis", maxMarks: 25 },
			{ name: "Presentation and citations", maxMarks: 15 },
		],
		dueAt: daysFromNow(14),
		allowLateSubmission: true,
		courseName: "MEE 312 — Energy Systems",
		courseYear: "Year 3",
		status: "published",
	});

	const assignmentHtml = [
		"<h1>Battery-first storage for DELSU campus microgrids</h1>",
		p(
			"This paper argues that lithium-iron-phosphate (LFP) battery banks remain the most practical primary storage for small Delta State University solar installs, provided thermal management and cycle-life monitoring are designed into the Mechanical Engineering brief.",
		),
		"<h2>Literature</h2>",
		p(
			"Lead-acid remains cheap but degrades under partial-state-of-charge cycling common on intermittent campus loads. Pumped hydro is rarely feasible on flat campus land. Hybrid flywheel buffers help with short spikes but do not replace overnight capacity.",
		),
		"<h2>Position</h2>",
		p(
			"A battery-first architecture with a small flywheel buffer for lecture-theatre HVAC peaks is more honest for this setting than waiting for pumped storage that the site cannot host. Limitations include limited public post-mortems from Nigerian university estates.",
		),
		"<h2>References</h2>",
		"<p>Dunn, B., Kamath, H. and Tarascon, J.-M. (2011). Electrical energy storage for the grid. <em>Science</em>, 334(6058), 928–935.</p>",
	].join("");

	const assignmentProject = await PortalProjectModel.create({
		universityId,
		studentId: student._id,
		supervisorId: lecturer._id,
		projectType: "assignment",
		title: brief.title,
		topic: brief.title,
		studentMatNo: MAT_NO,
		courseYear: "Year 3",
		courseName: brief.courseName,
		assignmentBriefId: brief._id,
		status: ProjectStatus.Active,
		stage: ProjectStage.Proposal,
		topicStatus: "approved",
		progressPercent: 35,
		pages: [
			{
				title: "Assignment",
				order: 0,
				content: assignmentHtml,
				reviewStatus: "none",
			},
		],
		metadata: { seed: SEED },
	});

	const introHtml = [
		"<h1>Chapter 1 — Introduction</h1>",
		p(
			"This undergraduate project examines how low-cost solar-plus-storage systems can keep teaching laboratories online during grid outages at Delta State University.",
		),
		"<h2>Problem</h2>",
		p(
			"Mechanical Engineering labs lose machine time when public supply fails mid-practical. Existing generator schedules burn fuel and still leave sensitive instruments unprotected during changeover.",
		),
		"<h2>Aim</h2>",
		p(
			"The aim is to design and evaluate a small hybrid PV–battery–flywheel buffer sized for one teaching laboratory bay, with a supervision-friendly measurement plan for voltage stability and downtime minutes.",
		),
	].join("");

	const litHtml = p(
		"Prior campus microgrid studies emphasise economics and policy. Fewer Nigerian undergraduate projects publish measured ride-through data for teaching labs under partial cloud cover.",
	);

	const methodHtml = p(
		"A mixed method will combine a short estate survey of outage patterns with a laboratory prototype instrumented for bus voltage, state of charge, and changeover latency. Participation of lab technicians is voluntary.",
	);

	const pages = CHAPTER_TITLES.map((title, order) => {
		if (order === 0) {
			return {
				title,
				order,
				content: p(
					"This project proposes a scaled hybrid storage buffer so Mechanical Engineering teaching labs at DELSU can ride through short grid outages without full generator dependence.",
				),
				reviewStatus: "approved" as const,
			};
		}
		if (order === 1) {
			return {
				title,
				order,
				content: introHtml,
				reviewStatus: "approved" as const,
			};
		}
		if (order === 2) {
			return {
				title,
				order,
				content: litHtml,
				reviewStatus: "none" as const,
			};
		}
		if (order === 3) {
			return {
				title,
				order,
				content: methodHtml,
				reviewStatus: "none" as const,
			};
		}
		return { title, order, content: "", reviewStatus: "none" as const };
	});

	const researchProject = await PortalProjectModel.create({
		universityId,
		studentId: student._id,
		supervisorId: lecturer._id,
		projectType: "project",
		title: "Hybrid PV–battery buffer for Mechanical Engineering teaching labs",
		topic:
			"Can a small hybrid storage buffer reduce lab downtime during grid outages at DELSU?",
		abstract:
			"The project designs and measures a laboratory-scale solar-plus-storage buffer for Mechanical Engineering practicals, focusing on voltage stability and downtime minutes rather than full campus electrification.",
		studentMatNo: MAT_NO,
		courseYear: "Year 4",
		courseName: "MEE 499 — Final Year Project",
		status: ProjectStatus.Active,
		stage: ProjectStage.Chapter3,
		topicStatus: "approved",
		progressPercent: 40,
		pages,
		metadata: { seed: SEED },
	});

	for (const [index, title] of CHAPTER_TITLES.slice(0, 2).entries()) {
		const html =
			index === 0
				? pages[0].content
				: introHtml;
		const chapter = await PortalChapterModel.create({
			universityId,
			projectId: researchProject._id,
			number: index + 1,
			title,
			content: html,
			status: ChapterStatus.Approved,
			locked: true,
			approvedAt: daysAgo(5 - index),
		});
		const version = await PortalChapterVersionModel.create({
			universityId,
			chapterId: chapter._id,
			projectId: researchProject._id,
			versionNumber: 1,
			contentType: ContentType.Richtext,
			richTextJson: { html },
			submittedBy: student._id,
			submittedAt: daysAgo(7 - index),
			wordCount: countWords(html),
		});
		chapter.currentVersionId = version._id;
		await chapter.save();
	}

	const litChapter = await PortalChapterModel.create({
		universityId,
		projectId: researchProject._id,
		number: 3,
		title: "Literature Review",
		content: litHtml,
		status: ChapterStatus.Submitted,
		locked: true,
	});
	const litVersion = await PortalChapterVersionModel.create({
		universityId,
		chapterId: litChapter._id,
		projectId: researchProject._id,
		versionNumber: 1,
		contentType: ContentType.Richtext,
		richTextJson: { html: litHtml },
		submittedBy: student._id,
		submittedAt: daysAgo(1),
		wordCount: countWords(litHtml),
	});
	litChapter.currentVersionId = litVersion._id;
	await litChapter.save();

	await PortalNotificationModel.insertMany([
		{
			universityId,
			userId: lecturer._id,
			type: "project.assigned",
			title: "New supervisee project",
			body: `${student.name} assigned you as supervisor for “${researchProject.title}”.`,
			data: {
				seed: SEED,
				projectId: String(researchProject._id),
			},
		},
		{
			universityId,
			userId: lecturer._id,
			type: "chapter.submitted",
			title: "Chapter submitted for review",
			body: `${student.name} submitted Chapter 3 (Literature Review) on “${researchProject.title}”.`,
			data: {
				seed: SEED,
				projectId: String(researchProject._id),
				chapterId: String(litChapter._id),
			},
		},
		{
			universityId,
			userId: student._id,
			type: "project.assigned",
			title: "You are assigned to a supervisor",
			body: `${lecturer.name} is your supervisor for final-year project writing.`,
			data: {
				seed: SEED,
				projectId: String(researchProject._id),
			},
		},
		{
			universityId,
			userId: student._id,
			type: "assignment.published",
			title: "New assignment published",
			body: `${brief.title} is due soon. Open it from Assignments.`,
			data: {
				seed: SEED,
				projectId: String(assignmentProject._id),
				assignmentBriefId: String(brief._id),
			},
		},
	]);

	console.log("Seeded student@uni.com portal data");
	console.log(`  student:   ${student.email}  (${student.name})`);
	console.log(`  lecturer:  ${lecturer.email}  (${lecturer.name})`);
	console.log(`  university:${student.institution}`);
	console.log(`  project:   ${researchProject.title}`);
	console.log(`  assignment:${brief.title}`);
	console.log("  pages:     /student/projects  /student/assignments");
}

main()
	.catch((error) => {
		console.error(error instanceof Error ? error.message : error);
		process.exitCode = 1;
	})
	.finally(async () => {
		await disconnectMongo().catch(() => undefined);
	});
