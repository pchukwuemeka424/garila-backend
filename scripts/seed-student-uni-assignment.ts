/**
 * Seed published assignment briefs from Okeke for student@uni.com.
 *
 *   bash scripts/with-node.sh npx tsx scripts/seed-student-uni-assignment.ts
 */
import { config } from "dotenv";
import { resolve } from "node:path";
import type { Types } from "mongoose";

import { connectMongo, disconnectMongo } from "../src/db/connect.js";
import { getBackendRoot, getRepoRoot } from "../src/lib/paths.js";
import { ProjectStage, ProjectStatus } from "../src/lib/portal-enums.js";
import { UserModel } from "../src/db/models/User.js";
import { AssignmentBriefModel } from "../src/db/models/AssignmentBrief.js";
import { PortalProjectModel } from "../src/db/models/PortalProject.js";
import { PortalNotificationModel } from "../src/db/models/PortalNotification.js";

const STUDENT_EMAIL = "student@uni.com";
const LECTURER_EMAIL = "okeke@trustledai.com";
const SEED = "student-uni-assignment-v1";
const SEED_MARK = `<!--seed:${SEED}-->`;
const MAT_NO = "MEE/2022/0148";

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

function p(text: string) {
	return `<p>${text}</p>`;
}

async function main() {
	await connectMongo();

	const student = await UserModel.findOne({
		email: STUDENT_EMAIL.toLowerCase(),
	});
	if (!student) throw new Error(`Student not found: ${STUDENT_EMAIL}`);
	if (!student.universityId) {
		throw new Error(`${STUDENT_EMAIL} has no universityId`);
	}

	const lecturer = await UserModel.findOne({
		email: LECTURER_EMAIL.toLowerCase(),
	});
	if (!lecturer) throw new Error(`Lecturer not found: ${LECTURER_EMAIL}`);
	if (String(lecturer.universityId) !== String(student.universityId)) {
		throw new Error(
			`Lecturer ${LECTURER_EMAIL} is not in the same university as ${STUDENT_EMAIL}`,
		);
	}

	const universityId = student.universityId as Types.ObjectId;

	// Remove prior assignment-only seeds (keep research projects).
	const priorAssignments = await PortalProjectModel.find({
		studentId: student._id,
		projectType: "assignment",
		"metadata.seed": { $in: [SEED, "student-uni-v1"] },
	}).select("_id");
	const priorIds = priorAssignments.map((row) => row._id);
	if (priorIds.length > 0) {
		await PortalProjectModel.deleteMany({ _id: { $in: priorIds } });
	}
	await AssignmentBriefModel.deleteMany({
		universityId,
		lecturerId: lecturer._id,
		instructions: { $regex: /(student-uni-assignment-v1|student-uni-v1)/ },
	});
	await PortalNotificationModel.deleteMany({
		universityId,
		"data.seed": SEED,
	});

	const energyBrief = await AssignmentBriefModel.create({
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

	const thermoBrief = await AssignmentBriefModel.create({
		universityId,
		lecturerId: lecturer._id,
		title: "MEE 221 — Thermodynamics lab report",
		instructions: `${SEED_MARK}
<p>Produce a laboratory report on the vapour-compression refrigeration cycle experiment.</p>
<p>Cover apparatus, procedure, results tables, discussion of COP, and sources of experimental error. Keep the report suitable for Year 2 Mechanical Engineering.</p>`,
		requiredItems: [
			"Aim and objectives",
			"Apparatus and procedure",
			"Results and calculations",
			"Discussion and conclusions",
		],
		wordCountMin: 1200,
		wordCountMax: 2000,
		maxScore: 50,
		rubric: [
			{ name: "Method and clarity", maxMarks: 15 },
			{ name: "Data and calculations", maxMarks: 20 },
			{ name: "Discussion and presentation", maxMarks: 15 },
		],
		dueAt: daysFromNow(21),
		allowLateSubmission: false,
		courseName: "MEE 221 — Engineering Thermodynamics",
		courseYear: "Year 2",
		status: "published",
	});

	const energyHtml = [
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

	const energyAssignment = await PortalProjectModel.create({
		universityId,
		studentId: student._id,
		supervisorId: lecturer._id,
		projectType: "assignment",
		title: energyBrief.title,
		topic: energyBrief.title,
		studentMatNo: MAT_NO,
		courseYear: "Year 3",
		courseName: energyBrief.courseName,
		assignmentBriefId: energyBrief._id,
		status: ProjectStatus.Active,
		stage: ProjectStage.Proposal,
		topicStatus: "approved",
		progressPercent: 40,
		pages: [
			{
				title: "Assignment",
				order: 0,
				content: energyHtml,
				reviewStatus: "none",
			},
		],
		metadata: { seed: SEED },
	});

	const thermoAssignment = await PortalProjectModel.create({
		universityId,
		studentId: student._id,
		supervisorId: lecturer._id,
		projectType: "assignment",
		title: thermoBrief.title,
		topic: thermoBrief.title,
		studentMatNo: MAT_NO,
		courseYear: "Year 2",
		courseName: thermoBrief.courseName,
		assignmentBriefId: thermoBrief._id,
		status: ProjectStatus.Active,
		stage: ProjectStage.Topic,
		topicStatus: "draft",
		progressPercent: 0,
		pages: [
			{
				title: "Assignment",
				order: 0,
				content: "",
				reviewStatus: "none",
			},
		],
		metadata: { seed: SEED },
	});

	await PortalNotificationModel.insertMany([
		{
			universityId,
			userId: student._id,
			type: "assignment.published",
			title: "New assignment published",
			body: `${energyBrief.title} is due soon. Open it from Assignments.`,
			data: {
				seed: SEED,
				projectId: String(energyAssignment._id),
				assignmentBriefId: String(energyBrief._id),
			},
		},
		{
			universityId,
			userId: student._id,
			type: "assignment.published",
			title: "New assignment published",
			body: `${thermoBrief.title} has been published by ${lecturer.name}.`,
			data: {
				seed: SEED,
				projectId: String(thermoAssignment._id),
				assignmentBriefId: String(thermoBrief._id),
			},
		},
		{
			universityId,
			userId: lecturer._id,
			type: "project.assigned",
			title: "Student started assignment",
			body: `${student.name} is working on “${energyBrief.title}”.`,
			data: {
				seed: SEED,
				projectId: String(energyAssignment._id),
				assignmentBriefId: String(energyBrief._id),
			},
		},
	]);

	console.log("Seeded Okeke → student@uni.com assignments");
	console.log(`  lecturer: ${lecturer.email}  (${lecturer.name})`);
	console.log(`  student:  ${student.email}  (${student.name})`);
	console.log(`  brief 1:  ${energyBrief.title}  [in progress]`);
	console.log(`  brief 2:  ${thermoBrief.title}  [not started]`);
	console.log("  pages:    /student/assignments  /supervision/assignments");
}

main()
	.catch((error) => {
		console.error(error instanceof Error ? error.message : error);
		process.exitCode = 1;
	})
	.finally(async () => {
		await disconnectMongo().catch(() => undefined);
	});
