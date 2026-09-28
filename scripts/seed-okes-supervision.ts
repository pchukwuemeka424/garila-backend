/**
 * Seed supervision + assignment demo data for
 * info@okesinnovationltd.co.uk and students assigned to that lecturer.
 *
 *   bash scripts/with-node.sh npx tsx scripts/seed-okes-supervision.ts
 *
 * Students are created in the lecturer's university if missing.
 * Password: SEED_STUDENT_PASSWORD, or DemoStudent123!
 */
import { config } from "dotenv";
import { resolve } from "node:path";
import type { Types } from "mongoose";

import { connectMongo, disconnectMongo } from "../src/db/connect.js";
import { getBackendRoot, getRepoRoot } from "../src/lib/paths.js";
import { hashPassword } from "../src/lib/password.js";
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

const LECTURER_EMAIL = "info@okesinnovationltd.co.uk";
const STUDENT_PASSWORD =
	process.env.SEED_STUDENT_PASSWORD?.trim() || "DemoStudent123!";
const SEED = "okes-supervision-v2";
const SEED_MARK = `<!--seed:${SEED}-->`;

/** Extra CSC 301 term-paper submitters so /assignments/{id} paginates at 10/page. */
const EXTRA_ASSIGNMENT_STUDENTS = [
	{
		name: "Ngozi Adeyemi",
		email: "student5@okesinnovationltd.co.uk",
		matNo: "CSC/2022/0155",
		programme: "BSc Computer Science",
		cohort: "2022/2023",
	},
	{
		name: "Tunde Bakare",
		email: "student6@okesinnovationltd.co.uk",
		matNo: "CSC/2022/0162",
		programme: "BSc Computer Science",
		cohort: "2022/2023",
	},
	{
		name: "Amina Sule",
		email: "student7@okesinnovationltd.co.uk",
		matNo: "CSC/2023/0091",
		programme: "BSc Computer Science",
		cohort: "2023/2024",
	},
	{
		name: "Emeka Okonkwo",
		email: "student8@okesinnovationltd.co.uk",
		matNo: "CSC/2022/0188",
		programme: "BSc Computer Science",
		cohort: "2022/2023",
	},
	{
		name: "Blessing Umeh",
		email: "student9@okesinnovationltd.co.uk",
		matNo: "CSC/2023/0104",
		programme: "BSc Software Engineering",
		cohort: "2023/2024",
	},
	{
		name: "Yusuf Abdullahi",
		email: "student10@okesinnovationltd.co.uk",
		matNo: "CSC/2022/0203",
		programme: "BSc Computer Science",
		cohort: "2022/2023",
	},
	{
		name: "Chioma Nwosu",
		email: "student11@okesinnovationltd.co.uk",
		matNo: "CSC/2023/0119",
		programme: "BSc Computer Science",
		cohort: "2023/2024",
	},
	{
		name: "Kelvin Obi",
		email: "student12@okesinnovationltd.co.uk",
		matNo: "CSC/2022/0217",
		programme: "BSc Computer Science",
		cohort: "2022/2023",
	},
	{
		name: "Halima Danjuma",
		email: "student13@okesinnovationltd.co.uk",
		matNo: "CSC/2023/0130",
		programme: "BSc Computer Science",
		cohort: "2023/2024",
	},
	{
		name: "Samuel Adebayo",
		email: "student14@okesinnovationltd.co.uk",
		matNo: "CSC/2022/0225",
		programme: "BSc Software Engineering",
		cohort: "2022/2023",
	},
] as const;

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

type PageSeed = {
	title: string;
	order: number;
	content: string;
	reviewStatus: "none" | "approved" | "needs_revision";
	reviewRemark?: string;
	reviewAnnotatedHtml?: string;
	reviewedAt?: Date;
	reviewedBy?: Types.ObjectId;
	reviewTrail?: Array<{
		type: "submitted" | "rewrite_requested" | "approved";
		at: Date;
		actorId?: Types.ObjectId;
		remark?: string;
		contentHtml?: string;
		annotatedHtml?: string;
		versionNumber?: number;
		wordCount?: number;
	}>;
};

function daysFromNow(days: number) {
	const date = new Date();
	date.setDate(date.getDate() + days);
	date.setHours(17, 0, 0, 0);
	return date;
}

