/**
 * Seed supervision + assignment demo data for
 * info@okesinnovationltd.co.uk and a student assigned to that lecturer.
 *
 *   bash scripts/with-node.sh npx tsx scripts/seed-okes-supervision.ts
 */
import { config } from "dotenv";
import { resolve } from "node:path";

import { connectMongo, disconnectMongo } from "../src/db/connect.js";
import { getBackendRoot, getRepoRoot } from "../src/lib/paths.js";
import { hashPassword } from "../src/lib/password.js";
import { ChapterStatus, ContentType, ProjectStage, ProjectStatus } from "../src/lib/portal-enums.js";
import { UserModel } from "../src/db/models/User.js";
import { AssignmentBriefModel } from "../src/db/models/AssignmentBrief.js";
import { PortalProjectModel } from "../src/db/models/PortalProject.js";
import { PortalChapterModel } from "../src/db/models/PortalChapter.js";
import { PortalChapterVersionModel } from "../src/db/models/PortalChapterVersion.js";
import { PortalNotificationModel } from "../src/db/models/PortalNotification.js";

const LECTURER_EMAIL = "info@okesinnovationltd.co.uk";
const STUDENT_EMAIL = "student@okesinnovationltd.co.uk";
const STUDENT_PASSWORD = process.env.SEED_STUDENT_PASSWORD?.trim() || "";
const SEED = "okes-supervision-v1";
const SEED_MARK = `<!--seed:${SEED}-->`;

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

	const lecturer = await UserModel.findOne({
		email: LECTURER_EMAIL.toLowerCase(),
	});
	if (!lecturer) {
		throw new Error(`Lecturer not found: ${LECTURER_EMAIL}`);
	}
	if (!lecturer.universityId) {
		throw new Error(`${LECTURER_EMAIL} has no universityId — cannot scope portal data.`);
	}

	const universityId = lecturer.universityId;
	let student = await UserModel.findOne({ email: STUDENT_EMAIL });
	let studentCreated = false;

	if (!student) {
		if (!STUDENT_PASSWORD) {
			throw new Error(
				"Set SEED_STUDENT_PASSWORD in the environment before creating the demo student.",
			);
		}
		student = await UserModel.create({
			name: "Ada Okafor",
			email: STUDENT_EMAIL,
			passwordHash: await hashPassword(STUDENT_PASSWORD),
			role: "student",
			status: "active",
			department: lecturer.department || "Computer Science",
			institution: lecturer.institution,
			universityId,
			programme: "BSc Computer Science",
			cohort: "2024/2025",
			lastActiveAt: new Date(),
			tokenQuota: { allowance: 50_000, used: 1_200, resetAt: daysFromNow(30) },
		});
		studentCreated = true;
	} else if (String(student.universityId || "") !== String(universityId)) {
		student.universityId = universityId;
		student.institution = lecturer.institution;
		student.role = "student";
		student.status = "active";
		await student.save();
	}

	const priorProjects = await PortalProjectModel.find({
		universityId,
		"metadata.seed": SEED,
	}).select("_id");
	const priorIds = priorProjects.map((row) => row._id);

	if (priorIds.length > 0) {
		await PortalChapterVersionModel.deleteMany({ projectId: { $in: priorIds } });
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

	const termPaper = await AssignmentBriefModel.create({
		universityId,
		lecturerId: lecturer._id,
		title: "CSC 301 — Critical review of distributed systems",
		instructions: `${SEED_MARK}
<p>Write a critical review of contemporary distributed systems. Your paper should:</p>
<ul>
<li>Define the problem space and why it matters in African higher-education infrastructure.</li>
<li>Compare at least three peer-reviewed approaches (replication, consensus, and partitioning).</li>
<li>Take a clear position and defend it with cited evidence.</li>
</ul>
<p>Use your house citation style. Do not submit uncited claims.</p>`,
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
		courseName: "CSC 301 — Distributed Systems",
		courseYear: "Year 3",
		status: "published",
	});

	const methodsEssay = await AssignmentBriefModel.create({
		universityId,
		lecturerId: lecturer._id,
		title: "RES 210 — Research methods short essay",
		instructions: `${SEED_MARK}
<p>Explain how you would design a small empirical study in your discipline.</p>
<p>Cover sampling, data collection, analysis, and ethics. Keep the design feasible for an undergraduate project.</p>`,
		requiredItems: ["Research question", "Method justification", "Ethics note"],
		wordCountMin: 800,
		wordCountMax: 1200,
		maxScore: 50,
		rubric: [
			{ name: "Clarity of question", maxMarks: 15 },
			{ name: "Method fit", maxMarks: 20 },
			{ name: "Ethics and feasibility", maxMarks: 15 },
		],
		dueAt: daysFromNow(21),
		allowLateSubmission: false,
		courseName: "RES 210 — Research Methods",
		courseYear: "Year 2",
		status: "published",
	});

	await AssignmentBriefModel.create({
		universityId,
		lecturerId: lecturer._id,
		title: "Draft — Seminar presentation brief",
		instructions: `${SEED_MARK}<p>Internal draft. Not visible to students until published.</p>`,
		requiredItems: ["Outline", "Slides notes"],
		wordCountMin: 500,
		wordCountMax: 800,
		maxScore: 20,
		rubric: [],
		dueAt: daysFromNow(28),
		allowLateSubmission: true,
		courseName: "CSC 301 — Distributed Systems",
		courseYear: "Year 3",
		status: "draft",
	});

	const assignmentHtml = [
		"<h1>Replication versus partitioning in campus services</h1>",
		p(
			"This paper argues that Nigerian university learning platforms fail less from raw compute limits than from weak replication strategy. When a registrar portal is unavailable during registration week, the cost is academic time, not merely downtime minutes.",
		),
		"<h2>Literature</h2>",
		p(
			"Consensus protocols such as Raft trade write latency for a single committed log. Partitioning schemes such as consistent hashing scale reads, but they push complexity into the client and into operational runbooks. Recent education-technology studies note that campuses often adopt cloud objects without a failover story for identity.",
		),
		"<h2>Position</h2>",
		p(
			"A hybrid is more honest for this setting: replicate the identity and enrolment path, partition content. The claim is not original in distributed systems, but it is under-applied in the institutions that need it most. Limitations include the small number of public post-mortems from African universities.",
		),
		"<h2>References</h2>",
		"<p>Ongaro, D. and Ousterhout, J. (2014). In Search of an Understandable Consensus Algorithm. USENIX ATC.</p>",
	].join("");

	const submittedAssignment = await PortalProjectModel.create({
		universityId,
		studentId: student._id,
		supervisorId: lecturer._id,
		projectType: "assignment",
		title: termPaper.title,
		topic: termPaper.title,
		studentMatNo: "CSC/2022/0148",
		courseYear: "Year 3",
		courseName: termPaper.courseName,
		assignmentBriefId: termPaper._id,
		status: ProjectStatus.Active,
		stage: ProjectStage.Proposal,
		topicStatus: "approved",
		progressPercent: 70,
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

	const draftAssignment = await PortalProjectModel.create({
		universityId,
		studentId: student._id,
		supervisorId: lecturer._id,
		projectType: "assignment",
		title: methodsEssay.title,
		topic: methodsEssay.title,
		studentMatNo: "CSC/2022/0148",
		courseYear: "Year 2",
		courseName: methodsEssay.courseName,
		assignmentBriefId: methodsEssay._id,
		status: ProjectStatus.Active,
		stage: ProjectStage.Topic,
		topicStatus: "draft",
		progressPercent: 15,
		pages: [
			{
				title: "Assignment",
				order: 0,
				content: p(
					"Draft only. I will compare a survey of final-year students with a small interview sample of lecturers. Sampling is still undecided.",
				),
				reviewStatus: "none",
			},
		],
		metadata: { seed: SEED },
	});

	const introHtml = [
		"<h1>Chapter 1 — Introduction</h1>",
		p(
			"This dissertation examines how supervised undergraduate writing can be reviewed at scale without replacing academic judgement. The setting is a single faculty using a shared research workspace.",
		),
		"<h2>Problem</h2>",
		p(
			"Lecturers receive chapters in inconsistent formats, with weak citation hygiene and little memory of prior feedback. Students wait for comments that arrive after the next chapter is already underway.",
		),
		"<h2>Aim</h2>",
		p(
			"The aim is to describe a supervision loop in which students submit locked chapter versions, supervisors annotate, and AI flags weaknesses without awarding the mark.",
		),
	].join("");

	const dissertation = await PortalProjectModel.create({
		universityId,
		studentId: student._id,
		supervisorId: lecturer._id,
		projectType: "dissertation",
		title: "Supervision workflows for undergraduate research writing",
		topic: "Designing a fair submit–review loop for undergraduate dissertations",
		abstract:
			"This study asks how chapter-level review, assignment briefs, and structured feedback can sit together in one university workspace without collapsing into automated marking.",
		status: ProjectStatus.Active,
		stage: ProjectStage.Chapter1,
		topicStatus: "submitted",
		progressPercent: 22,
		pages: [
			{ title: "Abstract", order: 0, content: p("Draft abstract pending supervisor comment."), reviewStatus: "none" },
			{ title: "Introduction", order: 1, content: introHtml, reviewStatus: "none" },
			{ title: "Literature Review", order: 2, content: "", reviewStatus: "none" },
			{ title: "Methodology", order: 3, content: "", reviewStatus: "none" },
			{ title: "Results", order: 4, content: "", reviewStatus: "none" },
			{ title: "Discussion & Conclusion", order: 5, content: "", reviewStatus: "none" },
			{ title: "References", order: 6, content: "", reviewStatus: "none" },
		],
		metadata: { seed: SEED },
	});

	const introPage = dissertation.pages?.[1];
	if (introPage) {
		introPage.reviewStatus = "none";
	}
	await dissertation.save();

	const chapter = await PortalChapterModel.create({
		universityId,
		projectId: dissertation._id,
		number: 1,
		title: "Introduction",
		content: introHtml,
		status: ChapterStatus.Submitted,
		locked: true,
	});

	const version = await PortalChapterVersionModel.create({
		universityId,
		chapterId: chapter._id,
		projectId: dissertation._id,
		versionNumber: 1,
		contentType: ContentType.Richtext,
		richTextJson: { html: introHtml },
		submittedBy: student._id,
		submittedAt: new Date(),
		wordCount: 240,
	});
	chapter.currentVersionId = version._id;
	await chapter.save();

	await PortalNotificationModel.create([
		{
			universityId,
			userId: lecturer._id,
			type: "chapter.submitted",
			title: "Chapter submitted for review",
			body: `${student.name} submitted Chapter 1 (Introduction) on “${dissertation.title}”.`,
			data: {
				seed: SEED,
				projectId: String(dissertation._id),
				chapterId: String(chapter._id),
			},
		},
		{
			universityId,
			userId: lecturer._id,
			type: "project.assigned",
			title: "New assignment submission",
			body: `${student.name} started “${termPaper.title}”.`,
			data: {
				seed: SEED,
				projectId: String(submittedAssignment._id),
			},
		},
		{
			universityId,
			userId: student._id,
			type: "project.assigned",
			title: "You are assigned to a supervisor",
			body: `${lecturer.name} is your supervisor for coursework and dissertation writing.`,
			data: {
				seed: SEED,
				projectId: String(dissertation._id),
			},
		},
		{
			universityId,
			userId: student._id,
			type: "chapter.submitted",
			title: "Chapter 1 is with your supervisor",
			body: "Introduction is locked while it is under review.",
			data: {
				seed: SEED,
				projectId: String(dissertation._id),
				chapterId: String(chapter._id),
			},
		},
	]);

	console.log("Seeded supervision demo");
	console.log(`  lecturer: ${lecturer.email}  (${lecturer.name})`);
	console.log(`  student:  ${student.email}  (${student.name})${studentCreated ? "  [created]" : ""}`);
	console.log(`  briefs:   2 published + 1 draft  →  /assignments`);
	console.log(`  submissions: ${submittedAssignment.title}`);
	console.log(`              ${draftAssignment.title}`);
	console.log(`  dissertation: ${dissertation.title}  (topic pending, ch.1 submitted)`);
	if (studentCreated) {
		console.log(`  student login: ${STUDENT_EMAIL}  (password from SEED_STUDENT_PASSWORD)`);
	}
}

main()
	.catch((error) => {
		console.error(error instanceof Error ? error.message : error);
		process.exitCode = 1;
	})
	.finally(async () => {
		await disconnectMongo().catch(() => undefined);
	});