function daysAgo(days: number, hoursOffset = 0) {
	const date = new Date();
	date.setDate(date.getDate() - days);
	date.setHours(date.getHours() - hoursOffset);
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

function assignmentPaperHtml(opts: {
	title: string;
	lead: string;
	literature: string;
	position: string;
	reference: string;
}) {
	return [
		`<h1>${opts.title}</h1>`,
		p(opts.lead),
		"<h2>Literature</h2>",
		p(opts.literature),
		"<h2>Position</h2>",
		p(opts.position),
		"<h2>References</h2>",
		`<p>${opts.reference}</p>`,
	].join("");
}

function pagesFrom(
	contents: Partial<Record<(typeof CHAPTER_TITLES)[number], string>>,
	approvedThrough = -1,
	needsRevisionAt = -1,
): PageSeed[] {
	return CHAPTER_TITLES.map((title, order) => {
		let reviewStatus: PageSeed["reviewStatus"] = "none";
		if (order === needsRevisionAt) reviewStatus = "needs_revision";
		else if (order <= approvedThrough) reviewStatus = "approved";
		return {
			title,
			order,
			content: contents[title] || "",
			reviewStatus,
			reviewRemark:
				reviewStatus === "needs_revision"
					? "Tighten the claim and add a cited source before resubmitting."
					: "",
		};
	});
}

async function ensureStudent(opts: {
	name: string;
	email: string;
	matNo: string;
	programme: string;
	cohort: string;
	universityId: Types.ObjectId;
	institution?: string;
	department?: string;
}) {
	let student = await UserModel.findOne({ email: opts.email.toLowerCase() });
	let created = false;
	if (!student) {
		student = await UserModel.create({
			name: opts.name,
			email: opts.email.toLowerCase(),
			passwordHash: await hashPassword(STUDENT_PASSWORD),
			role: "student",
			status: "active",
			department: opts.department || "Computer Science",
			institution: opts.institution,
			universityId: opts.universityId,
			programme: opts.programme,
			cohort: opts.cohort,
			lastActiveAt: new Date(),
			tokenQuota: {
				allowance: 50_000,
				used: 800,
				resetAt: daysFromNow(30),
			},
		});
		created = true;
	} else {
		student.name = opts.name;
		student.role = "student";
		student.status = "active";
		student.universityId = opts.universityId;
		student.institution = opts.institution;
		student.department = opts.department || student.department;
		student.programme = opts.programme;
		student.cohort = opts.cohort;
		await student.save();
	}
	return { student, created, matNo: opts.matNo };
}

async function submitChapter(opts: {
	universityId: Types.ObjectId;
	projectId: Types.ObjectId;
	studentId: Types.ObjectId;
	number: number;
	title: string;
	html: string;
	status?: ChapterStatus;
}) {
	const status = opts.status ?? ChapterStatus.Submitted;
	const chapter = await PortalChapterModel.create({
		universityId: opts.universityId,
		projectId: opts.projectId,
		number: opts.number,
		title: opts.title,
		content: opts.html,
		status,
		locked: status === ChapterStatus.Submitted || status === ChapterStatus.Approved,
		approvedAt: status === ChapterStatus.Approved ? new Date() : undefined,
	});
	const version = await PortalChapterVersionModel.create({
		universityId: opts.universityId,
		chapterId: chapter._id,
		projectId: opts.projectId,
		versionNumber: 1,
		contentType: ContentType.Richtext,
		richTextJson: { html: opts.html },
		submittedBy: opts.studentId,
		submittedAt: new Date(),
		wordCount: opts.html.replace(/<[^>]+>/g, " ").trim().split(/\s+/).length,
	});
	chapter.currentVersionId = version._id;
	await chapter.save();
	return chapter;
}

async function main() {
	await connectMongo();

	const lecturer = await UserModel.findOne({
		email: LECTURER_EMAIL.toLowerCase(),
	});
	if (!lecturer) {
		throw new Error(
			`Lecturer not found: ${LECTURER_EMAIL}. Create that account first.`,
		);
	}
	if (!lecturer.universityId) {
		throw new Error(
			`${LECTURER_EMAIL} has no universityId — cannot scope portal data.`,
		);
	}

	const universityId = lecturer.universityId;
	const institution = lecturer.institution;
	const department = lecturer.department || "Computer Science";

	const ada = await ensureStudent({
		name: "Ada Okafor",
		email: "student@okesinnovationltd.co.uk",
		matNo: "CSC/2022/0148",
		programme: "BSc Computer Science",
		cohort: "2022/2023",
		universityId,
		institution,
		department,
	});
	const chinedu = await ensureStudent({
		name: "Chinedu Eze",
		email: "student2@okesinnovationltd.co.uk",
		matNo: "CSC/2023/0201",
		programme: "MSc Computer Science",
		cohort: "2023/2024",
		universityId,
		institution,
		department,
	});
	const fatima = await ensureStudent({
		name: "Fatima Bello",
		email: "student3@okesinnovationltd.co.uk",
		matNo: "EDU/2021/0088",
		programme: "BEd Educational Technology",
		cohort: "2021/2022",
		universityId,
		institution,
		department: "Educational Technology",
	});
	const ibrahim = await ensureStudent({
		name: "Ibrahim Yusuf",
		email: "student4@okesinnovationltd.co.uk",
		matNo: "CSC/2024/0112",
		programme: "BSc Computer Science",
		cohort: "2024/2025",
		universityId,
		institution,
		department,
	});
	const extraAssignmentStudents = [];
	for (const row of EXTRA_ASSIGNMENT_STUDENTS) {
		extraAssignmentStudents.push(
			await ensureStudent({
				...row,
				universityId,
				institution,
				department,
			}),
		);
	}

	const priorSeeds = [SEED, "okes-supervision-v1"];
	const priorProjects = await PortalProjectModel.find({
		universityId,
		"metadata.seed": { $in: priorSeeds },
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
		instructions: { $regex: /okes-supervision-v[12]/ },
	});
	await PortalNotificationModel.deleteMany({
		universityId,
		"data.seed": { $in: priorSeeds },
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

	const assignmentHtml = assignmentPaperHtml({
		title: "Replication versus partitioning in campus services",
		lead: "This paper argues that Nigerian university learning platforms fail less from raw compute limits than from weak replication strategy. When a registrar portal is unavailable during registration week, the cost is academic time, not merely downtime minutes.",
		literature:
			"Consensus protocols such as Raft trade write latency for a single committed log. Partitioning schemes such as consistent hashing scale reads, but they push complexity into the client and into operational runbooks.",
		position:
			"A hybrid is more honest for this setting: replicate the identity and enrolment path, partition content. Limitations include the small number of public post-mortems from African universities.",
		reference:
			"Ongaro, D. and Ousterhout, J. (2014). In Search of an Understandable Consensus Algorithm. USENIX ATC.",
	});

	await PortalProjectModel.create({
		universityId,
		studentId: ada.student._id,
		supervisorId: lecturer._id,
		projectType: "assignment",
		title: termPaper.title,
		topic: termPaper.title,
		studentMatNo: ada.matNo,
		courseYear: "Year 3",
		courseName: termPaper.courseName,
		assignmentBriefId: termPaper._id,
		status: ProjectStatus.Active,
		stage: ProjectStage.Proposal,
		topicStatus: "approved",
		progressPercent: 0,
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

	const extraTermPaperSpecs: Array<{
		html: string;
		reviewStatus: "none" | "approved" | "needs_revision";
		reviewRemark?: string;
		topicStatus: "draft" | "submitted" | "approved";
		progressPercent: number;
		score?: number;
		scoreNote?: string;
		daysAgoSubmitted?: number;
	}> = [
		{
			html: assignmentPaperHtml({
				title: "Consensus latency on shared campus networks",
				lead: "Election timeouts that ignore intermittent campus WAN loss produce repeated leader flaps during registration peaks.",
				literature:
					"Raft assumes relatively stable membership. When student Wi-Fi and intermittent ISP links dominate, heartbeat loss is not evidence of node failure.",
				position:
					"Timeouts should be adaptive to measured round-trip variance on the campus edge, not copied from cloud tutorials.",
				reference:
					"Howard, H. (2014). ARC: Analysis of Raft Consensus. Technical Report UCAM-CL-TR-857.",
			}),
			reviewStatus: "none",
			topicStatus: "submitted",
			progressPercent: 100,
			score: 78,
			scoreNote: "Clear argument; strengthen African case evidence in the limitations section.",
			daysAgoSubmitted: 3,
		},
		{
			html: assignmentPaperHtml({
				title: "Partitioning student records without orphaning identity",
				lead: "Sharding enrolment by faculty improves write throughput but breaks cross-faculty course registration unless identity stays strongly consistent.",
				literature:
					"Consistent hashing reduces hot shards for content, yet identity and fee status must remain linearisable for exam eligibility checks.",
				position:
					"Keep identity and finance on a replicated primary path; partition only syllabi, media, and offline caches.",
				reference:
					"Karger, D. et al. (1997). Consistent Hashing and Random Trees. ACM STOC.",
			}),
			reviewStatus: "approved",
			topicStatus: "approved",
			progressPercent: 100,
			score: 86,
			scoreNote: "Strong structure and citation hygiene. Ready for archive.",
			daysAgoSubmitted: 5,
		},
		{
			html: assignmentPaperHtml({
				title: "Why eventual consistency fails fee clearance",
				lead: "A student marked cleared on one replica and uncleared on another creates exam-hall disputes that no SLA metric captures.",
				literature:
					"Eventual consistency is appropriate for timetable caches, not for financial gates tied to academic progression.",
				position:
					"Fee clearance needs synchronous commit across the replicas that exam officers query, even if that lowers peak throughput.",
				reference:
					"Bailis, P. and Ghodsi, A. (2013). Eventual Consistency Today. Communications of the ACM.",
			}),
			reviewStatus: "needs_revision",
			reviewRemark:
				"Add at least two peer-reviewed sources on financial ledgers or payment systems, and quantify the conflict window you claim.",
			topicStatus: "submitted",
			progressPercent: 70,
			daysAgoSubmitted: 2,
		},
		{
			html: assignmentPaperHtml({
				title: "Read replicas for learning-management reads",
				lead: "Most LMS traffic is read-heavy after midnight before continuous assessment deadlines. Write amplification from naive replication wastes scarce bandwidth.",
				literature:
					"Read replicas reduce load on the primary, but stale lecture material during live edits confuses cohorts.",
				position:
					"Use read replicas with short TTL invalidation for published materials; keep draft edits on the primary until publish.",
				reference:
					"Kreps, J. (2013). The Log: What every software engineer should know about real-time data's unifying abstraction.",
			}),
			reviewStatus: "none",
			topicStatus: "submitted",
			progressPercent: 90,
			daysAgoSubmitted: 1,
		},
		{
			html: assignmentPaperHtml({
				title: "Quorum size under intermittent power",
				lead: "Generator cut-overs during exams can drop a minority of nodes. Fixed majority quorums then stall writes for attendance capture.",
				literature:
					"Flexible quorums and witness nodes are discussed in cloud literature but rarely evaluated on diesel-backed campus rooms.",
				position:
					"Prefer witness-assisted quorums for attendance and result capture windows; fall back to strict majority overnight.",
				reference:
					"Howard, H. et al. (2016). Flexible Paxos: Quorum intersection revisited.",
			}),
			reviewStatus: "none",
			topicStatus: "submitted",
			progressPercent: 85,
			score: 72,
			scoreNote: "Good problem framing; method section needs clearer comparison criteria.",
			daysAgoSubmitted: 6,
		},
		{
			html: assignmentPaperHtml({
				title: "Geo-partitioning across satellite campuses",
				lead: "A multi-campus university that treats all writes as global creates latency that students experience as failed form submits.",
				literature:
					"Geo-partitioning and CRDTs trade strong consistency for locality. Registrar workflows often cannot accept that trade-off.",
				position:
					"Pin student home-campus writes locally and replicate identity asynchronously with conflict policies for transfers.",
				reference:
					"Brewer, E. (2012). CAP Twelve Years Later: How the Rules Have Changed. IEEE Computer.",
			}),
			reviewStatus: "none",
			topicStatus: "submitted",
			progressPercent: 80,
			daysAgoSubmitted: 4,
		},
		{
			html: assignmentPaperHtml({
				title: "Message queues between registry and LMS",
				lead: "Synchronous HTTP between registry and LMS turns every network blip into a blocked registration click.",
				literature:
					"Durable queues decouple services, but at-least-once delivery forces idempotent enrolment handlers.",
				position:
					"Queue course enrolment events with idempotency keys derived from mat number and session, then reconcile nightly.",
				reference:
					"Kleppmann, M. (2017). Designing Data-Intensive Applications. O'Reilly. Chapters on messaging and batch processing.",
			}),
			reviewStatus: "none",
			topicStatus: "submitted",
			progressPercent: 95,
			daysAgoSubmitted: 2,
		},
		{
			html: assignmentPaperHtml({
				title: "Caching versus correctness in result portals",
				lead: "Aggressive CDN caching of result pages creates rumours when a regrade is published but caches still show the old mark.",
				literature:
					"Cache invalidation is a classic distributed-systems pain point; academic result portals amplify the social cost of staleness.",
				position:
					"Never cache authenticated result payloads; cache only public prospectus pages with explicit purge on publish.",
				reference:
					"Fielding, R. and Reschke, J. (2014). Hypertext Transfer Protocol (HTTP/1.1): Caching. RFC 7234.",
			}),
			reviewStatus: "none",
			topicStatus: "submitted",
			progressPercent: 88,
			daysAgoSubmitted: 7,
		},
		{
			html: assignmentPaperHtml({
				title: "Failure domains in shared hosting for departments",
				lead: "When every departmental site shares one VM, a single noisy neighbour takes down announcement pages campus-wide.",
				literature:
					"Isolation via containers and quotas is standard in cloud tenancy models, yet many faculties still co-host on unmanaged stacks.",
				position:
					"Separate failure domains by faculty with resource quotas, even if that means fewer vanity domains.",
				reference:
					"Burns, B. et al. (2016). Borg, Omega, and Kubernetes. ACM Queue.",
			}),
			reviewStatus: "none",
			topicStatus: "submitted",
			progressPercent: 75,
			daysAgoSubmitted: 8,
		},
		{
			html: "",
			reviewStatus: "none",
			topicStatus: "draft",
			progressPercent: 10,
		},
	];

	for (let i = 0; i < extraAssignmentStudents.length; i += 1) {
		const student = extraAssignmentStudents[i];
		const spec = extraTermPaperSpecs[i];
		const scored =
			typeof spec.score === "number"
				? {
						score: spec.score,
						scoreNote: spec.scoreNote || "",
						scoredAt: daysAgo(spec.daysAgoSubmitted ?? 2),
						scoredBy: lecturer._id,
						scoreSource: "manual" as const,
						criterionScores: [
							{
								name: "Argument and structure",
								score: Math.round((spec.score / 100) * 30),
								maxMarks: 30,
							},
							{
								name: "Use of literature",
								score: Math.round((spec.score / 100) * 30),
								maxMarks: 30,
							},
							{
								name: "Critical analysis",
								score: Math.round((spec.score / 100) * 25),
								maxMarks: 25,
							},
							{
								name: "Presentation and citations",
								score: Math.round((spec.score / 100) * 15),
								maxMarks: 15,
							},
						],
					}
				: {};
		await PortalProjectModel.create({
			universityId,
			studentId: student.student._id,
			supervisorId: lecturer._id,
			projectType: "assignment",
			title: termPaper.title,
			topic: termPaper.title,
			studentMatNo: student.matNo,
			courseYear: "Year 3",
			courseName: termPaper.courseName,
			assignmentBriefId: termPaper._id,
			status: ProjectStatus.Active,
			stage: ProjectStage.Proposal,
			topicStatus: spec.topicStatus,
			progressPercent: spec.progressPercent,
			pages: [
				{
					title: "Assignment",
					order: 0,
					content: spec.html,
					reviewStatus: spec.reviewStatus,
					reviewRemark: spec.reviewRemark || "",
					...(spec.reviewStatus !== "none"
						? {
								reviewedAt: daysAgo(spec.daysAgoSubmitted ?? 1),
								reviewedBy: lecturer._id,
							}
						: {}),
				},
			],
			...scored,
			metadata: { seed: SEED, assignmentBatch: "extra-term-paper" },
			...(spec.daysAgoSubmitted
				? { createdAt: daysAgo(spec.daysAgoSubmitted), updatedAt: daysAgo(0, i) }
				: {}),
		});
	}

	await PortalProjectModel.create({
		universityId,
		studentId: ibrahim.student._id,
		supervisorId: lecturer._id,
		projectType: "assignment",
		title: methodsEssay.title,
		topic: methodsEssay.title,
		studentMatNo: ibrahim.matNo,
		courseYear: "Year 2",
		courseName: methodsEssay.courseName,
		assignmentBriefId: methodsEssay._id,
		status: ProjectStatus.Active,
		stage: ProjectStage.Topic,
		topicStatus: "draft",
		progressPercent: 0,
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

	const adaIntroRemark =
		"<p>Tighten the problem statement and name the specific supervision failure you will measure. Add at least two cited studies on formative feedback latency before resubmitting.</p>";
	const adaIntroAnnotated = [
		"<h1>Chapter 1 — Introduction</h1>",
		p(
			'<mark class="review-flag-weakness" data-review-kind="weakness">This dissertation examines how supervised undergraduate writing can be reviewed at scale without replacing academic judgement.</mark> The setting is a single faculty using a shared research workspace.',
		),
		"<h2>Problem</h2>",
		p(
			'<mark class="review-flag-citation" data-review-kind="citation">Lecturers receive chapters in inconsistent formats, with weak citation hygiene and little memory of prior feedback.</mark> Students wait for comments that arrive after the next chapter is already underway.',
		),
		"<h2>Aim</h2>",
		p(
			"The aim is to describe a supervision loop in which students submit locked chapter versions, supervisors annotate, and AI flags weaknesses without awarding the mark.",
		),
	].join("");

	const dissertationPages: PageSeed[] = CHAPTER_TITLES.map((title, order) => {
		if (order === 0) {
			return {
				title,
				order,
				content: p(
					"Draft abstract pending supervisor comment on the proposed topic and supervision loop.",
				),
				reviewStatus: "none",
			};
		}
		if (order === 1) {
			return {
				title,
				order,
				content: introHtml,
				reviewStatus: "needs_revision",
				reviewRemark: adaIntroRemark,
				reviewAnnotatedHtml: adaIntroAnnotated,
				reviewedAt: daysAgo(1),
				reviewedBy: lecturer._id,
				reviewTrail: [
					{
						type: "submitted",
						at: daysAgo(3),
						actorId: ada.student._id,
						versionNumber: 1,
						wordCount: countWords(introHtml),
						contentHtml: introHtml,
					},
					{
						type: "rewrite_requested",
						at: daysAgo(1),
						actorId: lecturer._id,
						versionNumber: 1,
						wordCount: countWords(introHtml),
						remark: adaIntroRemark,
						contentHtml: introHtml,
						annotatedHtml: adaIntroAnnotated,
					},
				],
			};
		}
		return { title, order, content: "", reviewStatus: "none" };
	});

	const dissertation = await PortalProjectModel.create({
		universityId,
		studentId: ada.student._id,
		supervisorId: lecturer._id,
		projectType: "dissertation",
		title: "Supervision workflows for undergraduate research writing",
		topic: "Designing a fair submit–review loop for undergraduate dissertations",
		abstract:
			"This study asks how chapter-level review, assignment briefs, and structured feedback can sit together in one university workspace without collapsing into automated marking.",
		status: ProjectStatus.Active,
		stage: ProjectStage.Chapter1,
		topicStatus: "submitted",
		progressPercent: 0,
		pages: dissertationPages,
		metadata: { seed: SEED },
	});

	const chapter = await PortalChapterModel.create({
		universityId,
		projectId: dissertation._id,
		number: 1,
		title: "Introduction",
		content: introHtml,
		status: ChapterStatus.NeedsRevision,
		locked: false,
		rejectionReason: adaIntroRemark,
		reviewDraftRemark: adaIntroRemark,
		reviewAnnotatedHtml: adaIntroAnnotated,
	});

	const version = await PortalChapterVersionModel.create({
		universityId,
		chapterId: chapter._id,
		projectId: dissertation._id,
		versionNumber: 1,
		contentType: ContentType.Richtext,
		richTextJson: { html: introHtml },
		submittedBy: ada.student._id,
		submittedAt: daysAgo(3),
		wordCount: countWords(introHtml),
	});
	chapter.currentVersionId = version._id;
	await chapter.save();

	const chineduIntroV1 = [
		"<h1>Chapter 1 — Introduction</h1>",
		p(
			"Unverified citations remain the most visible integrity failure when students draft with generative tools.",
		),
		p(
			"This study evaluates whether a governed citation bank reduces fabricated references without slowing postgraduate supervision velocity.",
		),
	].join("");

	const chineduIntroRemark =
		"<p>The introduction lacks a clearly formulated research question on retrieval validation. Please define the scope of citation integrity and add at least three foundational studies on hallucination benchmarking before resubmitting.</p>";

	const chineduIntroAnnotated = [
		"<h1>Chapter 1 — Introduction</h1>",
		p(
			'<mark class="review-flag-weakness" data-review-kind="weakness">Unverified citations remain the most visible integrity failure when students draft with generative tools.</mark>',
		),
		p(
			'<mark class="review-flag-citation" data-review-kind="citation">This study evaluates whether a governed citation bank reduces fabricated references without slowing postgraduate supervision velocity.</mark>',
		),
	].join("");

	const chineduIntroV2 = [
		"<h1>Chapter 1 — Introduction</h1>",
		p(
			"This thesis asks whether a governed citation bank reduces fabricated references in AI-assisted postgraduate drafts without slowing supervision velocity.",
		),
		p(
			"Prior work on hallucination benchmarking (Ji et al., 2023), retrieval-augmented generation evaluation (Gao et al., 2024), and institutional citation integrity protocols (Okafor &amp; Bello, 2025) frames the problem as verification of claimed sources rather than generic writing quality.",
		),
		p(
			"The study therefore compares unconstrained drafting with drafts that may only cite items present in a retrieved literature bank curated for one computer-science department.",
		),
	].join("");

	const atRiskPages: PageSeed[] = CHAPTER_TITLES.map((title, order) => {
		if (order === 0) {
			return {
				title,
				order,
				content: p(
					"This thesis investigates how citation-verification steps affect the trustworthiness of AI-assisted academic drafts in a Nigerian computer-science department.",
				),
				reviewStatus: "none",
			};
		}
		if (order === 1) {
			return {
				title,
				order,
				content: chineduIntroV2,
				reviewStatus: "none",
				reviewRemark: chineduIntroRemark,
				reviewAnnotatedHtml: "",
				reviewedAt: daysAgo(2),
				reviewedBy: lecturer._id,
				reviewTrail: [
					{
						type: "submitted",
						at: daysAgo(5),
						actorId: chinedu.student._id,
						versionNumber: 1,
						wordCount: countWords(chineduIntroV1),
						contentHtml: chineduIntroV1,
					},
					{
						type: "rewrite_requested",
						at: daysAgo(4),
						actorId: lecturer._id,
						versionNumber: 1,
						wordCount: countWords(chineduIntroV1),
						remark: chineduIntroRemark,
						contentHtml: chineduIntroV1,
						annotatedHtml: chineduIntroAnnotated,
					},
					{
						type: "submitted",
						at: daysAgo(0, 2),
						actorId: chinedu.student._id,
						versionNumber: 2,
						wordCount: countWords(chineduIntroV2),
						contentHtml: chineduIntroV2,
					},
				],
			};
		}
		return {
			title,
			order,
			content: "",
			reviewStatus: "none",
		};
	});

	const thesis = await PortalProjectModel.create({
		universityId,
		studentId: chinedu.student._id,
		supervisorId: lecturer._id,
		projectType: "thesis",
		title: "Citation integrity in AI-assisted academic drafting",
		topic: "Can a citation bank reduce fabricated references in postgraduate drafts?",
		abstract:
			"The thesis tests whether requiring in-text cites from a retrieved literature bank improves source integrity compared with unconstrained drafting.",
		status: ProjectStatus.Active,
		stage: ProjectStage.Proposal,
		topicStatus: "approved",
		progressPercent: 0,
		pages: atRiskPages,
		metadata: { seed: SEED },
	});

	const chineduChapter1 = await PortalChapterModel.create({
		universityId,
		projectId: thesis._id,
		number: 1,
		title: "Introduction",
		content: chineduIntroV2,
		status: ChapterStatus.UnderReview,
		locked: false,
		rejectionReason: chineduIntroRemark,
		reviewDraftRemark: "",
		reviewAnnotatedHtml: "",
	});

	await PortalChapterVersionModel.create({
		universityId,
		chapterId: chineduChapter1._id,
		projectId: thesis._id,
		versionNumber: 1,
		contentType: ContentType.Richtext,
		richTextJson: { html: chineduIntroV1, title: "Introduction" },
		submittedBy: chinedu.student._id,
		submittedAt: daysAgo(5),
		wordCount: countWords(chineduIntroV1),
	});

	const chineduVersion2 = await PortalChapterVersionModel.create({
		universityId,
		chapterId: chineduChapter1._id,
		projectId: thesis._id,
		versionNumber: 2,
		contentType: ContentType.Richtext,
		richTextJson: { html: chineduIntroV2, title: "Introduction" },
		submittedBy: chinedu.student._id,
		submittedAt: daysAgo(0, 2),
		wordCount: countWords(chineduIntroV2),
	});
	chineduChapter1.currentVersionId = chineduVersion2._id;
	await chineduChapter1.save();
	const onTrackContents: Partial<Record<(typeof CHAPTER_TITLES)[number], string>> =
		{
			Abstract: p(
				"This undergraduate project measures AI literacy among Faculty of Education students and relates it to supervised research writing practice.",
			),
			Introduction: [
				"<h1>Introduction</h1>",
				p(
					"Education students are asked to produce literature-backed projects, yet many first encounter generative tools without a faculty protocol. This project maps current practice and the gaps supervisors already see.",
				),
			].join(""),
			"Literature Review": p(
				"Prior work on digital literacy in Nigerian faculties emphasises access and policy, not the supervision loop. This review separates tool use from evidence use.",
			),
			Methodology: p(
				"A mixed survey of 120 undergraduates and 12 supervisor interviews will be analysed descriptively. Participation is voluntary and anonymised.",
			),
			Results: p("Results tables will be inserted after data collection closes."),
		};
	const projectReport = await PortalProjectModel.create({
		universityId,
		studentId: fatima.student._id,
		supervisorId: lecturer._id,
		projectType: "project",
		title: "AI literacy among Faculty of Education students",
		topic: "How education undergraduates use AI tools in supervised project writing",
		abstract:
			"The project reports survey and interview evidence on AI literacy and the implications for project supervision in a Faculty of Education.",
		status: ProjectStatus.Active,
		stage: ProjectStage.Chapter4,
		topicStatus: "approved",
		progressPercent: 57,
		pages: pagesFrom(onTrackContents, 3),
		metadata: { seed: SEED },
	});

	for (const [index, title] of CHAPTER_TITLES.slice(0, 4).entries()) {
		const html = onTrackContents[title] || p(`${title} draft.`);
		await submitChapter({
			universityId,
			projectId: projectReport._id,
			studentId: fatima.student._id,
			number: index + 1,
			title,
			html,
			status: ChapterStatus.Approved,
		});
	}

	const ibrahimLitV1 = [
		"<h1>Chapter 3 — Literature Review</h1>",
		p(
			"Artificial intelligence generation in higher education has expanded rapidly with commercial tools such as ChatGPT, Claude, and Gemini. Many universities currently provide unstructured subscription access without granular limits.",
		),
		p(
			"Commercial systems rely on flat token caps rather than pedagogical need. However, academic workloads vary significantly between qualitative humanities drafting and computational simulation workflows.",
		),
		p(
			"In summary, existing platforms focus on commercial API billing rather than departmental pedagogical quota allocation.",
		),
	].join("");

	const ibrahimLitRemark =
		"<p>The initial draft literature review lists commercial AI products rather than empirical governance and quota-allocation frameworks. Please revise around peer-reviewed studies on institutional compute budgeting, rate-limiting policies, and academic integrity audit trails before resubmitting.</p>";

	const ibrahimLitAnnotated = [
		"<h1>Chapter 3 — Literature Review</h1>",
		p(
			'<mark class="review-flag-citation" data-review-kind="citation">Artificial intelligence generation in higher education has expanded rapidly with commercial tools such as ChatGPT, Claude, and Gemini.</mark> Many universities currently provide unstructured subscription access without granular limits.',
		),
		p(
			'<mark class="review-flag-weakness" data-review-kind="weakness">Commercial systems rely on flat token caps rather than pedagogical need.</mark> However, academic workloads vary significantly between qualitative humanities drafting and computational simulation workflows.',
		),
		p(
			'<mark class="review-flag-wrong-claim" data-review-kind="wrong_claim">In summary, existing platforms focus on commercial API billing rather than departmental pedagogical quota allocation.</mark>',
		),
	].join("");

	const ibrahimLitV2 = [
		"<h1>Chapter 3 — Literature Review</h1>",
		p(
			"The governance of generative AI in higher education requires structured compute-allocation models that balance access with fiscal and integrity controls (Okafor &amp; Adeyemi, 2025). Rather than unconstrained drafting, institutional token quotas provide a verifiable boundary for student research assistance.",
		),
		"<h2>Compute Budgeting and Rate-Limiting</h2>",
		p(
			"Recent work on departmental resource scheduling demonstrates that tier-based token distribution prevents quota exhaustion while maintaining equitable access across disciplines (Bello et al., 2024). Humanities and social science writing requires burst allowances for bibliographic synthesis, whereas engineering workflows demand steady token streaming for code explanation.",
		),
		"<h2>Audit Trails and Academic Integrity</h2>",
		p(
			"Crucially, token-metered desks generate verifiable provenance logs that document student drafting progression over time, discouraging last-minute bulk generation and supporting supervisor verification without intrusive surveillance (Eze &amp; Yusuf, 2025).",
		),
		"<h2>References</h2>",
		p(
			"Bello, F., et al. (2024). Tiered Resource Scheduling for Educational AI Platforms. <em>Journal of Academic Computing</em>, 18(2), 112–128.",
		),
		p(
			"Eze, C. and Yusuf, I. (2025). Provenance Logs and Integrity in Governed AI Desks. <em>African Higher Education Review</em>, 9(1), 45–59.",
		),
		p(
			"Okafor, A. and Adeyemi, K. (2025). Institutional Token Allocation in Supervised University Writing. <em>Educational Technology Quarterly</em>, 31(4), 201–217.",
		),
	].join("");

	const midPages: PageSeed[] = CHAPTER_TITLES.map((title, order) => {
		if (order === 0) {
			return {
				title,
				order,
				content: p(
					"This paper proposes a token-quota model for university AI research desks so undergraduate use stays auditable without blocking legitimate drafting.",
				),
				reviewStatus: "approved",
			};
		}
		if (order === 1) {
			return {
				title,
				order,
				content: p(
					"Open-ended generation is expensive and hard to govern. A faculty desk that meters tokens by programme can keep a public record of effort without reading every prompt.",
				),
				reviewStatus: "approved",
			};
		}
		if (order === 2) {
			return {
				title,
				order,
				content: ibrahimLitV2,
				reviewStatus: "none",
				reviewRemark: ibrahimLitRemark,
				reviewAnnotatedHtml: "",
				reviewedAt: daysAgo(2),
				reviewedBy: lecturer._id,
				reviewTrail: [
					{
						type: "submitted",
						at: daysAgo(3),
						actorId: ibrahim.student._id,
						versionNumber: 1,
						wordCount: countWords(ibrahimLitV1),
						contentHtml: ibrahimLitV1,
					},
					{
						type: "rewrite_requested",
						at: daysAgo(2),
						actorId: lecturer._id,
						versionNumber: 1,
						wordCount: countWords(ibrahimLitV1),
						remark: ibrahimLitRemark,
						contentHtml: ibrahimLitV1,
						annotatedHtml: ibrahimLitAnnotated,
					},
					{
						type: "submitted",
						at: daysAgo(0, 3),
						actorId: ibrahim.student._id,
						versionNumber: 2,
						wordCount: countWords(ibrahimLitV2),
						contentHtml: ibrahimLitV2,
					},
				],
			};
		}
		return {
			title,
			order,
			content: "",
			reviewStatus: "none",
		};
	});

	const researchPaper = await PortalProjectModel.create({
		universityId,
		studentId: ibrahim.student._id,
		supervisorId: lecturer._id,
		projectType: "research",
		title: "Token quotas for university AI research desks",
		topic: "Designing auditable token allowances for undergraduate research AI",
		abstract:
			"The paper outlines a programme-level quota, reset cycle, and audit export suitable for a single-faculty deployment.",
		status: ProjectStatus.Active,
		stage: ProjectStage.Chapter2,
		topicStatus: "approved",
		progressPercent: 29,
		pages: midPages,
		metadata: { seed: SEED },
	});

	for (const [index, title] of ["Abstract", "Introduction"].entries()) {
		const html = midPages[index]?.content || p(`${title} draft.`);
		await submitChapter({
			universityId,
			projectId: researchPaper._id,
			studentId: ibrahim.student._id,
			number: index + 1,
			title,
			html,
			status: ChapterStatus.Approved,
		});
	}

	const ibrahimChapter3 = await PortalChapterModel.create({
		universityId,
		projectId: researchPaper._id,
		number: 3,
		title: "Literature Review",
		content: ibrahimLitV2,
		status: ChapterStatus.UnderReview,
		locked: false,
		rejectionReason: ibrahimLitRemark,
		reviewDraftRemark: "",
		reviewAnnotatedHtml: "",
	});

	await PortalChapterVersionModel.create({
		universityId,
		chapterId: ibrahimChapter3._id,
		projectId: researchPaper._id,
		versionNumber: 1,
		contentType: ContentType.Richtext,
		richTextJson: { html: ibrahimLitV1, title: "Literature Review" },
		submittedBy: ibrahim.student._id,
		submittedAt: daysAgo(3),
		wordCount: countWords(ibrahimLitV1),
	});

	const ibrahimVersion2 = await PortalChapterVersionModel.create({
		universityId,
		chapterId: ibrahimChapter3._id,
		projectId: researchPaper._id,
		versionNumber: 2,
		contentType: ContentType.Richtext,
		richTextJson: { html: ibrahimLitV2, title: "Literature Review" },
		submittedBy: ibrahim.student._id,
		submittedAt: daysAgo(0, 3),
		wordCount: countWords(ibrahimLitV2),
	});

	ibrahimChapter3.currentVersionId = ibrahimVersion2._id;
	await ibrahimChapter3.save();

	await PortalNotificationModel.create([
		{
			universityId,
			userId: lecturer._id,
			type: "chapter.submitted",
			title: "Correction resubmitted for review",
			body: `${ibrahim.student.name} resubmitted Chapter 3 (Literature Review) on “${researchPaper.title}” after addressing rewrite remarks.`,
			data: {
				seed: SEED,
				projectId: String(researchPaper._id),
				chapterId: String(ibrahimChapter3._id),
			},
		},
		{
			universityId,
			userId: lecturer._id,
			type: "chapter.submitted",
			title: "Correction resubmitted for review",
			body: `${chinedu.student.name} resubmitted Chapter 1 (Introduction) on “${thesis.title}”. Previous rejected draft remains in the correction history.`,
			data: {
				seed: SEED,
				projectId: String(thesis._id),
				chapterId: String(chineduChapter1._id),
			},
		},
		{
			universityId,
			userId: lecturer._id,
			type: "chapter.needs_revision",
			title: "Chapter needs revision",
			body: `${ada.student.name}’s Chapter 1 (Introduction) on “${dissertation.title}” was returned for rewrite.`,
			data: {
				seed: SEED,
				projectId: String(dissertation._id),
				chapterId: String(chapter._id),
			},
		},
		{
			universityId,
			userId: lecturer._id,
			type: "topic.submitted",
			title: "Topic awaiting approval",
			body: `${ada.student.name} submitted a dissertation topic for sign-off.`,
			data: {
				seed: SEED,
				projectId: String(dissertation._id),
			},
		},
		{
			universityId,
			userId: lecturer._id,
			type: "project.assigned",
			title: "New supervisee project",
			body: `${fatima.student.name} assigned you as supervisor for “${projectReport.title}”.`,
			data: {
				seed: SEED,
				projectId: String(projectReport._id),
			},
		},
		{
			universityId,
			userId: lecturer._id,
			type: "project.assigned",
			title: "New supervisee project",
			body: `${chinedu.student.name} assigned you as supervisor for “${thesis.title}”.`,
			data: {
				seed: SEED,
				projectId: String(thesis._id),
			},
		},
		{
			universityId,
			userId: ada.student._id,
			type: "chapter.needs_revision",
			title: "Chapter 1 needs revision",
			body: adaIntroRemark.replace(/<[^>]+>/g, " ").trim(),
			data: {
				seed: SEED,
				projectId: String(dissertation._id),
				chapterId: String(chapter._id),
			},
		},
		{
			universityId,
			userId: chinedu.student._id,
			type: "chapter.submitted",
			title: "Chapter 1 resubmitted",
			body: "Your corrected Introduction is with your supervisor. Earlier drafts stay in the correction history.",
			data: {
				seed: SEED,
				projectId: String(thesis._id),
				chapterId: String(chineduChapter1._id),
			},
		},
	]);

	const created = [ada, chinedu, fatima, ibrahim, ...extraAssignmentStudents].filter(
		(row) => row.created,
	);
	console.log("Seeded okes supervision");
	console.log(`  lecturer: ${lecturer.email}  (${lecturer.name})`);
	console.log("  students:");
	for (const row of [ada, chinedu, fatima, ibrahim, ...extraAssignmentStudents]) {
		console.log(
			`    ${row.student.email}  (${row.student.name})${row.created ? "  [created]" : ""}`,
		);
	}
	console.log("  projects:  4 research (dissertation / thesis / project / paper)");
	console.log("  rewrite trails:");
	console.log("    Ada — Introduction rejected (awaiting student resubmit)");
	console.log("    Chinedu — Introduction rejected → resubmitted (v1+v2 trail)");
	console.log("    Ibrahim — Literature Review rejected → resubmitted (v1+v2 trail)");
	console.log("  briefs:    2 published + 1 draft  →  /assignments");
	console.log(
		`  submissions: ${1 + extraAssignmentStudents.length} on CSC 301 term paper (+ 1 methods essay)`,
	);
	console.log("  page:      /supervision/projects");
	if (created.length > 0) {
		console.log(`  student login password: ${STUDENT_PASSWORD}`);
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
